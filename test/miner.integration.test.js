const { expect } = require("chai");
const { ethers } = require("hardhat");
const { findNonce } = require("../miner/mine.js");

/**
 * Test lintas-komponen: nonce hasil miner HARUS diterima validasi on-chain.
 * Kalau ini lulus, syarat proof di miner dan di contract identik.
 */
describe("Integrasi miner <-> contract", function () {
  it("nonce dari mine.js diterima submitProof untuk berbagai difficulty", async function () {
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

  it("nonce+1 (tidak valid) ditolak", async function () {
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
