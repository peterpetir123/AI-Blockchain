const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const manifestPath = "manifest.json";
  if (!fs.existsSync(manifestPath)) {
    throw new Error("manifest.json tidak ada. Jalankan scripts/shard_pipeline.py dulu.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const deployment = JSON.parse(fs.readFileSync("deployment.json", "utf8"));

  const contract = await ethers.getContractAt(
    "AIShardUnlock",
    deployment.contractAddress
  );

  const before = await contract.shardCount();
  console.log(`shardCount sebelum: ${before}`);

  for (const s of manifest) {
    if (!s.cid) {
      console.log(`skip shard ${s.shardId} (cid kosong)`);
      continue;
    }
    const tx = await contract.addShard(
      s.cid,
      s.sha256,
      s.difficulty ?? 20,
      s.message ?? `Shard ${s.shardId} terbuka.`
    );
    await tx.wait();
    console.log(`addShard(${s.shardId}) -> tx ${tx.hash}`);
  }

  const after = await contract.shardCount();
  console.log(`shardCount sesudah: ${after}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
