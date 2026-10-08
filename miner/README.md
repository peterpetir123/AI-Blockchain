# Quorix AI Shard Miner

Searches for a nonce to unlock an AI shard on the `AIShardUnlock` contract (opBNB).
The nonce is searched **locally**; only the final transaction is sent to the network.

## Requirements
- Node.js 18+
- A wallet with a small amount of **BNB** for gas (on opBNB ~0.00000002 BNB per tx)

## Usage
```bash
npm install
export PRIVATE_KEY=0x...            # your wallet
node mine.js --contract 0xCONTRACT   # sweep all locked shards
node mine.js --contract 0xCONTRACT --shard 2   # only a specific shard
node mine.js --selftest              # check the logic without network
```

## Public opBNB demo

This demo gives no reward. A miner only finds a valid nonce and sends a single
unlock transaction; whoever submits a valid proof first will unlock that shard.

```bash
git clone https://github.com/peterpetir123/AI-Blockchain
cd AI-Blockchain/miner
npm install
npm run selftest

export PRIVATE_KEY=0xPRIVATE_KEY_WALLET_YOUR_OWN
export RPC_URL=https://opbnb-rpc.publicnode.com
node mine.js \
  --contract 0x8D34729c9802F388b88e18f34B23EEb8fA9B859b \
  --shard 9
```

The miner wallet needs a small amount of real BNB on opBNB for gas. Never use the
deployer private key, and never share your private key with anyone else.

If shard 8 has already been unlocked by another miner, the program will fail or
find it already unlocked. That is normal for a competitive challenge.

Shard `8` was unlocked during test transactions. The active public challenge is
shard `9`; whoever submits a valid proof first will unlock it.

Optional env vars: `RPC_URL` (default `https://opbnb-rpc.publicnode.com`),
`CONTRACT_ADDRESS` (so you don't need `--contract`).

## How it works
A proof is valid when:

```
keccak256(abi.encodePacked(shardId, nonce)) < 2^256 >> difficulty
```

The higher the `difficulty`, the more nonces must be tried (2^difficulty on average).
`difficulty 20` ≈ 1 million attempts; raise/lower it as the shard creator sees fit.

## Notes
Shard encryption is **narrative** — shards are public on IPFS. The unlock here
drives an on-chain narrative/message, it does not open a cryptographic secret.
