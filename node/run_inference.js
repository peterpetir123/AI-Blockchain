#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const model = process.env.MODEL_PATH;
const prompt = process.argv.slice(2).join(" ").trim();
const cli = process.env.LLAMA_CLI || "llama-cli";

if (!model || !prompt) {
  console.error("Usage: MODEL_PATH=/path/model.gguf node node/run_inference.js \"prompt\"");
  process.exit(1);
}

if (!fs.existsSync(model)) {
  console.error(`Model not found: ${model}`);
  process.exit(1);
}

const child = spawn(cli, ["-m", model, "-n", process.env.MAX_TOKENS || "128", prompt], {
  stdio: "inherit",
});

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("llama-cli not found. Install llama.cpp and make sure llama-cli is on PATH.");
  } else {
    console.error(`Failed to run llama-cli: ${error.message}`);
  }
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`llama-cli terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
