// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IModelRegistryVersion {
    function activeModelVersion() external view returns (uint256);
    function modelVersionCount() external view returns (uint256);
}

contract InferenceQuorum {
    uint256 public constant DEFAULT_DIFFICULTY = 16;
    uint256 public constant MIN_DIFFICULTY = 12;
    uint256 public constant MAX_DIFFICULTY = 80;
    uint256 public constant EXCLUSIVE_DIFFICULTY = 50;
    uint256 public constant PROPOSALS_REQUIRED = 3;
    uint256 public constant PROPOSAL_WINDOW = 2 days;

    struct Request {
        uint256 modelVersion;
        string prompt;
        bytes32 inputHash;
        uint256 quorum;
        uint256 deadline;
        uint256 difficulty;
        address payable requester;
        uint256 fee;
        uint256 minerShare;
        bool finalized;
        bool refunded;
        bytes32 winningOutput;
        uint256 winningCount;
    }

    struct DifficultyRound {
        uint256 openedAt;
        uint256 leadingValue;
        uint256 leadingVotes;
        bool tied;
        bool resolved;
    }

    address public immutable owner;
    IModelRegistryVersion public immutable modelRegistry;
    uint256 public requestCount;
    uint256 public requestFee;
    mapping(uint256 => uint256) public claimDifficulty;
    mapping(address => uint256) public claimable;
    uint256 private claimLock = 1;

    mapping(uint256 => Request) public requests;
    mapping(uint256 => mapping(address => bytes32)) public submissions;
    mapping(uint256 => mapping(bytes32 => uint256)) public tally;
    mapping(uint256 => mapping(bytes32 => string)) public outputText;
    mapping(uint256 => mapping(address => bool)) public minerOfVersion;
    mapping(uint256 => mapping(uint256 => DifficultyRound)) public difficultyRounds;
    mapping(uint256 => uint256) public currentDifficultyRound;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => uint256))) public proposalTally;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasProposed;
    mapping(uint256 => mapping(address => bool)) public shareClaimed;

    event RequestCreated(
        uint256 indexed requestId,
        uint256 indexed modelVersion,
        bytes32 inputHash,
        uint256 quorum,
        uint256 deadline,
        uint256 difficulty
    );
    event OutputSubmitted(uint256 indexed requestId, address indexed node, bytes32 outputHash);
    event QuorumReached(uint256 indexed requestId, bytes32 outputHash, uint256 count);
    event RequestFinalized(uint256 indexed requestId, bytes32 winningOutput, bool verified);
    event FeeAllocated(uint256 indexed requestId, uint256 platformAmount, uint256 minerShare, uint256 miners);
    event MinerShareClaimed(uint256 indexed requestId, address indexed miner, uint256 amount);
    event RewardClaimed(address indexed account, uint256 amount);
    event DifficultyProposed(uint256 indexed version, uint256 indexed round, address indexed proposer, uint256 difficulty, uint256 votes);
    event DifficultyRoundResolved(uint256 indexed version, uint256 indexed round, uint256 difficulty, uint256 votes, bool changed);

    error NotOwner();
    error InvalidRequest();
    error UnknownRequest();
    error RequestClosed();
    error AlreadySubmitted();
    error InvalidOutput();
    error QuorumNotReached();
    error IncorrectFee();
    error RefundUnavailable();
    error TransferFailed();
    error NothingToClaim();
    error ReentrantClaim();
    error InvalidProof();
    error DifficultyOutOfRange();
    error UnauthorizedProposer();
    error AlreadyProposed();
    error ProposalRoundClosed();
    error ProposalNotReady();

    constructor(address modelRegistryAddress, uint256 initialRequestFee) {
        if (modelRegistryAddress == address(0)) revert InvalidRequest();
        owner = msg.sender;
        modelRegistry = IModelRegistryVersion(modelRegistryAddress);
        requestFee = initialRequestFee;
    }

    function setRequestFee(uint256 newRequestFee) external {
        if (msg.sender != owner) revert NotOwner();
        requestFee = newRequestFee;
    }

    function difficultyFor(uint256 version) public view returns (uint256) {
        uint256 configured = claimDifficulty[version];
        return configured == 0 ? DEFAULT_DIFFICULTY : configured;
    }

    function isExclusiveTier(uint256 version) external view returns (bool) {
        return difficultyFor(version) >= EXCLUSIVE_DIFFICULTY;
    }

    function proposeDifficulty(uint256 version, uint256 difficulty) external {
        if (version == 0 || version > modelRegistry.modelVersionCount()) revert InvalidRequest();
        if (difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY) {
            revert DifficultyOutOfRange();
        }
        if (msg.sender != owner && !minerOfVersion[version][msg.sender]) {
            revert UnauthorizedProposer();
        }
        uint256 roundId = currentDifficultyRound[version];
        if (roundId == 0) {
            roundId = 1;
            currentDifficultyRound[version] = roundId;
        } else if (difficultyRounds[version][roundId].resolved) {
            roundId += 1;
            currentDifficultyRound[version] = roundId;
        }
        DifficultyRound storage previousRound = difficultyRounds[version][roundId];
        if (previousRound.openedAt != 0 && block.timestamp > previousRound.openedAt + PROPOSAL_WINDOW) {
            previousRound.resolved = true;
            emit DifficultyRoundResolved(
                version,
                roundId,
                difficultyFor(version),
                previousRound.leadingVotes,
                false
            );
            roundId += 1;
            currentDifficultyRound[version] = roundId;
        }
        DifficultyRound storage round = difficultyRounds[version][roundId];
        if (round.openedAt == 0) round.openedAt = block.timestamp;
        if (round.resolved) revert ProposalRoundClosed();
        if (hasProposed[version][roundId][msg.sender]) revert AlreadyProposed();

        hasProposed[version][roundId][msg.sender] = true;
        uint256 votes = ++proposalTally[version][roundId][difficulty];
        if (votes > round.leadingVotes) {
            round.leadingValue = difficulty;
            round.leadingVotes = votes;
            round.tied = false;
        } else if (votes == round.leadingVotes && difficulty != round.leadingValue) {
            round.tied = true;
        }
        emit DifficultyProposed(version, roundId, msg.sender, difficulty, votes);

        if (votes >= PROPOSALS_REQUIRED) {
            round.resolved = true;
            claimDifficulty[version] = difficulty;
            emit DifficultyRoundResolved(version, roundId, difficulty, votes, true);
        }
    }

    function resolveDifficulty(uint256 version) external {
        uint256 roundId = currentDifficultyRound[version];
        if (roundId == 0) revert ProposalNotReady();
        DifficultyRound storage round = difficultyRounds[version][roundId];
        if (round.resolved || round.openedAt == 0) revert ProposalRoundClosed();

        bool thresholdReached = round.leadingVotes >= PROPOSALS_REQUIRED && !round.tied;
        bool windowExpired = block.timestamp > round.openedAt + PROPOSAL_WINDOW;
        if (!thresholdReached && !windowExpired) revert ProposalNotReady();
        if (round.tied && !windowExpired) revert ProposalNotReady();

        round.resolved = true;
        bool changed = thresholdReached;
        if (changed) claimDifficulty[version] = round.leadingValue;
        emit DifficultyRoundResolved(
            version,
            roundId,
            changed ? round.leadingValue : difficultyFor(version),
            round.leadingVotes,
            changed
        );
    }

    function createRequest(
        uint256 modelVersion,
        string calldata prompt,
        uint256 quorum,
        uint256 deadline
    ) external payable returns (uint256) {
        bytes32 inputHash = keccak256(bytes(prompt));
        if (
            modelVersion == 0 ||
            modelVersion != modelRegistry.activeModelVersion() ||
            bytes(prompt).length == 0 ||
            inputHash == bytes32(0) ||
            quorum == 0 ||
            deadline <= block.timestamp
        ) revert InvalidRequest();
        if (msg.value != requestFee) revert IncorrectFee();

        uint256 requestId = ++requestCount;
        uint256 difficulty = difficultyFor(modelVersion);
        requests[requestId] = Request({
            modelVersion: modelVersion,
            prompt: prompt,
            inputHash: inputHash,
            quorum: quorum,
            deadline: deadline,
            difficulty: difficulty,
            requester: payable(msg.sender),
            fee: msg.value,
            minerShare: 0,
            finalized: false,
            refunded: false,
            winningOutput: bytes32(0),
            winningCount: 0
        });

        emit RequestCreated(requestId, modelVersion, inputHash, quorum, deadline, difficulty);
        return requestId;
    }

    function submitOutput(uint256 requestId, string calldata output, uint256 nonce) external {
        if (requestId == 0 || requestId > requestCount) revert UnknownRequest();
        Request storage request = requests[requestId];
        if (request.finalized || request.winningOutput != bytes32(0) || block.timestamp >= request.deadline) {
            revert RequestClosed();
        }
        if (bytes(output).length == 0) revert InvalidOutput();
        if (submissions[requestId][msg.sender] != bytes32(0)) revert AlreadySubmitted();

        bytes32 outputHash = keccak256(bytes(output));
        if (!_validClaim(requestId, outputHash, msg.sender, nonce, request.difficulty)) {
            revert InvalidProof();
        }
        submissions[requestId][msg.sender] = outputHash;
        minerOfVersion[request.modelVersion][msg.sender] = true;
        if (bytes(outputText[requestId][outputHash]).length == 0) {
            outputText[requestId][outputHash] = output;
        }
        uint256 count = ++tally[requestId][outputHash];
        emit OutputSubmitted(requestId, msg.sender, outputHash);

        if (count >= request.quorum) {
            request.winningOutput = outputHash;
            request.winningCount = count;
            emit QuorumReached(requestId, outputHash, count);
        }
    }

    function finalize(uint256 requestId) external {
        if (requestId == 0 || requestId > requestCount) revert UnknownRequest();
        Request storage request = requests[requestId];
        if (request.finalized) revert RequestClosed();
        if (request.winningOutput == bytes32(0)) {
            if (block.timestamp < request.deadline) revert RequestClosed();
            revert QuorumNotReached();
        }

        request.finalized = true;
        uint256 minerPool = (request.fee * 90) / 100;
        request.minerShare = minerPool / request.winningCount;
        uint256 platformAmount = request.fee - (request.minerShare * request.winningCount);
        request.fee = 0;
        claimable[owner] += platformAmount;
        emit FeeAllocated(requestId, platformAmount, request.minerShare, request.winningCount);
        emit RequestFinalized(requestId, request.winningOutput, request.winningCount >= request.quorum);
    }

    function claimShare(uint256 requestId) external {
        if (requestId == 0 || requestId > requestCount) revert UnknownRequest();
        Request storage request = requests[requestId];
        if (!request.finalized || submissions[requestId][msg.sender] != request.winningOutput) {
            revert NothingToClaim();
        }
        if (shareClaimed[requestId][msg.sender]) revert NothingToClaim();
        if (claimLock != 1) revert ReentrantClaim();

        claimLock = 2;
        shareClaimed[requestId][msg.sender] = true;
        uint256 amount = request.minerShare;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
        claimLock = 1;
        emit MinerShareClaimed(requestId, msg.sender, amount);
    }

    function claim() external {
        if (claimLock != 1) revert ReentrantClaim();
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimLock = 2;
        claimable[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
        claimLock = 1;
        emit RewardClaimed(msg.sender, amount);
    }

    function refundRequest(uint256 requestId) external {
        if (requestId == 0 || requestId > requestCount) revert UnknownRequest();
        Request storage request = requests[requestId];
        if (msg.sender != request.requester || block.timestamp < request.deadline) revert RefundUnavailable();
        if (request.finalized || request.refunded || request.winningOutput != bytes32(0)) revert RefundUnavailable();
        request.refunded = true;
        uint256 amount = request.fee;
        request.fee = 0;
        (bool sent, ) = request.requester.call{value: amount}("");
        if (!sent) revert TransferFailed();
    }

    function isVerified(uint256 requestId) external view returns (bool) {
        if (requestId == 0 || requestId > requestCount) return false;
        Request storage request = requests[requestId];
        return request.finalized && request.winningCount >= request.quorum;
    }

    function getPrompt(uint256 requestId) external view returns (string memory) {
        if (requestId == 0 || requestId > requestCount) revert UnknownRequest();
        return requests[requestId].prompt;
    }

    function _validClaim(
        uint256 requestId,
        bytes32 outputHash,
        address miner,
        uint256 nonce,
        uint256 difficulty
    ) internal pure returns (bool) {
        uint256 target = type(uint256).max >> difficulty;
        uint256 proof = uint256(keccak256(abi.encodePacked(requestId, outputHash, miner, nonce)));
        return proof < target;
    }
}
