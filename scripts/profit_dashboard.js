#!/usr/bin/env node

require("dotenv").config();
const fs = require("node:fs");
const { Contract, JsonRpcProvider, formatEther } = require("ethers");

const ABI = [
  "event OutputSubmitted(uint256 indexed requestId,address indexed node,bytes32 outputHash)",
  "event FeeAllocated(uint256 indexed requestId,uint256 platformAmount,uint256 minerShare,uint256 miners)",
  "event RequestFinalized(uint256 indexed requestId,bytes32 winningOutput,bool verified)",
  "event MinerShareClaimed(uint256 indexed requestId,address indexed miner,uint256 amount)",
  "event RewardClaimed(address indexed account,uint256 amount)",
  "function owner() view returns (address)",
];
const MAX_BLOCK_RANGE = 50_000;

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function blockNumber(value, latest, name) {
  if (value === "latest") return latest;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be a non-negative integer or latest`);
  return Number(value);
}

async function getEvents(contract, filter, fromBlock, toBlock) {
  const events = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_BLOCK_RANGE) {
    const end = Math.min(start + MAX_BLOCK_RANGE - 1, toBlock);
    events.push(...await contract.queryFilter(filter, start, end));
  }
  return events;
}

async function gasCost(provider, event) {
  const receipt = await provider.getTransactionReceipt(event.transactionHash);
  if (!receipt) return 0n;
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
  return receipt.gasUsed * gasPrice;
}

async function main() {
  const deploymentPath = process.env.QUORUM_DEPLOYMENT || "inference-quorum-deployment.json";
  const deployment = readJson(deploymentPath);
  const provider = new JsonRpcProvider(process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
  const contract = new Contract(deployment.quorumAddress, ABI, provider);
  const latest = await provider.getBlockNumber();
  const fromBlock = blockNumber(arg("from-block", process.env.FROM_BLOCK || Math.max(0, latest - 500_000)), latest, "from-block");
  const toBlock = blockNumber(arg("to-block", process.env.TO_BLOCK || latest), latest, "to-block");
  if (fromBlock > toBlock) throw new Error("from-block cannot be greater than to-block");

  const owner = await contract.owner();
  const address = arg("address", "").toLowerCase();
  if (address && !/^0x[a-f0-9]{40}$/.test(address)) throw new Error("address must be a 20-byte EVM address");
  const [outputs, allocated, finalized, minerClaims, platformClaims] = await Promise.all([
    getEvents(contract, address ? contract.filters.OutputSubmitted(null, address) : contract.filters.OutputSubmitted(), fromBlock, toBlock),
    getEvents(contract, contract.filters.FeeAllocated(), fromBlock, toBlock),
    getEvents(contract, contract.filters.RequestFinalized(), fromBlock, toBlock),
    getEvents(contract, address ? contract.filters.MinerShareClaimed(null, address) : contract.filters.MinerShareClaimed(), fromBlock, toBlock),
    getEvents(contract, contract.filters.RewardClaimed(), fromBlock, toBlock),
  ]);
  const selectedPlatformClaims = address
    ? platformClaims.filter((event) => event.args.account.toLowerCase() === address)
    : platformClaims.filter((event) => event.args.account.toLowerCase() === owner.toLowerCase());
  const grossPlatform = allocated.reduce((sum, event) => sum + event.args.platformAmount, 0n);
  const grossMiner = allocated.reduce((sum, event) => sum + event.args.minerShare * event.args.miners, 0n);
  const allocationByRequest = new Map(allocated.map((event) => [event.args.requestId.toString(), event]));
  const winnerByRequest = new Map(finalized.map((event) => [event.args.requestId.toString(), event.args.winningOutput]));
  const eligibleMinerGross = address
    ? outputs.reduce((sum, event) => {
      const requestId = event.args.requestId.toString();
      const allocation = allocationByRequest.get(requestId);
      const winningOutput = winnerByRequest.get(requestId);
      return allocation && winningOutput && event.args.outputHash === winningOutput
        ? sum + allocation.args.minerShare
        : sum;
    }, 0n)
    : null;
  const claimedMiner = minerClaims.reduce((sum, event) => sum + event.args.amount, 0n);
  const claimedPlatform = selectedPlatformClaims.reduce((sum, event) => sum + event.args.amount, 0n);
  const minerClaimGas = (await Promise.all(minerClaims.map((event) => gasCost(provider, event)))).reduce((a, b) => a + b, 0n);
  const minerSubmissionGas = (await Promise.all(outputs.map((event) => gasCost(provider, event)))).reduce((a, b) => a + b, 0n);
  const minerGas = minerClaimGas + minerSubmissionGas;
  const platformGas = (await Promise.all(selectedPlatformClaims.map((event) => gasCost(provider, event)))).reduce((a, b) => a + b, 0n);
  const result = {
    network: deployment.network,
    contract: deployment.quorumAddress,
    scan: { fromBlock, toBlock },
    owner,
    filterAddress: address || null,
    gross: {
      platformAllocatedBNB: formatEther(grossPlatform),
      minerPoolAllocatedBNB: formatEther(grossMiner),
      ...(address ? { addressEligibleMinerBNB: formatEther(eligibleMinerGross) } : {}),
    },
    claimed: {
      platformBNB: formatEther(claimedPlatform),
      minerBNB: formatEther(claimedMiner),
    },
    claimGas: {
      platformBNB: formatEther(platformGas),
      minerSubmitOutputBNB: formatEther(minerSubmissionGas),
      minerClaimShareBNB: formatEther(minerClaimGas),
      minerTotalBNB: formatEther(minerGas),
    },
    netAfterClaimGas: {
      platformBNB: formatEther(claimedPlatform - platformGas),
      minerBNB: formatEther(claimedMiner - minerGas),
    },
    events: {
      feeAllocations: allocated.length,
      minerSubmissions: outputs.length,
      minerClaims: minerClaims.length,
      platformClaims: selectedPlatformClaims.length,
    },
    note: "Net values subtract claim transaction gas only; they exclude hardware, electricity, and model inference costs.",
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("Profit dashboard");
  console.log(`Contract       : ${result.contract}`);
  console.log(`Block range    : ${fromBlock} - ${toBlock}`);
  console.log(`Owner          : ${owner}`);
  if (address) console.log(`Address filter : ${address}`);
  console.log(`\nGross allocated`);
  console.log(`  Platform     : ${result.gross.platformAllocatedBNB} BNB`);
  console.log(`  Miner pool   : ${result.gross.minerPoolAllocatedBNB} BNB`);
  if (address) console.log(`  Eligible     : ${result.gross.addressEligibleMinerBNB} BNB gross for this address`);
  console.log(`\nClaimed`);
  console.log(`  Platform     : ${result.claimed.platformBNB} BNB`);
  console.log(`  Miner        : ${result.claimed.minerBNB} BNB`);
  console.log(`\nClaim gas`);
  console.log(`  Platform     : ${result.claimGas.platformBNB} BNB`);
  console.log(`  Miner submit  : ${result.claimGas.minerSubmitOutputBNB} BNB`);
  console.log(`  Miner claim   : ${result.claimGas.minerClaimShareBNB} BNB`);
  console.log(`  Miner total   : ${result.claimGas.minerTotalBNB} BNB`);
  console.log(`\nNet after claim gas`);
  console.log(`  Platform     : ${result.netAfterClaimGas.platformBNB} BNB`);
  console.log(`  Miner        : ${result.netAfterClaimGas.minerBNB} BNB`);
  console.log(`\nEvents         : ${allocated.length} allocations, ${outputs.length} miner submissions, ${minerClaims.length} miner claims, ${selectedPlatformClaims.length} platform claims`);
  console.log(`Note           : ${result.note}`);
}

main().catch((error) => {
  console.error("ERROR:", error.message || error);
  process.exit(1);
});
