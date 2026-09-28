const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("Jaringan:", network.name, `(chainId ${network.chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Saldo   :", ethers.formatEther(balance), Number(network.chainId) === 97 ? "tBNB" : "BNB");

  if (balance === 0n) {
    throw new Error("Saldo 0. Isi token gas jaringan target sebelum deploy.");
  }

  const factory = await ethers.getContractFactory("ModelRegistry");
  const registry = await factory.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  const deploymentPath = "model-registry-deployment.json";
  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(
      {
        network: network.name,
        chainId: Number(network.chainId),
        registryAddress: address,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("MODEL_REGISTRY_ADDRESS =", address);
  console.log("Disimpan ke", deploymentPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
