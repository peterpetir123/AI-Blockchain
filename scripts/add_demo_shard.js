const { ethers } = require("hardhat");

const DEMO = {
  cid: "QmTfyZqx1bpoKs3ow5YWiyUcKkcMdCXkTbDHAhmSBUoeph",
  hash: "0x4f0295ce1b3c6fe016687774e720aea0ca351e02db5d68137f4249c3ef77f78d",
  difficulty: 16,
  message: "Demo public: temukan nonce dan buka shard ini.",
};

async function main() {
  const deployment = require("../deployment.json");
  const [owner] = await ethers.getSigners();
  const contract = await ethers.getContractAt(
    "AIShardUnlock",
    deployment.contractAddress
  );
  const shardId = await contract.shardCount();

  console.log("Network : opBNB mainnet");
  console.log("Owner   :", owner.address);
  console.log("Shard ID:", shardId.toString());
  console.log("CID     :", DEMO.cid);
  console.log("Difficulty:", DEMO.difficulty);

  const tx = await contract.addShard(
    DEMO.cid,
    DEMO.hash,
    DEMO.difficulty,
    DEMO.message
  );
  await tx.wait();
  console.log("tx      :", tx.hash);
  console.log("Explorer: https://opbnb.bscscan.com/tx/" + tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
