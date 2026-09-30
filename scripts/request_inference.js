#!/usr/bin/env node

require("dotenv").config();
const fs = require("node:fs");
const {
  Contract,
  JsonRpcProvider,
  Wallet,
  keccak256,
  toUtf8Bytes,
} = require("ethers");

const QUORUM_ABI = [
  "function createRequest(uint256 modelVersion,string prompt,uint256 quorum,uint256 deadline) returns (uint256)",
  "function requestCount() view returns (uint256)",
  "function requests(uint256) view returns (uint256 modelVersion,string prompt,bytes32 inputHash,uint256 quorum,uint256 deadline,bool finalized,bytes32 winningOutput,uint256 winningCount)",
  "function outputText(uint256,bytes32) view returns (string)",
  "function finalize(uint256)",
  "function isVerified(uint256) view returns (bool)",
  "event RequestCreated(uint256 indexed requestId,uint256 indexed modelVersion,bytes32 inputHash,uint256 quorum,uint256 deadline)",
];
const REGISTRY_ABI = [
  "function activeModelVersion() view returns (uint256)",
];

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    throw new Error('Pakai: npm run request:inference -- "prompt"');
  }

  const deploymentPath = process.env.QUORUM_DEPLOYMENT || "inference-quorum-deployment.json";
  const deployment = readJson(deploymentPath);
  const provider = new JsonRpcProvider(process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY requester belum di-set");
  const wallet = new Wallet(privateKey, provider);
  const quorumContract = new Contract(deployment.quorumAddress, QUORUM_ABI, wallet);
  const registry = new Contract(deployment.modelRegistryAddress, REGISTRY_ABI, provider);

  const quorum = BigInt(process.env.INFERENCE_QUORUM || "1");
  const requestFee = BigInt(process.env.REQUEST_FEE_WEI || (await quorumContract.requestFee()));
  const timeoutSeconds = BigInt(process.env.REQUEST_TIMEOUT_SECONDS || "1800");
  const pollMs = Number(process.env.POLL_MS || "10000");
  if (quorum < 1n || timeoutSeconds < 1n || !Number.isSafeInteger(pollMs) || pollMs < 1000) {
    throw new Error("INFERENCE_QUORUM, REQUEST_TIMEOUT_SECONDS, atau POLL_MS tidak valid");
  }

  const modelVersion = await registry.activeModelVersion();
  if (modelVersion === 0n) throw new Error("ModelRegistry belum memiliki model aktif");
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + timeoutSeconds;
  const inputHash = keccak256(toUtf8Bytes(prompt));

  console.log(`Requester : ${wallet.address}`);
  console.log(`Contract  : ${deployment.quorumAddress}`);
  console.log(`Model     : v${modelVersion}`);
  console.log(`Quorum    : ${quorum}`);
  console.log(`Input hash: ${inputHash}`);

  const tx = await quorumContract.createRequest(modelVersion, prompt, quorum, deadline, { value: requestFee });
  console.log(`Create tx : ${tx.hash}`);
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((log) => {
      try { return quorumContract.interface.parseLog(log); } catch { return null; }
    })
    .find((parsed) => parsed?.name === "RequestCreated");
  if (!event) throw new Error("RequestCreated tidak ditemukan dalam receipt");

  const requestId = event.args.requestId;
  console.log(`Request ID: ${requestId}`);
  console.log("Menunggu kuorum...");

  while (true) {
    const request = await quorumContract.requests(requestId);
    if (request.winningOutput !== `0x${"00".repeat(32)}`) break;
    if (BigInt(Math.floor(Date.now() / 1000)) >= deadline) {
      throw new Error(`Request ${requestId} timeout sebelum quorum tercapai`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const finalizeTx = await quorumContract.finalize(requestId);
  console.log(`Finalize tx: ${finalizeTx.hash}`);
  await finalizeTx.wait();
  if (!(await quorumContract.isVerified(requestId))) {
    throw new Error(`Request ${requestId} belum terverifikasi`);
  }

  const request = await quorumContract.requests(requestId);
  const output = await quorumContract.outputText(requestId, request.winningOutput);
  console.log(`\nOutput (request ${requestId}, ${request.winningCount} suara):\n${output}`);
  console.log(`Output hash: ${request.winningOutput}`);
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
