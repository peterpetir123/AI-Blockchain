const { ethers } = require("hardhat");

async function main() {
  const expectedChainId = 97n;
  const network = await ethers.provider.getNetwork();

  if (network.chainId !== expectedChainId) {
    throw new Error(
      `Jaringan salah: chainId ${network.chainId}. Jalankan dengan --network bscTestnet.`
    );
  }

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("TESTNET_PRIVATE_KEY belum diisi di .env.");
  }
  const [wallet] = signers;
  const balance = await ethers.provider.getBalance(wallet.address);

  console.log("Jaringan:", network.name, `(chainId ${network.chainId})`);
  console.log("Alamat :", wallet.address);
  console.log("Saldo  :", ethers.formatEther(balance), "tBNB");
  console.log(balance > 0n ? "Status : siap untuk deploy testnet" : "Status : perlu tBNB dari faucet");
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
