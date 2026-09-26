# Contributing

Thanks for your interest in contributing. The project is an early prototype; please discuss major design changes before implementing them.

## Before you start

- Check the README and open issues to avoid duplicating work.
- For model weights or datasets, confirm that the license allows the intended use and redistribution, and include the source and license in the model manifest.
- Never commit `.env`, private keys, seed phrases, API tokens, or user prompts containing sensitive information.

## Local checks

```bash
npm install
npx hardhat compile
npx hardhat test
```

All tests should pass before submitting a change. Do not deploy contracts or spend funds as part of routine tests; use the local Hardhat network unless deployment is explicitly requested.

## Changes

- Keep pull requests focused and explain the problem and the approach.
- Include or update tests for behavior changes.
- Document model/runtime versions and reproducibility details when changing AI inference behavior.
- Do not claim that a contribution trains, improves, or verifies the model unless the change and its evaluation demonstrate that.

## Pull requests

Describe what changed, how it was tested, and any effects on model compatibility, privacy, or on-chain state. Never include secrets in pull request text, logs, screenshots, or attachments.
