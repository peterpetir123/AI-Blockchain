const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("model manifest", function () {
  it("the example manifest documents the required metadata", function () {
    const file = path.join(__dirname, "..", "model", "manifest.example.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const field of ["name", "version", "cid", "sha256", "format", "quantization", "runtimeVersion"]) {
      expect(manifest).to.have.property(field);
    }
    expect(manifest.format).to.equal("GGUF");
    expect(manifest.quantization).to.equal("Q4_K_M");
  });
});
