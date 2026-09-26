const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  const nativeSymbol = Number(net.chainId) === 5611 ? "tBNB" : "BNB";

  console.log("Jaringan    :", net.name, `(chainId ${net.chainId})`);
  console.log("Deployer    :", deployer.address);
  console.log("Saldo       :", ethers.formatEther(balance), nativeSymbol);

  if (balance === 0n) {
    console.error(
      `\nSaldo 0. Isi ${nativeSymbol} ke alamat di atas untuk biaya gas.`
    );
    process.exit(1);
  }

  const factory = await ethers.getContractFactory("AIShardUnlock");
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const topic = ethers.id(
    "ShardUnlocked(uint256,address,string,string,bytes32,uint256)"
  );

  console.log("\n=== SIMPAN NILAI INI ===");
  console.log("CONTRACT_ADDRESS      =", address);
  console.log("SHARD_UNLOCKED_TOPIC  =", topic);
  console.log("========================\n");

  const fs = require("fs");
  fs.writeFileSync(
    "deployment.json",
    JSON.stringify(
      {
        network: net.name,
        chainId: Number(net.chainId),
        contractAddress: address,
        shardUnlockedTopic: topic,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log("Disimpan ke deployment.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
