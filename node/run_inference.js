#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const model = process.env.MODEL_PATH;
const prompt = process.argv.slice(2).join(" ").trim();
const cli = process.env.LLAMA_CLI || "llama-cli";

if (!model || !prompt) {
  console.error("Pakai: MODEL_PATH=/path/model.gguf node node/run_inference.js \"prompt\"");
  process.exit(1);
}

if (!fs.existsSync(model)) {
  console.error(`Model tidak ditemukan: ${model}`);
  process.exit(1);
}

const child = spawn(cli, ["-m", model, "-n", process.env.MAX_TOKENS || "128", prompt], {
  stdio: "inherit",
});

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("llama-cli tidak ditemukan. Pasang llama.cpp dan pastikan llama-cli ada di PATH.");
  } else {
    console.error(`Gagal menjalankan llama-cli: ${error.message}`);
  }
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`llama-cli dihentikan oleh signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
