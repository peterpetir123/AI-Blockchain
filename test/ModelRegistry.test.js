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

async function deployRegistry() {
  const [owner, node, other] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("ModelRegistry");
  const registry = await factory.deploy();
  return { registry, owner, node, other };
}

describe("ModelRegistry", function () {
  it("registers one complete model file as a version and activates it", async function () {
    const { registry } = await deployRegistry();

    await expect(
      registry.registerModel(
        MODEL.cid,
        MODEL.hash,
        MODEL.name,
        MODEL.format,
        MODEL.quantization,
        MODEL.runtime
      )
    )
      .to.emit(registry, "ModelRegistered")
      .withArgs(1, MODEL.hash, MODEL.cid, MODEL.name, MODEL.format, MODEL.quantization, MODEL.runtime);

    await registry.activateModel(1);
    expect(await registry.activeModelVersion()).to.equal(1n);

    const saved = await registry.models(1);
    expect(saved.cid).to.equal(MODEL.cid);
    expect(saved.modelHash).to.equal(MODEL.hash);
    expect(saved.quantization).to.equal(MODEL.quantization);
  });

  it("restricts model registration and activation to owner", async function () {
    const { registry, other } = await deployRegistry();
    await expect(
      registry.connect(other).registerModel(
        MODEL.cid,
        MODEL.hash,
        MODEL.name,
        MODEL.format,
        MODEL.quantization,
        MODEL.runtime
      )
    ).to.be.revertedWithCustomError(registry, "NotOwner");
    await expect(registry.connect(other).activateModel(1)).to.be.revertedWithCustomError(registry, "NotOwner");
  });

  it("rejects incomplete model metadata and unknown versions", async function () {
    const { registry } = await deployRegistry();
    await expect(
      registry.registerModel("", MODEL.hash, MODEL.name, MODEL.format, MODEL.quantization, MODEL.runtime)
    ).to.be.revertedWithCustomError(registry, "InvalidModel");
    await expect(registry.activateModel(1)).to.be.revertedWithCustomError(registry, "UnknownModel");
  });

  it("records inference hashes against active version without claiming to verify inference", async function () {
    const { registry, node } = await deployRegistry();
    await registry.registerModel(
      MODEL.cid,
      MODEL.hash,
      MODEL.name,
      MODEL.format,
      MODEL.quantization,
      MODEL.runtime
    );
    await registry.activateModel(1);

    const inputHash = ethers.keccak256(ethers.toUtf8Bytes("input"));
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes("output"));
    await expect(registry.connect(node).recordInference(inputHash, outputHash))
      .to.emit(registry, "InferenceRecorded")
      .withArgs(1, node.address, inputHash, outputHash);
  });

  it("requires active model and nonzero inference hashes", async function () {
    const { registry, node } = await deployRegistry();
    await expect(
      registry.connect(node).recordInference(ethers.ZeroHash, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(registry, "NoActiveModel");

    await registry.registerModel(
      MODEL.cid,
      MODEL.hash,
      MODEL.name,
      MODEL.format,
      MODEL.quantization,
      MODEL.runtime
    );
    await registry.activateModel(1);
    await expect(
      registry.connect(node).recordInference(ethers.ZeroHash, MODEL.hash)
    ).to.be.revertedWithCustomError(registry, "InvalidInferenceHash");
  });
});
