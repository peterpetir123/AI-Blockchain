#!/usr/bin/env node

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
require("dotenv").config();
const { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } = require("ethers");

const REGISTRY_ABI = [
  "function activeModelVersion() view returns (uint256)",
  "function models(uint256) view returns (string cid, bytes32 modelHash, string name, string format, string quantization, string runtimeVersion)",
  "function recordInference(bytes32 inputHash, bytes32 outputHash)",
];

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function sha256(path) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(path));
  return `0x${hash.digest("hex")}`;
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
      if (code !== 0) return reject(new Error(`runtime exited with code ${code}`));
      resolve(output.trim());
    });
  });
}

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) throw new Error('Usage: node node/run_registry_inference.js "prompt"');

  const deploymentPath = process.env.REGISTRY_DEPLOYMENT || "model-registry-deployment.json";
  const manifestPath = process.env.MODEL_MANIFEST || "model/manifest.json";
  const modelPath = process.env.MODEL_PATH;
  const privateKey = process.env.PRIVATE_KEY;
  if (!modelPath) throw new Error("MODEL_PATH is not set");
  if (!privateKey) throw new Error("PRIVATE_KEY is not set");
  if (!fs.existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);

  const deployment = readJson(deploymentPath);
  const manifest = readJson(manifestPath);
  const provider = new JsonRpcProvider(process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
  const wallet = new Wallet(privateKey, provider);
  const registry = new Contract(deployment.registryAddress, REGISTRY_ABI, wallet);

  const version = await registry.activeModelVersion();
  if (version === 0n) throw new Error("No active model yet");
  const model = await registry.models(version);
  const localHash = sha256(modelPath);

  if (localHash.toLowerCase() !== model.modelHash.toLowerCase()) {
    throw new Error(`Model hash mismatch. Local ${localHash}, on-chain ${model.modelHash}`);
  }
  if (manifest.cid !== model.cid) throw new Error("Manifest CID differs from the on-chain CID");
  if (manifest.sha256.toLowerCase() !== localHash.toLowerCase()) {
    throw new Error("Manifest hash differs from the local model file");
  }

  console.log(`Active model: v${version} ${model.name} (${model.quantization})`);
  console.log(`Node      : ${wallet.address}`);
  const output = await runModel(
    process.env.LLAMA_CLI || "llama-cli",
    modelPath,
    prompt,
    Number(process.env.MAX_TOKENS || 128)
  );
  const inputHash = keccak256(toUtf8Bytes(prompt));
  const outputHash = keccak256(toUtf8Bytes(output));
  console.log("\nAI output:\n" + output);
  console.log(`\nInput hash : ${inputHash}`);
  console.log(`Output hash: ${outputHash}`);

  const tx = await registry.recordInference(inputHash, outputHash);
  await tx.wait();
  console.log(`InferenceRecorded tx: ${tx.hash}`);
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
