const { expect } = require("chai");
const { ethers } = require("hardhat");

const MODEL = {
  cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  hash: ethers.keccak256(ethers.toUtf8Bytes("model-file")),
  name: "Qwen2.5-0.5B-Instruct",
  format: "GGUF",
  quantization: "Q4_K_M",
  runtime: "llama.cpp",
};

async function deploy() {
  const [owner, node] = await ethers.getSigners();
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
  ]);
  await quorum.waitForDeployment();
  return { owner, node, registry, quorum };
}

describe("InferenceQuorum createRequest", function () {
  it("creates a request for the active model and emits its event", async function () {
    const { quorum } = await deploy();
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await expect(quorum.createRequest(1, inputHash, 2, deadline))
      .to.emit(quorum, "RequestCreated")
      .withArgs(1, 1, inputHash, 2, deadline);

    const request = await quorum.requests(1);
    expect(request.modelVersion).to.equal(1n);
    expect(request.inputHash).to.equal(inputHash);
    expect(request.quorum).to.equal(2n);
    expect(request.deadline).to.equal(BigInt(deadline));
    expect(await quorum.requestCount()).to.equal(1n);
  });

  it("only allows the owner to create requests", async function () {
    const { quorum, node } = await deploy();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));

    await expect(
      quorum.connect(node).createRequest(1, inputHash, 2, deadline)
    ).to.be.revertedWithCustomError(quorum, "NotOwner");
  });

  it("rejects inactive versions, empty hashes, zero quorum, and expired deadlines", async function () {
    const { quorum } = await deploy();
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const future = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await expect(
      quorum.createRequest(2, inputHash, 2, future)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, ethers.ZeroHash, 2, future)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, inputHash, 0, future)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, inputHash, 2, 1)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
  });
});

describe("InferenceQuorum submitOutput", function () {
  async function createRequest(quorum = 2) {
    const deployed = await deploy();
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(1, inputHash, quorum, deadline);
    return { ...deployed, inputHash, deadline };
  }

  it("records one submission per node and updates tally", async function () {
    const { quorum, node } = await createRequest();
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes("answer"));

    await expect(quorum.connect(node).submitOutput(1, outputHash))
      .to.emit(quorum, "OutputSubmitted")
      .withArgs(1, node.address, outputHash);

    expect(await quorum.submissions(1, node.address)).to.equal(outputHash);
    expect(await quorum.tally(1, outputHash)).to.equal(1n);
  });

  it("emits QuorumReached when tally reaches quorum", async function () {
    const { quorum, node } = await createRequest(1);
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes("answer"));

    await expect(quorum.connect(node).submitOutput(1, outputHash))
      .to.emit(quorum, "QuorumReached")
      .withArgs(1, outputHash, 1);
  });

  it("rejects duplicate, empty, unknown, and closed submissions", async function () {
    const { quorum, node, owner, deadline } = await createRequest();
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes("answer"));

    await quorum.connect(node).submitOutput(1, outputHash);
    await expect(
      quorum.connect(node).submitOutput(1, outputHash)
    ).to.be.revertedWithCustomError(quorum, "AlreadySubmitted");
    await expect(
      quorum.connect(owner).submitOutput(1, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(quorum, "InvalidOutput");
    await expect(
      quorum.connect(owner).submitOutput(99, outputHash)
    ).to.be.revertedWithCustomError(quorum, "UnknownRequest");

    await ethers.provider.send("evm_setNextBlockTimestamp", [deadline]);
    await ethers.provider.send("evm_mine");
    await expect(
      quorum.connect(owner).submitOutput(1, outputHash)
    ).to.be.revertedWithCustomError(quorum, "RequestClosed");
  });
});

describe("InferenceQuorum finalize", function () {
  it("finalizes and verifies when a hash reaches quorum", async function () {
    const { quorum, node, owner } = await (async () => {
      const deployed = await deploy();
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
      await deployed.quorum.createRequest(1, inputHash, 2, deadline);
      return deployed;
    })();
    const [, , secondNode] = await ethers.getSigners();
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes("answer"));

    await quorum.connect(node).submitOutput(1, outputHash);
    await expect(quorum.connect(secondNode).submitOutput(1, outputHash))
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
  });

  it("cannot finalize before quorum or deadline", async function () {
    const deployed = await deploy();
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(1, inputHash, 2, deadline);

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
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(1, inputHash, 1, deadline);
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes("answer"));
    await deployed.quorum.connect(deployed.node).submitOutput(1, outputHash);
    await deployed.quorum.finalize(1);
    await expect(deployed.quorum.finalize(1))
      .to.be.revertedWithCustomError(deployed.quorum, "RequestClosed");
  });
});
