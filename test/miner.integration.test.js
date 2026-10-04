const { expect } = require("chai");
const { ethers } = require("hardhat");
const { findNonce } = require("../miner/mine.js");

/**
 * Cross-component test: a nonce produced by the miner MUST be accepted by on-chain validation.
 * If this passes, the proof conditions in the miner and in the contract are identical.
 */
describe("miner <-> contract integration", function () {
  it("a nonce from mine.js is accepted by submitProof across difficulties", async function () {
    const [owner, miner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AIShardUnlock");
    const contract = await factory.deploy();

    for (const difficulty of [8, 12]) {
      await contract.addShard("cid", ethers.ZeroHash, difficulty, `msg-${difficulty}`);
      const shardId = Number(await contract.shardCount()) - 1;

      const nonce = findNonce(shardId, difficulty);
      await expect(
        contract.connect(miner).submitProof(shardId, nonce)
      ).to.emit(contract, "ShardUnlocked");

      expect(await contract.isUnlocked(shardId)).to.equal(true);
    }
  });

  it("nonce+1 (invalid) is rejected", async function () {
    const [owner, miner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AIShardUnlock");
    const contract = await factory.deploy();

    await contract.addShard("cid", ethers.ZeroHash, 16, "msg");
    const nonce = findNonce(0, 16);

    await expect(
      contract.connect(miner).submitProof(0, nonce + 1n)
    ).to.be.revertedWithCustomError(contract, "InvalidProof");
  });
});
