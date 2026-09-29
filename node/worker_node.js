#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
require("dotenv").config();
const { Contract, JsonRpcProvider, Wallet } = require("ethers");

const ABI = [
  "function requestCount() view returns (uint256)",
  "function modelRegistry() view returns (address)",
  "function requests(uint256) view returns (uint256 modelVersion, string prompt, bytes32 inputHash, uint256 quorum, uint256 deadline, bool finalized, bytes32 winningOutput, uint256 winningCount)",
  "function submitOutput(uint256 requestId, string output)",
  "event RequestCreated(uint256 indexed requestId, uint256 indexed modelVersion, bytes32 inputHash, uint256 quorum, uint256 deadline)",
];

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function runModel(cli, modelPath, prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ["-m", modelPath, "-n", String(maxTokens), prompt], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) return reject(new Error(`runtime dihentikan oleh ${signal}`));
      if (code !== 0) return reject(new Error(`runtime keluar dengan kode ${code}`));
      resolve(output.trim());
    });
  });
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} tidak valid`);
  return value;
}

async function main() {
  const deploymentPath = process.env.QUORUM_DEPLOYMENT || "inference-quorum-deployment.json";
  const modelPath = process.env.MODEL_PATH;
  const privateKey = process.env.PRIVATE_KEY;
  if (!modelPath) throw new Error("MODEL_PATH belum di-set");
  if (!privateKey) throw new Error("PRIVATE_KEY belum di-set");
  if (!fs.existsSync(modelPath)) throw new Error(`Model tidak ditemukan: ${modelPath}`);

  const deployment = readJson(deploymentPath);
  const provider = new JsonRpcProvider(process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
  const wallet = new Wallet(privateKey, provider);
  const contract = new Contract(deployment.quorumAddress, ABI, wallet);
  const registry = new Contract(
    deployment.modelRegistryAddress,
    ["function activeModelVersion() view returns (uint256)"],
    provider
  );
  const startBlock = numberEnv("START_BLOCK", Math.max(0, (await provider.getBlockNumber()) - 1000));
  const pollMs = numberEnv("POLL_MS", 15000);
  const maxTokens = numberEnv("MAX_TOKENS", 128);
  const chunkSize = numberEnv("BLOCK_CHUNK", 1000) || 1000;
  let nextBlock = startBlock;
  const processed = new Set();

  console.log(`Worker : ${wallet.address}`);
  console.log(`Quorum : ${deployment.quorumAddress}`);
  console.log(`Start  : block ${startBlock}`);
  console.log(`Model  : ${modelPath}`);

  while (true) {
    const latest = await provider.getBlockNumber();
    while (nextBlock <= latest) {
      const endBlock = Math.min(nextBlock + chunkSize - 1, latest);
      const logs = await contract.queryFilter(contract.filters.RequestCreated(), nextBlock, endBlock);
      for (const log of logs) {
        const requestId = log.args.requestId.toString();
        if (processed.has(requestId)) continue;
        processed.add(requestId);
        const request = await contract.requests(requestId);
        if (request.finalized || request.deadline <= BigInt(Math.floor(Date.now() / 1000))) continue;
        if (request.modelVersion !== await registry.activeModelVersion()) continue;

        console.log(`request ${requestId}: menjalankan inference`);
        const output = await runModel(
          process.env.LLAMA_CLI || "llama-cli",
          modelPath,
          request.prompt,
          maxTokens
        );
        const tx = await contract.submitOutput(requestId, output);
        console.log(`request ${requestId}: tx ${tx.hash}`);
        await tx.wait();
        console.log(`request ${requestId}: output terkirim`);
      }
      nextBlock = endBlock + 1;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
