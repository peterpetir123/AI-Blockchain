const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);
  const registryAddress = process.env.MODEL_REGISTRY_ADDRESS;

  if (!registryAddress || !ethers.isAddress(registryAddress)) {
    throw new Error(
      "MODEL_REGISTRY_ADDRESS harus berisi address ModelRegistry pada network target"
    );
  }

  console.log("Jaringan :", network.name, `(chainId ${network.chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Saldo   :", ethers.formatEther(balance));
  console.log("Registry:", registryAddress);

  if (balance === 0n) {
    throw new Error("Saldo 0. Isi token gas network target sebelum deploy.");
  }

  const factory = await ethers.getContractFactory("InferenceQuorum");
  const quorum = await factory.deploy(registryAddress);
  await quorum.waitForDeployment();
  const quorumAddress = await quorum.getAddress();

  const outputPath =
    process.env.INFERENCE_QUORUM_DEPLOYMENT ||
    "inference-quorum-deployment.json";
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        network: network.name,
        chainId: Number(network.chainId),
        quorumAddress,
        modelRegistryAddress: registryAddress,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("INFERENCE_QUORUM_ADDRESS =", quorumAddress);
  console.log("Disimpan ke", outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
