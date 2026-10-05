#!/usr/bin/env node

require("dotenv").config();
const fs = require("node:fs");
const { Contract, JsonRpcProvider, Wallet, formatEther } = require("ethers");

const ABI = [
  "function requests(uint256) view returns (uint256 modelVersion,string prompt,bytes32 inputHash,uint256 quorum,uint256 deadline,uint256 difficulty,address requester,uint256 fee,uint256 minerShare,bool finalized,bool refunded,bytes32 winningOutput,uint256 winningCount)",
  "function refundRequest(uint256 requestId)",
];

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  const requestId = process.argv[2];
  if (!requestId || !/^\d+$/.test(requestId)) {
    throw new Error("Usage: npm run refund:request -- <requestId>");
  }

  const deploymentPath = process.env.QUORUM_DEPLOYMENT || "inference-quorum-deployment.json";
  const deployment = readJson(deploymentPath);
  const provider = new JsonRpcProvider(process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("requester PRIVATE_KEY is not set");

  const wallet = new Wallet(privateKey, provider);
  const contract = new Contract(deployment.quorumAddress, ABI, wallet);
  const request = await contract.requests(requestId);
  const latestBlock = await provider.getBlock("latest");
  const now = BigInt(latestBlock.timestamp);

  if (request.requester.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Only the requester can refund this request. Requester: ${request.requester}`);
  }
  if (request.finalized || request.refunded || request.winningOutput !== `0x${"00".repeat(32)}`) {
    throw new Error("This request is already finalized, refunded, or has reached quorum");
  }
  if (now < request.deadline) {
    throw new Error(`Deadline has not passed yet. Unix deadline: ${request.deadline}`);
  }
  if (request.fee === 0n) throw new Error("This request has no refundable fee");

  console.log(`Requester : ${wallet.address}`);
  console.log(`Contract  : ${deployment.quorumAddress}`);
  console.log(`Request   : ${requestId}`);
  console.log(`Refund    : ${formatEther(request.fee)} BNB (minus gas)`);

  const tx = await contract.refundRequest(requestId);
  console.log(`Refund tx : ${tx.hash}`);
  await tx.wait();
  console.log("Refund complete.");
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
