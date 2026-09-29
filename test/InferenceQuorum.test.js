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

    await expect(quorum.createRequest(1, prompt, 2, deadline))
      .to.emit(quorum, "RequestCreated")
      .withArgs(1, 1, inputHash, 2, deadline);

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

    await expect(quorum.connect(node).createRequest(1, prompt, 2, deadline))
      .to.emit(quorum, "RequestCreated")
      .withArgs(1, 1, ethers.keccak256(ethers.toUtf8Bytes(prompt)), 2, deadline);
  });

  it("rejects inactive versions, empty hashes, zero quorum, and expired deadlines", async function () {
    const { quorum } = await deploy();
    const prompt = "prompt";
    const future = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await expect(
      quorum.createRequest(2, prompt, 2, future)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, "", 2, future)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, prompt, 0, future)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
    await expect(
      quorum.createRequest(1, prompt, 2, 1)
    ).to.be.revertedWithCustomError(quorum, "InvalidRequest");
  });
});

describe("InferenceQuorum submitOutput", function () {
  async function createRequest(quorum = 2) {
    const deployed = await deploy();
    const prompt = "prompt";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(1, prompt, quorum, deadline);
    return { ...deployed, deadline };
  }

  it("records one submission per node and updates tally", async function () {
    const { quorum, node } = await createRequest();
    const output = "Blockchain adalah buku besar digital.";
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes(output));

    await expect(quorum.connect(node).submitOutput(1, output))
      .to.emit(quorum, "OutputSubmitted")
      .withArgs(1, node.address, outputHash);

    expect(await quorum.submissions(1, node.address)).to.equal(outputHash);
    expect(await quorum.tally(1, outputHash)).to.equal(1n);
    expect(await quorum.outputText(1, outputHash)).to.equal(output);
  });

  it("emits QuorumReached when tally reaches quorum", async function () {
    const { quorum, node } = await createRequest(1);
    const output = "answer";
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes(output));

    await expect(quorum.connect(node).submitOutput(1, output))
      .to.emit(quorum, "QuorumReached")
      .withArgs(1, outputHash, 1);
  });

  it("rejects duplicate, empty, unknown, and closed submissions", async function () {
    const { quorum, node, owner, deadline } = await createRequest();
    const output = "answer";

    await quorum.connect(node).submitOutput(1, output);
    await expect(
      quorum.connect(node).submitOutput(1, output)
    ).to.be.revertedWithCustomError(quorum, "AlreadySubmitted");
    await expect(
      quorum.connect(owner).submitOutput(1, "")
    ).to.be.revertedWithCustomError(quorum, "InvalidOutput");
    await expect(
      quorum.connect(owner).submitOutput(99, output)
    ).to.be.revertedWithCustomError(quorum, "UnknownRequest");

    await ethers.provider.send("evm_setNextBlockTimestamp", [deadline]);
    await ethers.provider.send("evm_mine");
    await expect(
      quorum.connect(owner).submitOutput(1, output)
    ).to.be.revertedWithCustomError(quorum, "RequestClosed");
  });
});

describe("InferenceQuorum finalize", function () {
  it("runs requester -> worker -> finalize -> read-output locally", async function () {
    const { quorum, node, other } = await deploy();
    const prompt = "Jelaskan blockchain.";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await quorum.connect(other).createRequest(1, prompt, 1, deadline);
    const output = "Blockchain adalah buku besar terdistribusi.";
    await quorum.connect(node).submitOutput(1, output);
    await quorum.connect(other).finalize(1);

    const request = await quorum.requests(1);
    expect(await quorum.isVerified(1)).to.equal(true);
    expect(await quorum.outputText(1, request.winningOutput)).to.equal(output);
  });

  it("finalizes and verifies when a hash reaches quorum", async function () {
    const { quorum, node, owner } = await (async () => {
      const deployed = await deploy();
      const prompt = "prompt";
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
      await deployed.quorum.createRequest(1, prompt, 2, deadline);
      return deployed;
    })();
    const [, , secondNode] = await ethers.getSigners();
    const output = "answer";
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes(output));

    await quorum.connect(node).submitOutput(1, output);
    await expect(quorum.connect(secondNode).submitOutput(1, output))
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
    const prompt = "prompt";
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await deployed.quorum.createRequest(1, prompt, 2, deadline);

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
    await deployed.quorum.createRequest(1, prompt, 1, deadline);
    const output = "answer";
    await deployed.quorum.connect(deployed.node).submitOutput(1, output);
    await deployed.quorum.finalize(1);
    await expect(deployed.quorum.finalize(1))
      .to.be.revertedWithCustomError(deployed.quorum, "RequestClosed");
  });
});
