# Local AI Node

The first local node for running a GGUF model. This node does not read the
blockchain or send transactions; the goal of this stage is only to ensure the
model can genuinely be run on a community computer.

## Runtime

Install `llama.cpp` from its official source so that the `llama-cli` executable
is available. Verify:

```bash
llama-cli --version
```

## Dependencies

The node in this folder uses `ethers` from the root `package.json`, so the
install happens **once at the repo root** — not inside `node/`:

```bash
git clone https://github.com/peterpetir123/quorix-ai
cd quorix-ai
npm install
```

`node/` has no `package.json` of its own. Running `npm install` inside `node/`
will not install anything.

## Run the model

```bash
MODEL_PATH=/path/to/model.gguf \
node node/run_inference.js "Explain what blockchain is, briefly"
```

The default token count is 128. Change it if needed:

```bash
MAX_TOKENS=256 MODEL_PATH=/path/to/model.gguf \
node node/run_inference.js "Write one sentence in Indonesian"
```

If the executable has a different name or location:

```bash
LLAMA_CLI=/path/to/llama-cli MODEL_PATH=/path/to/model.gguf \
node node/run_inference.js "Halo"
```

The model must be a GGUF file whose source, license, and hash are documented.

## Run inference with the on-chain registry

After `ModelRegistry` is active and `model-registry-deployment.json` is
available, run from the repo root:

```bash
MODEL_PATH=/path/to/model.gguf \
npm run node:inference -- "Explain blockchain in one sentence"
```

The node checks the active model version, CID, and SHA-256 before running
inference. After the output is produced, the node sends the prompt and output
hashes to the registry through `InferenceRecorded`. The prompt/answer content is
not stored on-chain.

## Serverless worker node

This worker only reads the blockchain through RPC, runs the model locally, and
sends the output back to the contract. There is no HTTP server or database.

```bash
QUORUM_DEPLOYMENT=inference-quorum-deployment.json \
MODEL_PATH=shards/model_reconstructed.gguf \
PRIVATE_KEY=0x_PRIVATE_KEY_NODE_WALLET \
START_BLOCK=BLOCK_BEFORE_REQUEST \
POLL_MS=15000 \
MAX_TOKENS=128 \
node node/worker_node.js
```

The worker reads `RequestCreated` with `eth_getLogs` per block range. Every
request matching the active model is run locally, then the output is sent to
`submitOutput(requestId, output, nonce)`. The worker reads the request's difficulty
from the chain (not a hardcoded value) and searches for the PoW nonce locally. For
exclusive-tier models the worker prints a warning that the nonce may take a very
long time. The node wallet must hold opBNB BNB for gas.

### Reward split equally among contributors

The request fee of `0.0001 BNB` is split:

```text
10% platform → `claim()` by the owner
90% miner    → split equally among all miners whose output matches,
               each calling `claimShare(requestId)`
```

A miner that submits an output different from the winning output is not entitled to
anything. Submission closes immediately once quorum is reached, so the number of
dividends is locked at the `quorum` value. There is no sweep: a miner reward that is
never claimed freezes permanently in the contract, by network design.

Miner claim command:

```bash
QUORUM_REQUEST_ID=1 node -e '
const { JsonRpcProvider, Wallet, Contract } = require("ethers");
require("dotenv").config();
const d = require("./inference-quorum-deployment.json");
const p = new JsonRpcProvider(process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
const c = new Contract(d.quorumAddress, ["function claimShare(uint256)"], new Wallet(process.env.PRIVATE_KEY, p));
c.claimShare(process.env.QUORUM_REQUEST_ID).then((t) => t.wait().then(() => console.log(t.hash)));
'
```

### Difficulty per model version

The initial difficulty value is `16` so light devices can participate. The owner or
a miner that has already submitted a valid output for that version can propose a new
value between `12` and `80`:

```solidity
proposeDifficulty(version, difficulty)
```

Three unique proposals with the same value activate that difficulty immediately;
proposals with different values cannot change it. If three matching proposals are not
reached within the 2-day window, the old difficulty is kept and
`resolveDifficulty(version)` closes the round. Values `≥ 50` are marked as an
exclusive tier by `isExclusiveTier(version)`. Difficulty is locked into the request at
the moment the request is created.

### Emergency path (anti deadlock)

If the three-proposal consensus is never reached — for example if every miner that
ever proposed disappears — difficulty could never be changed. The emergency path
closes that hole:

```solidity
proposeDifficultyEmergency(version, difficulty)  // owner or a registered miner
executeDifficulty(version)                      // anyone, after 7 days
cancelDifficultyEmergency(version)              // owner, before execution
```

```text
Owner/Miner proposes  →  wait 7 days  →  anyone executes
```

The effect: the owner cannot change difficulty alone because a delay period must
pass, but the network can never be locked forever because execution does not depend
on the owner's wallet. A second proposal while one is pending is rejected, and the
owner can cancel an unwanted proposal.

### Output must be deterministic for quorum to be reached

For several miners' outputs to be considered identical, inference must be
deterministic. A minimal `llama-cli` build that only supports `-m/-n/-ngl` uses
greedy decoding and is already deterministic. If you use a full llama.cpp build with
random sampling, set the deterministic flags so quorum can be reached:

```bash
LLAMA_TEMP=0 LLAMA_SEED=1 node node/worker_node.js
```

The requester creates a request and reads the result directly from the blockchain:

```bash
PRIVATE_KEY=0x_PRIVATE_KEY_REQUESTER \
POLL_MS=10000 \
npm run request:inference -- "Explain blockchain in one sentence"
```

The requester pays the gas for the request and finalization transactions. Prompts
and outputs are stored publicly on-chain. Set `INFERENCE_QUORUM` for the number of
identical outputs that must be received; the demo default is `1`. If quorum is not
reached by the deadline, the requester can call `refundRequest(requestId)`.

### Refund an expired request

Only the original requester can refund a request. Refund is available after the
deadline when quorum was not reached, and returns the request fee minus the refund
transaction gas:

```bash
PRIVATE_KEY=0x_PRIVATE_KEY_REQUESTER \
npm run refund:request -- 123
```

The script checks the requester address, deadline, quorum state, and refundable
balance before sending `refundRequest(123)`.

### Paid-inference miner tutorial

This is different from the public shard-9 challenge in `miner/README.md`. Paid
inference miners run the model, submit a deterministic output, and can earn BNB
when their output matches the winning quorum output.

```bash
git clone https://github.com/peterpetir123/quorix-ai
cd quorix-ai
npm install
python3 scripts/assemble_shards.py --refresh
cd miner && npm install && npm run selftest && cd ..

export RPC_URL=https://opbnb-rpc.publicnode.com
export QUORUM_DEPLOYMENT=inference-quorum-deployment.json
export MODEL_PATH=shards/model_reconstructed.gguf
export PRIVATE_KEY=0x_PRIVATE_KEY_MINER
export START_BLOCK=BLOCK_BEFORE_REQUEST
export POLL_MS=15000
export MAX_TOKENS=128
export LLAMA_TEMP=0
export LLAMA_SEED=1
node node/worker_node.js
```

The worker watches new `RequestCreated` events. It runs the prompt locally,
searches a request/output/address-bound PoW nonce, and submits the output. Only a
miner whose output hash equals the winning output can claim a share after the
request is finalized. The miner must keep enough opBNB BNB for both
`submitOutput` and `claimShare` gas.

### Gross profit versus gas

At the current fee of `0.0001 BNB`:

```text
Platform gross allocation : 10% = 0.00001 BNB
Miner pool gross allocation: 90% = 0.00009 BNB
1 matching miner           : 0.00009 BNB gross
2 matching miners          : 0.000045 BNB gross each
3 matching miners          : 0.00003 BNB gross each
```

Gross reward is not net profit. A miner pays gas for `submitOutput` and
`claimShare`, plus hardware/electricity costs. The exact net formula is:

```text
net miner result = claimed miner reward - submitOutput gas - claimShare gas
                   - hardware/electricity/model costs
```

The contract does not reimburse gas. A miner also earns nothing if its output is
not part of the winning quorum, and unclaimed rewards freeze permanently.

### Profit history dashboard

The dashboard is read-only and requires no private key. It scans public contract
events for allocations, miner claims, platform claims, and claim transaction gas:

```bash
# Default: scan the latest 500,000 blocks
npm run dashboard:profit

# Full history: set the deployment block or another explicit range
npm run dashboard:profit -- --from-block=190935345 --to-block=latest

# Show one miner's claimed history
npm run dashboard:profit -- \
  --address=0x_MINER_ADDRESS \
  --from-block=190935345

# Machine-readable JSON for a dashboard or export job
npm run dashboard:profit -- --from-block=190935345 --json
```

The dashboard reports total gross allocations, actually claimed amounts, miner
`submitOutput` and claim gas, and net after those on-chain transaction costs. With
`--address`, it also calculates that miner's eligible gross share by matching its
submitted output hash against each finalized winning output; its submissions and
claims are filtered to that wallet. It does not estimate electricity, hardware
depreciation, failed transaction gas, or inference costs. `--to-block=latest`
resolves to the current chain tip. Historical results are limited to the selected
block range; use the contract deployment block as `--from-block` for full history.

### Flow from Pinata shards

To simulate a community node fetching the model from public shards:

```bash
python3 scripts/assemble_shards.py --refresh
MODEL_PATH=shards/model_reconstructed.gguf \
  npm run node:inference -- "Explain blockchain in one sentence"
```

The reconstruction script verifies the hash of every shard and the final GGUF file
hash before inference is run.
