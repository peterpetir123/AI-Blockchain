#!/usr/bin/env node
/**
 * Baca pesan AI dari event ShardUnlocked on-chain. Read-only, tanpa private key.
 *
 *   node scripts/read_messages.js --contract 0x... [--from 0] [--to latest]
 *
 * Env: RPC_URL (default https://opbnb-rpc.publicnode.com), CONTRACT_ADDRESS
 */
const { JsonRpcProvider, Contract, id } = require("ethers");

const TOPIC = id("ShardUnlocked(uint256,address,string,string,bytes32,uint256)");
const ABI = [
  "event ShardUnlocked(uint256 indexed shardId, address indexed miner, string message, string cid, bytes32 shardHash, uint256 nonce)",
];

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const address = arg("contract", process.env.CONTRACT_ADDRESS);
  if (!address) throw new Error("butuh --contract 0x... atau env CONTRACT_ADDRESS");

  const provider = new JsonRpcProvider(
    arg("rpc", process.env.RPC_URL || "https://opbnb-rpc.publicnode.com")
  );
  const contract = new Contract(address, ABI, provider);

  const to = arg("to", "latest");
  const latest = to === "latest" ? await provider.getBlockNumber() : Number(to);
  const from = Number(arg("from", Math.max(0, latest - 50000)));

  const logs = await contract.queryFilter("ShardUnlocked", from, latest);
  if (logs.length === 0) {
    console.log(`Tidak ada ShardUnlocked di blok ${from}..${latest}`);
    return;
  }
  console.log(`${logs.length} pesan AI ditemukan:\n`);
  for (const l of logs) {
    const a = l.args;
    console.log(`# shard ${a.shardId} | miner ${a.miner} | blok ${l.blockNumber}`);
    console.log(`  "${a.message}"`);
    console.log(`  cid: ${a.cid}\n`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
