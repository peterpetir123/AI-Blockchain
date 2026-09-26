require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const MAINNET_PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const TESTNET_PRIVATE_KEY = process.env.TESTNET_PRIVATE_KEY || "";

if (
  MAINNET_PRIVATE_KEY &&
  TESTNET_PRIVATE_KEY &&
  MAINNET_PRIVATE_KEY.toLowerCase() === TESTNET_PRIVATE_KEY.toLowerCase()
) {
  throw new Error("Gunakan private key berbeda untuk opBNB mainnet dan testnet.");
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
    opbnbTestnet: {
      url: process.env.OPBNB_TESTNET_RPC_URL || "https://opbnb-testnet-rpc.bnbchain.org",
      accounts: TESTNET_PRIVATE_KEY ? [TESTNET_PRIVATE_KEY] : [],
      chainId: 5611,
    },
  },
  etherscan: {
    apiKey: {
      opbnb: process.env.BSCSCAN_API_KEY || "",
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
