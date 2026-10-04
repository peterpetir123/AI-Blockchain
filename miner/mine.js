#!/usr/bin/env node
/**
 * Miner for AIShardUnlock (opBNB).
 *
 * Searches for a nonce such that keccak256(shardId, nonce) < 2^256 >> difficulty,
 * then submits it to the contract. The nonce is searched LOCALLY; only the final
 * transaction is sent.
 *
 * Usage:
 *   node mine.js --contract 0xABC...                  # sweep all locked shards
 *   node mine.js --contract 0xABC... --shard 2        # only shard 2
 *   node mine.js --selftest                           # check the nonce search logic
 *
 * Env:
 *   PRIVATE_KEY  wallet with BNB for gas (REQUIRED to submit)
 *   RPC_URL      default https://opbnb-rpc.publicnode.com
 */
const { JsonRpcProvider, Wallet, Contract, solidityPackedKeccak256, formatEther } = require("ethers");

const ABI = [
  "function shardCount() view returns (uint256)",
  "function shards(uint256) view returns (string cid, bytes32 shardHash, uint256 difficulty, bool unlocked)",
  "function submitProof(uint256 shardId, uint256 nonce)",
  "event ShardUnlocked(uint256 indexed shardId, address indexed miner, string message, string cid, bytes32 shardHash, uint256 nonce)",
];

const MAX256 = (1n << 256n) - 1n;

function targetHex(difficulty) {
  return (MAX256 >> BigInt(difficulty)).toString(16).padStart(64, "0");
}

// hex 64-char -> perbandingan string == perbandingan numerik
function findNonce(shardId, difficulty, onProgress) {
  const t = targetHex(difficulty);
  const id = BigInt(shardId);
  for (let n = 0n; ; n++) {
    const h = solidityPackedKeccak256(["uint256", "uint256"], [id, n]).slice(2);
    if (h < t) return n;
    if (onProgress && n % 100000n === 99999n) onProgress(n);
  }
}

function selftest() {
  for (const d of [8, 12, 16]) {
    const nonce = findNonce(0, d);
    const h = solidityPackedKeccak256(["uint256", "uint256"], [0n, nonce]).slice(2);
    if (!(h < targetHex(d))) throw new Error(`selftest gagal difficulty=${d}`);
    console.log(`selftest ok difficulty=${d} nonce=${nonce}`);
  }
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const address = arg("contract", process.env.CONTRACT_ADDRESS);
  if (!address) throw new Error("butuh --contract 0x... atau env CONTRACT_ADDRESS");

  const rpc = arg("rpc", process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
  const provider = new JsonRpcProvider(rpc);
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY is not set");
  const wallet = new Wallet(pk, provider);
  const contract = new Contract(address, ABI, wallet);

  const net = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  console.log(`Network  : ${net.name} (chainId ${net.chainId})`);
  console.log(`Miner    : ${wallet.address}`);
  console.log(`Balance  : ${formatEther(balance)} BNB`);
  if (balance === 0n) throw new Error("balance 0 BNB, fund it first for gas");

  const count = Number(await contract.shardCount());
  const only = arg("shard", null);
  const ids = only !== null ? [Number(only)] : [...Array(count).keys()];

  for (const id of ids) {
    const s = await contract.shards(id);
    if (s.unlocked) {
      console.log(`shard ${id}: already unlocked, skipping`);
      continue;
    }
    console.log(`shard ${id}: searching for a nonce (difficulty ${s.difficulty})...`);
    const t0 = Date.now();
    const nonce = findNonce(id, Number(s.difficulty), (n) =>
      process.stdout.write(`\r  ${n} nonces tried...`)
    );
    console.log(`\r  found nonce=${nonce} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const tx = await contract.submitProof(id, nonce);
    console.log(`  tx sent: ${tx.hash}`);
    await tx.wait();
    console.log(`  shard ${id} UNLOCKED.`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("ERROR:", e.message || e);
    process.exit(1);
  });
}

module.exports = { findNonce, targetHex };
