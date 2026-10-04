const fs = require("fs");
const { ethers } = require("hardhat");

const REGISTRY_ABI = [
  "function registerModel(string cid, bytes32 modelHash, string name, string format, string quantization, string runtimeVersion) returns (uint256)",
  "function activateModel(uint256 version)",
  "event ModelRegistered(uint256 indexed version, bytes32 indexed modelHash, string cid, string name, string format, string quantization, string runtimeVersion)",
];

function loadManifest() {
  const path = process.env.MODEL_MANIFEST || "model/manifest.json";
  if (!fs.existsSync(path)) {
    throw new Error(`Manifest tidak ditemukan: ${path}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  const required = [
    "name",
    "version",
    "cid",
    "sha256",
    "format",
    "quantization",
    "runtimeVersion",
  ];
  for (const field of required) {
    if (!manifest[field]) throw new Error(`Field manifest kosong: ${field}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(manifest.sha256)) {
    throw new Error("sha256 must be bytes32 hex in the format 0x + 64 hex characters");
  }
  if (
    manifest.cid.includes("REPLACE") ||
    !/^(bafy|Qm)[a-zA-Z0-9]+$/.test(manifest.cid)
  ) {
    throw new Error("the model cid appears not to be filled in with a valid IPFS CID");
  }
  return { path, manifest };
}

async function main() {
  const deploymentPath = process.env.REGISTRY_DEPLOYMENT || "model-registry-deployment.json";
  if (process.env.ACTIVATE_VERSION) {
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(`Deployment registry tidak ditemukan: ${deploymentPath}`);
    }
    const version = Number(process.env.ACTIVATE_VERSION);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("ACTIVATE_VERSION must be a positive version number");
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const registry = new ethers.Contract(
      deployment.registryAddress,
      REGISTRY_ABI,
      (await ethers.getSigners())[0]
    );
    const tx = await registry.activateModel(version);
    await tx.wait();
    console.log(`Model version ${version} active`);
    console.log(`Transaction: ${tx.hash}`);
    return;
  }

  const { path, manifest } = loadManifest();
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment registry tidak ditemukan: ${deploymentPath}`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const registry = new ethers.Contract(deployment.registryAddress, REGISTRY_ABI, (await ethers.getSigners())[0]);

  console.log(`Manifest: ${path}`);
  console.log(`Registry: ${deployment.registryAddress}`);
  console.log(`Model   : ${manifest.name} ${manifest.version}`);

  const tx = await registry.registerModel(
    manifest.cid,
    manifest.sha256,
    manifest.name,
    manifest.format,
    manifest.quantization,
    manifest.runtimeVersion
  );
  const receipt = await tx.wait();
  const registered = receipt.logs
    .map((log) => {
      try {
        return registry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "ModelRegistered");

  if (!registered) throw new Error("ModelRegistered event not found");
  const version = registered.args.version;
  console.log(`Model registered as version ${version}`);

  if (process.env.ACTIVATE_MODEL === "true") {
    const activationTx = await registry.activateModel(version);
    await activationTx.wait();
    console.log(`Model version ${version} active`);
  } else {
    console.log("Model not activated yet. Set ACTIVATE_MODEL=true once it has been reviewed.");
  }
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
