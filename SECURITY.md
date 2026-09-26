# Security

## Secret handling

- Keep `.env`, private keys, seed phrases, API tokens, and deployment files on the local machine only.
- Never paste secrets into issues, pull requests, chat, screenshots, or log output.
- Use a dedicated burner wallet for testnet and development.
- Treat a key that has been exposed as compromised; rotate it before using funds or deploying to mainnet.
- Do not put model data, private prompts, or sensitive user information on-chain.

## Reporting a vulnerability

Do not publish an exploitable vulnerability in a public issue. Contact the project maintainer privately with:

- a clear description of the affected component;
- reproduction steps or a minimal proof of concept;
- the potential impact;
- a suggested mitigation, if available.

Allow time for a fix before publicly disclosing the issue. Do not test against live contracts or wallets without permission.

## Smart-contract risks

The contracts are experimental and have not been audited. Test changes locally before using a testnet. Never send meaningful funds to an unaudited deployment.
