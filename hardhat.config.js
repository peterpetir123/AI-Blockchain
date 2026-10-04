require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const MAINNET_PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const TESTNET_PRIVATE_KEY = process.env.TESTNET_PRIVATE_KEY || "";

if (
  MAINNET_PRIVATE_KEY &&
  TESTNET_PRIVATE_KEY &&
  MAINNET_PRIVATE_KEY.toLowerCase() === TESTNET_PRIVATE_KEY.toLowerCase()
) {
  console.warn("Warning: the mainnet and testnet wallets use the same private key.");
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    opbnb: {
      url: process.env.RPC_URL || "https://opbnb-rpc.publicnode.com",
      accounts: MAINNET_PRIVATE_KEY ? [MAINNET_PRIVATE_KEY] : [],
      chainId: 204,
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      accounts: TESTNET_PRIVATE_KEY ? [TESTNET_PRIVATE_KEY] : [],
      chainId: 97,
    },
  },
  etherscan: {
    apiKey: {
      opbnb: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "opbnb",
        chainId: 204,
        urls: {
          apiURL: "https://api-opbnb.bscscan.com/api",
          browserURL: "https://opbnb.bscscan.com",
        },
      },
    ],
  },
};
