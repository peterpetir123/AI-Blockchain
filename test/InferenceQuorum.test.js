const { expect } = require("chai");
const { ethers } = require("hardhat");

function findClaimNonce(requestId, output, miner, difficulty = 16) {
  const outputHash = ethers.keccak256(ethers.toUtf8Bytes(output));
  const target = ethers.MaxUint256 >> BigInt(difficulty);
  for (let nonce = 0n; ; nonce++) {
    const proof = ethers.solidityPackedKeccak256(
      ["uint256", "bytes32", "address", "uint256"],
      [requestId, outputHash, miner, nonce]
    );
    if (BigInt(proof) < target) return nonce;
  }
}

const MODEL = {
  cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  hash: ethers.keccak256(ethers.toUtf8Bytes("model-file")),
  name: "Qwen2.5-0.5B-Instruct",
  format: "GGUF",
  quantization: "Q4_K_M",
  runtime: "llama.cpp",
};

async function deploy() {
  const [owner, node, other] = await ethers.getSigners();
  const registry = await ethers.deployContract("ModelRegistry");
  await registry.waitForDeployment();
  await registry.registerModel(
    MODEL.cid,
    MODEL.hash,
    MODEL.name,
    MODEL.format,
    MODEL.quantization,
    MODEL.runtime
  );
  await registry.activateModel(1);

  const quorum = await ethers.deployContract("InferenceQuorum", [
    await registry.getAddress(),
    1000n,
  ]);
  await quorum.waitForDeployment();
  return { owner, node, other, registry, quorum };
}

describe("InferenceQuorum createRequest", function () {
  it("creates a request for the active model and emits its event", async function () {
    const { quorum } = await deploy();
    const prompt = "Jelaskan blockchain.";
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes(prompt));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await expect(quorum.createRequest(1, prompt, 2, deadline, { value: 1000n }))
      .to.emit(quorum, "RequestCreated")
      .withArgs(1, 1, inputHash, 2, deadline, 16);

    const request = await quorum.requests(1);
    expect(request.modelVersion).to.equal(1n);
    expect(request.prompt).to.equal(prompt);
    expect(request.inputHash).to.equal(inputHash);
    expect(request.quorum).to.equal(2n);
    expect(request.deadline).to.equal(BigInt(deadline));
    expect(await quorum.requestCount()).to.equal(1n);
  });

  it("allows any requester to create a request", async function () {
    const { quorum, node } = await deploy();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const prompt = "prompt";

    await expect(quorum.connect(node).createRequest(1, prompt, 2, deadline, { value: 1000n }))
      .to.emit(quorum, "RequestCreated")
      .withArgs(1, 1, ethers.keccak256(ethers.toUtf8Bytes(prompt)), 2, deadline, 16);
  });

  it("rejects inactive versions, empty hashes, zero quorum, and expired deadlines", async function () {
    const { quorum } = await deploy();
    const prompt = "prompt";
    const future = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await expect(
      quorum.createRequest(2, prompt, 2, future, { value: 1000n })
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, "", 2, future, { value: 1000n })
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, prompt, 0, future, { value: 1000n })
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, prompt, 2, 1, { value: 1000n })
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
  });
});

describe("InferenceQuorum submitOutput", function () {
  async function createRequest(quorum = 2) {
    const deployed = await deploy();
    const prompt = "prompt";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(1, prompt, quorum, deadline, { value: 1000n });
    return { ...deployed, deadline };
  }

  it("records one submission per node and updates tally", async function () {
    const { quorum, node } = await createRequest();
    const output = "Blockchain is a digital ledger.";
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes(output));

    const nonce = findClaimNonce(1, output, node.address);
    await expect(quorum.connect(node).submitOutput(1, output, nonce))
      .to.emit(quorum, "OutputSubmitted")
      .withArgs(1, node.address, outputHash);

    expect(await quorum.submissions(1, node.address)).to.equal(outputHash);
    expect(await quorum.minerOfVersion(1, node.address)).to.equal(true);
    expect(await quorum.tally(1, outputHash)).to.equal(1n);
    expect(await quorum.outputText(1, outputHash)).to.equal(output);
    expect((await quorum.requests(1)).difficulty).to.equal(16n);
  });

  it("emits QuorumReached when tally reaches quorum", async function () {
    const { quorum, node } = await createRequest(1);
    const output = "answer";
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes(output));

    const nonce = findClaimNonce(1, output, node.address);
    await expect(quorum.connect(node).submitOutput(1, output, nonce))
      .to.emit(quorum, "QuorumReached")
      .withArgs(1, outputHash, 1);
  });

  it("rejects duplicate, empty, unknown, and closed submissions", async function () {
    const { quorum, node, owner, deadline } = await createRequest();
    const output = "answer";

    const nonce = findClaimNonce(1, output, node.address);
    await quorum.connect(node).submitOutput(1, output, nonce);
    await expect(
      quorum.connect(node).submitOutput(1, output, nonce)
    ).to.be.revertedWithCustomError(quorum, "AlreadySubmitted");
    await expect(
      quorum.connect(owner).submitOutput(1, "", 0)
    ).to.be.revertedWithCustomError(quorum, "InvalidOutput");
    await expect(
      quorum.connect(owner).submitOutput(99, output, 0)
    ).to.be.revertedWithCustomError(quorum, "UnknownRequest");

    await ethers.provider.send("evm_setNextBlockTimestamp", [deadline]);
    await ethers.provider.send("evm_mine");
    await expect(
      quorum.connect(owner).submitOutput(1, output, 0)
    ).to.be.revertedWithCustomError(quorum, "RequestClosed");
  });

  it("rejects a claim with an invalid bound nonce", async function () {
    const { quorum, node } = await createRequest(1);
    await expect(
      quorum.connect(node).submitOutput(1, "answer", 0)
    ).to.be.revertedWithCustomError(quorum, "InvalidProof");
  });

  it("closes submissions as soon as quorum is reached", async function () {
    const { quorum, node, other } = await createRequest(1);
    const output = "winner";
    const nonce = findClaimNonce(1, output, node.address);
    await quorum.connect(node).submitOutput(1, output, nonce);
    await expect(
      quorum.connect(other).submitOutput(1, output, findClaimNonce(1, output, other.address))
    ).to.be.revertedWithCustomError(quorum, "RequestClosed");
  });
});

describe("InferenceQuorum finalize", function () {
  it("runs requester -> worker -> finalize -> read-output locally", async function () {
    const { quorum, node, other } = await deploy();
    const prompt = "Jelaskan blockchain.";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await quorum.connect(other).createRequest(1, prompt, 1, deadline, { value: 1000n });
    const output = "Blockchain is a distributed ledger.";
    const nonce = findClaimNonce(1, output, node.address);
    await quorum.connect(node).submitOutput(1, output, nonce);
    await quorum.connect(other).finalize(1);

    const request = await quorum.requests(1);
    expect(await quorum.isVerified(1)).to.equal(true);
    expect(await quorum.outputText(1, request.winningOutput)).to.equal(output);
  });

  it("splits miner reward equally among matching quorum contributors", async function () {
    const { quorum, node, owner } = await (async () => {
      const deployed = await deploy();
      const prompt = "prompt";
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
      await deployed.quorum.createRequest(1, prompt, 2, deadline, { value: 1000n });
      return deployed;
    })();
    const [, , secondNode] = await ethers.getSigners();
    const output = "answer";
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes(output));

    const nodeNonce = findClaimNonce(1, output, node.address);
    const secondNonce = findClaimNonce(1, output, secondNode.address);
    await quorum.connect(node).submitOutput(1, output, nodeNonce);
    await expect(quorum.connect(secondNode).submitOutput(1, output, secondNonce))
      .to.emit(quorum, "QuorumReached")
      .withArgs(1, outputHash, 2);
    await expect(quorum.connect(owner).finalize(1))
      .to.emit(quorum, "RequestFinalized")
      .withArgs(1, outputHash, true);

    expect(await quorum.isVerified(1)).to.equal(true);
    const request = await quorum.requests(1);
    expect(request.finalized).to.equal(true);
    expect(request.winningOutput).to.equal(outputHash);
    expect(request.winningCount).to.equal(2n);
    expect(request.minerShare).to.equal(450n);
    expect(await quorum.claimable(owner.address)).to.equal(100n);
    expect(request.fee).to.equal(0n);

    const nodeBefore = await ethers.provider.getBalance(node.address);
    const nodeTx = await quorum.connect(node).claimShare(1);
    const nodeReceipt = await nodeTx.wait();
    const nodeGas = nodeReceipt.gasUsed * nodeReceipt.gasPrice;
    const nodeAfter = await ethers.provider.getBalance(node.address);
    expect(nodeAfter - nodeBefore + nodeGas).to.equal(450n);

    const secondBefore = await ethers.provider.getBalance(secondNode.address);
    const secondTx = await quorum.connect(secondNode).claimShare(1);
    const secondReceipt = await secondTx.wait();
    const secondGas = secondReceipt.gasUsed * secondReceipt.gasPrice;
    const secondAfter = await ethers.provider.getBalance(secondNode.address);
    expect(secondAfter - secondBefore + secondGas).to.equal(450n);
    expect(await quorum.shareClaimed(1, node.address)).to.equal(true);
    expect(await quorum.shareClaimed(1, secondNode.address)).to.equal(true);
  });

  it("cannot finalize before quorum or deadline", async function () {
    const deployed = await deploy();
    const prompt = "prompt";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
      await deployed.quorum.createRequest(1, prompt, 2, deadline, { value: 1000n });

    await expect(deployed.quorum.finalize(1))
      .to.be.revertedWithCustomError(deployed.quorum, "RequestClosed");

    await ethers.provider.send("evm_setNextBlockTimestamp", [deadline]);
    await ethers.provider.send("evm_mine");
    await expect(deployed.quorum.finalize(1))
      .to.be.revertedWithCustomError(deployed.quorum, "QuorumNotReached");
    expect(await deployed.quorum.isVerified(1)).to.equal(false);
  });

  it("rejects finalizing a request twice", async function () {
    const deployed = await deploy();
    const prompt = "prompt";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(1, prompt, 1, deadline, { value: 1000n });
    const output = "answer";
    const nonce = findClaimNonce(1, output, deployed.node.address);
    await deployed.quorum.connect(deployed.node).submitOutput(1, output, nonce);
    await deployed.quorum.finalize(1);
    await expect(deployed.quorum.finalize(1))
      .to.be.revertedWithCustomError(deployed.quorum, "RequestClosed");
  });

  it("requires the configured fee and refunds an expired request", async function () {
    const { quorum, other } = await deploy();
    const prompt = "refund me";
    const latest = await ethers.provider.getBlock("latest");
    const deadline = latest.timestamp + 100;
    const contractAddress = await quorum.getAddress();
    const beforeContractBalance = await ethers.provider.getBalance(contractAddress);

    await expect(
      quorum.connect(other).createRequest(1, prompt, 1, deadline, { value: 999n })
    ).to.be.revertedWithCustomError(quorum, "IncorrectFee");
    await quorum.connect(other).createRequest(1, prompt, 1, deadline, { value: 1000n });

    await ethers.provider.send("evm_setNextBlockTimestamp", [deadline]);
    await ethers.provider.send("evm_mine");
    await quorum.connect(other).refundRequest(1);
    const afterContractBalance = await ethers.provider.getBalance(contractAddress);
    expect(afterContractBalance).to.equal(beforeContractBalance);
    const request = await quorum.requests(1);
    expect(request.refunded).to.equal(true);
    expect(request.fee).to.equal(0n);
  });

  it("allows only matching contributors to claim once", async function () {
    const { quorum, owner, node, other } = await deploy();
    const prompt = "paid request";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await quorum.createRequest(1, prompt, 2, deadline, { value: 1000n });
    const nonce = findClaimNonce(1, "paid answer", node.address);
    const otherNonce = findClaimNonce(1, "paid answer", other.address);
    await quorum.connect(node).submitOutput(1, "paid answer", nonce);
    await quorum.connect(other).submitOutput(1, "paid answer", otherNonce);
    await quorum.finalize(1);

    const minerBefore = await ethers.provider.getBalance(node.address);
    const minerClaim = await quorum.connect(node).claimShare(1);
    const minerReceipt = await minerClaim.wait();
    const minerGas = minerReceipt.gasUsed * minerReceipt.gasPrice;
    const minerAfter = await ethers.provider.getBalance(node.address);
    expect(minerAfter - minerBefore + minerGas).to.equal(450n);
    await quorum.connect(other).claimShare(1);
    await expect(quorum.connect(node).claimShare(1))
      .to.be.revertedWithCustomError(quorum, "NothingToClaim");
    await expect(quorum.connect(owner).claimShare(1))
      .to.be.revertedWithCustomError(quorum, "NothingToClaim");

    const ownerBefore = await ethers.provider.getBalance(owner.address);
    const ownerClaim = await quorum.claim();
    const ownerReceipt = await ownerClaim.wait();
    const ownerGas = ownerReceipt.gasUsed * ownerReceipt.gasPrice;
    const ownerAfter = await ethers.provider.getBalance(owner.address);
    expect(ownerAfter - ownerBefore + ownerGas).to.equal(100n);
    await expect(quorum.claim()).to.be.revertedWithCustomError(quorum, "NothingToClaim");
  });
});

describe("InferenceQuorum difficulty governance", function () {
  it("defaults to 16 and enforces difficulty range", async function () {
    const { quorum, owner } = await deploy();
    expect(await quorum.difficultyFor(1)).to.equal(16n);
    expect(await quorum.isExclusiveTier(1)).to.equal(false);
    await expect(quorum.connect(owner).proposeDifficulty(1, 11))
      .to.be.revertedWithCustomError(quorum, "DifficultyOutOfRange");
    await expect(quorum.connect(owner).proposeDifficulty(1, 81))
      .to.be.revertedWithCustomError(quorum, "DifficultyOutOfRange");
  });

  it("requires owner or a miner registered for that model version", async function () {
    const { quorum } = await deploy();
    const [, , , stranger] = await ethers.getSigners();
    await expect(quorum.connect(stranger).proposeDifficulty(1, 20))
      .to.be.revertedWithCustomError(quorum, "UnauthorizedProposer");
  });

  it("leaves difficulty unchanged when the proposal window expires without three matching proposals", async function () {
    const { quorum, owner, node } = await deploy();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await quorum.createRequest(1, "register owner and miner", 1, deadline, { value: 1000n });
    const output = "miner proof";
    await quorum.connect(node).submitOutput(1, output, findClaimNonce(1, output, node.address));
    await quorum.connect(owner).proposeDifficulty(1, 29);
    await quorum.connect(node).proposeDifficulty(1, 29);

    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine");
    await quorum.resolveDifficulty(1);
    expect(await quorum.difficultyFor(1)).to.equal(16n);
  });

  it("uses three distinct proposals to resolve difficulty and locks it per request", async function () {
    const { quorum, owner, node, other } = await deploy();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const prompt = "governance request";
    await quorum.createRequest(1, prompt, 2, deadline, { value: 1000n });
    expect((await quorum.requests(1)).difficulty).to.equal(16n);

    const output = "same output";
    await quorum.connect(node).submitOutput(1, output, findClaimNonce(1, output, node.address));
    await quorum.connect(other).submitOutput(1, output, findClaimNonce(1, output, other.address));
    await quorum.connect(owner).proposeDifficulty(1, 29);
    await quorum.connect(node).proposeDifficulty(1, 29);
    await expect(quorum.connect(other).proposeDifficulty(1, 29))
      .to.emit(quorum, "DifficultyProposed")
      .withArgs(1, 1, other.address, 29, 3)
      .and.to.emit(quorum, "DifficultyRoundResolved")
      .withArgs(1, 1, 29, 3, true);

    await expect(quorum.resolveDifficulty(1))
      .to.be.revertedWithCustomError(quorum, "ProposalRoundClosed");
    expect(await quorum.difficultyFor(1)).to.equal(29n);
    expect(await quorum.isExclusiveTier(1)).to.equal(false);
    expect((await quorum.requests(1)).difficulty).to.equal(16n);

    await quorum.createRequest(1, "request after governance", 1, deadline, { value: 1000n });
    expect((await quorum.requests(2)).difficulty).to.equal(29n);
  });

  it("marks difficulty 50 as exclusive and 16 as open tier", async function () {
    const { quorum, owner, node, other } = await deploy();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await quorum.createRequest(1, "register miners", 2, deadline, { value: 1000n });
    const output = "registration output";
    await quorum.connect(node).submitOutput(1, output, findClaimNonce(1, output, node.address));
    await quorum.connect(other).submitOutput(1, output, findClaimNonce(1, output, other.address));

    await quorum.connect(owner).proposeDifficulty(1, 50);
    await quorum.connect(node).proposeDifficulty(1, 50);
    await expect(quorum.connect(other).proposeDifficulty(1, 50))
      .to.emit(quorum, "DifficultyRoundResolved")
      .withArgs(1, 1, 50, 3, true);
    expect(await quorum.isExclusiveTier(1)).to.equal(true);
    expect(await quorum.difficultyFor(1)).to.equal(50n);
  });
});

describe("InferenceQuorum emergency difficulty", function () {
  async function registerMiner(version = 1) {
    const deployed = await deploy();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(version, "register miner", 1, deadline, { value: 1000n });
    const output = "miner output";
    const nonce = findClaimNonce(1, output, deployed.node.address);
    await deployed.quorum.connect(deployed.node).submitOutput(1, output, nonce);
    return deployed;
  }

  it("cannot execute before the seven day delay", async function () {
    const { quorum, owner } = await deploy();
    await quorum.connect(owner).proposeDifficultyEmergency(1, 29);
    await expect(quorum.executeDifficulty(1))
      .to.be.revertedWithCustomError(quorum, "EmergencyNotReady");

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await expect(quorum.executeDifficulty(1))
      .to.emit(quorum, "DifficultyEmergencyExecuted")
      .withArgs(1, owner.address, 29);
    expect(await quorum.difficultyFor(1)).to.equal(29n);
  });

  it("lets any address execute, not only the owner", async function () {
    const { quorum, owner, other } = await deploy();
    await quorum.connect(owner).proposeDifficultyEmergency(1, 24);
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine");
    await expect(quorum.connect(other).executeDifficulty(1))
      .to.emit(quorum, "DifficultyEmergencyExecuted")
      .withArgs(1, other.address, 24);
    expect(await quorum.difficultyFor(1)).to.equal(24n);
  });

  it("lets a registered miner propose without owner consensus", async function () {
    const { quorum, owner, node } = await registerMiner();
    const [, , stranger] = await ethers.getSigners();
    await expect(quorum.connect(stranger).proposeDifficultyEmergency(1, 30))
      .to.be.revertedWithCustomError(quorum, "UnauthorizedProposer");
    await quorum.connect(node).proposeDifficultyEmergency(1, 30);
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine");
    await quorum.executeDifficulty(1);
    expect(await quorum.difficultyFor(1)).to.equal(30n);
    // the owner is the only remaining proposer, so the 3-vote consensus cannot reach quorum
    await quorum.connect(owner).proposeDifficulty(1, 16);
    expect(await quorum.difficultyFor(1)).to.equal(30n);
  });

  it("blocks a second proposal while one is pending and allows cancel", async function () {
    const { quorum, owner, other } = await deploy();
    await quorum.connect(owner).proposeDifficultyEmergency(1, 29);
    await expect(quorum.connect(owner).proposeDifficultyEmergency(1, 20))
      .to.be.revertedWithCustomError(quorum, "EmergencyPending");

    await expect(quorum.connect(other).cancelDifficultyEmergency(1))
      .to.be.revertedWithCustomError(quorum, "NotOwner");
    await quorum.connect(owner).cancelDifficultyEmergency(1);
    await expect(quorum.cancelDifficultyEmergency(1))
      .to.be.revertedWithCustomError(quorum, "NothingPending");
    await quorum.connect(owner).proposeDifficultyEmergency(1, 20);
    expect((await quorum.emergencyDifficulty(1)).difficulty).to.equal(20n);
  });

  it("rejects out of range difficulty and reverts execution without pending proposal", async function () {
    const { quorum, owner, node } = await deploy();
    await expect(quorum.connect(owner).proposeDifficultyEmergency(1, 11))
      .to.be.revertedWithCustomError(quorum, "DifficultyOutOfRange");
    await expect(quorum.connect(owner).proposeDifficultyEmergency(1, 81))
      .to.be.revertedWithCustomError(quorum, "DifficultyOutOfRange");
    await expect(quorum.connect(node).executeDifficulty(1))
      .to.be.revertedWithCustomError(quorum, "NothingPending");
    await expect(quorum.connect(node).cancelDifficultyEmergency(1))
      .to.be.revertedWithCustomError(quorum, "NotOwner");
  });

  it("keeps the three proposal consensus working", async function () {
    const { quorum, owner, node, other } = await deploy();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await quorum.createRequest(1, "consensus", 2, deadline, { value: 1000n });
    const output = "consensus output";
    await quorum.connect(node).submitOutput(1, output, findClaimNonce(1, output, node.address));
    await quorum.connect(other).submitOutput(1, output, findClaimNonce(1, output, other.address));
    await quorum.connect(owner).proposeDifficulty(1, 18);
    await quorum.connect(node).proposeDifficulty(1, 18);
    await quorum.connect(other).proposeDifficulty(1, 18);
    expect(await quorum.difficultyFor(1)).to.equal(18n);
  });
});
