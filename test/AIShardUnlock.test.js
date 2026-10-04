const { expect } = require("chai");
const { ethers } = require("hardhat");

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const SHARD_HASH = ethers.keccak256(ethers.toUtf8Bytes("shard-0"));
const MESSAGE = "Peter Petir created me. Shard 0 unlocked.";
const DIFFICULTY = 8;

function target(difficulty) {
  return (2n ** 256n - 1n) >> BigInt(difficulty);
}

function findNonce(shardId, difficulty) {
  const t = target(difficulty);
  for (let n = 0n; ; n++) {
    const h = BigInt(
      ethers.solidityPackedKeccak256(["uint256", "uint256"], [shardId, n])
    );
    if (h < t) return n;
  }
}

async function deployFixture() {
  const [owner, miner, other] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("AIShardUnlock");
  const contract = await factory.deploy();
  return { contract, owner, miner, other };
}

describe("AIShardUnlock", function () {
  it("only the owner can add a shard", async function () {
    const { contract, other } = await deployFixture();
    await expect(
      contract.connect(other).addShard(CID, SHARD_HASH, DIFFICULTY, MESSAGE)
    ).to.be.revertedWithCustomError(contract, "NotOwner");
  });

  it("adds a shard and increments shardCount", async function () {
    const { contract } = await deployFixture();
    await contract.addShard(CID, SHARD_HASH, DIFFICULTY, MESSAGE);

    expect(await contract.shardCount()).to.equal(1n);
    const s = await contract.shards(0);
    expect(s.cid).to.equal(CID);
    expect(s.shardHash).to.equal(SHARD_HASH);
    expect(s.difficulty).to.equal(BigInt(DIFFICULTY));
    expect(s.unlocked).to.equal(false);
    expect(await contract.shardMessage(0)).to.equal(MESSAGE);
  });

  it("a valid proof unlocks the shard and emits an AI message", async function () {
    const { contract, miner } = await deployFixture();
    await contract.addShard(CID, SHARD_HASH, DIFFICULTY, MESSAGE);

    const nonce = findNonce(0, DIFFICULTY);
    await expect(contract.connect(miner).submitProof(0, nonce))
      .to.emit(contract, "ShardUnlocked")
      .withArgs(0, miner.address, MESSAGE, CID, SHARD_HASH, nonce);

    expect(await contract.isUnlocked(0)).to.equal(true);
  });

  it("an invalid proof reverts with InvalidProof", async function () {
    const { contract, miner } = await deployFixture();
    await contract.addShard(CID, SHARD_HASH, 16, MESSAGE);

    const badNonce = findNonce(0, 16) + 1n;
    await expect(
      contract.connect(miner).submitProof(0, badNonce)
    ).to.be.revertedWithCustomError(contract, "InvalidProof");
  });

  it("a shard cannot be unlocked twice", async function () {
    const { contract, miner } = await deployFixture();
    await contract.addShard(CID, SHARD_HASH, DIFFICULTY, MESSAGE);

    const nonce = findNonce(0, DIFFICULTY);
    await contract.connect(miner).submitProof(0, nonce);

    await expect(
      contract.connect(miner).submitProof(0, nonce)
    ).to.be.revertedWithCustomError(contract, "AlreadyUnlocked");
  });

  it("an unknown shard reverts with UnknownShard", async function () {
    const { contract, miner } = await deployFixture();
    await expect(
      contract.connect(miner).submitProof(99, 0)
    ).to.be.revertedWithCustomError(contract, "UnknownShard");
  });
});
