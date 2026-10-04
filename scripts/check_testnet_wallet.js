const { ethers } = require("hardhat");

async function main() {
  const expectedChainId = 97n;
  const network = await ethers.provider.getNetwork();

  if (network.chainId !== expectedChainId) {
    throw new Error(
      `Wrong network: chainId ${network.chainId}. Run with --network bscTestnet.`
    );
  }

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("TESTNET_PRIVATE_KEY is not set in .env.");
  }
  const [wallet] = signers;
  const balance = await ethers.provider.getBalance(wallet.address);

  console.log("Network:", network.name, `(chainId ${network.chainId})`);
  console.log("Address:", wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "tBNB");
  console.log(balance > 0n ? "Status : ready for testnet deploy" : "Status : needs tBNB from the faucet");
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
