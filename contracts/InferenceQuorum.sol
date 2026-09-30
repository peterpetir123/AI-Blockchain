// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface minimum untuk mengikat request ke versi model aktif.
interface IModelRegistryVersion {
    function activeModelVersion() external view returns (uint256);
}

/// @notice Kerangka verifikasi output inference multi-node.
/// @dev Logika produksi sengaja belum diaktifkan pada tahap scaffold ini.
contract InferenceQuorum {
    struct Request {
        uint256 modelVersion;
        string prompt;
        bytes32 inputHash;
        uint256 quorum;
        uint256 deadline;
        address payable requester;
        address payable winningMiner;
        uint256 fee;
        bool finalized;
        bool refunded;
        bytes32 winningOutput;
        uint256 winningCount;
    }

    address public immutable owner;
    IModelRegistryVersion public immutable modelRegistry;
    uint256 public requestCount;
    uint256 public requestFee;
    uint256 public constant CLAIM_DIFFICULTY = 16;
    mapping(address => uint256) public claimable;
    uint256 private claimLock = 1;

    mapping(uint256 => Request) public requests;
    mapping(uint256 => mapping(address => bytes32)) public submissions;
    mapping(uint256 => mapping(bytes32 => uint256)) public tally;
    mapping(uint256 => mapping(bytes32 => string)) public outputText;

    event RequestCreated(
        uint256 indexed requestId,
        uint256 indexed modelVersion,
        bytes32 inputHash,
        uint256 quorum,
        uint256 deadline
    );
    event OutputSubmitted(
        uint256 indexed requestId,
        address indexed node,
        bytes32 outputHash
    );
    event QuorumReached(
        uint256 indexed requestId,
        bytes32 outputHash,
        uint256 count
    );
    event RequestFinalized(
        uint256 indexed requestId,
        bytes32 winningOutput,
        bool verified
    );
    event FeeAllocated(
        uint256 indexed requestId,
        address indexed platform,
        address indexed miner,
        uint256 platformAmount,
        uint256 minerAmount
    );
    event RewardClaimed(address indexed account, uint256 amount);

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
    error NotImplemented();

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
        requests[requestId] = Request({
            modelVersion: modelVersion,
            prompt: prompt,
            inputHash: inputHash,
            quorum: quorum,
            deadline: deadline,
            requester: payable(msg.sender),
            winningMiner: payable(address(0)),
            fee: msg.value,
            finalized: false,
            refunded: false,
            winningOutput: bytes32(0),
            winningCount: 0
        });

        emit RequestCreated(
            requestId,
            modelVersion,
            inputHash,
            quorum,
            deadline
        );
        return requestId;
    }

    function submitOutput(
        uint256 requestId,
        string calldata output,
        uint256 nonce
    ) external {
        if (requestId == 0 || requestId > requestCount) {
            revert UnknownRequest();
        }
        Request storage request = requests[requestId];
        if (request.finalized || block.timestamp >= request.deadline) {
            revert RequestClosed();
        }
        if (bytes(output).length == 0) revert InvalidOutput();
        if (submissions[requestId][msg.sender] != bytes32(0)) {
            revert AlreadySubmitted();
        }

        bytes32 outputHash = keccak256(bytes(output));
        if (!_validClaim(requestId, outputHash, msg.sender, nonce)) {
            revert InvalidProof();
        }
        submissions[requestId][msg.sender] = outputHash;
        if (bytes(outputText[requestId][outputHash]).length == 0) {
            outputText[requestId][outputHash] = output;
        }
        uint256 count = ++tally[requestId][outputHash];
        emit OutputSubmitted(requestId, msg.sender, outputHash);

        if (count >= request.quorum) {
            if (request.winningOutput == bytes32(0)) {
                request.winningOutput = outputHash;
                request.winningCount = count;
                request.winningMiner = payable(msg.sender);
            }
            emit QuorumReached(requestId, outputHash, count);
        }
    }

    function finalize(uint256 requestId) external {
        if (requestId == 0 || requestId > requestCount) {
            revert UnknownRequest();
        }
        Request storage request = requests[requestId];
        if (request.finalized) revert RequestClosed();

        if (request.winningOutput == bytes32(0)) {
            if (block.timestamp < request.deadline) revert RequestClosed();
            revert QuorumNotReached();
        }

        request.finalized = true;
        uint256 minerAmount = (request.fee * 90) / 100;
        uint256 platformAmount = request.fee - minerAmount;
        request.fee = 0;
        claimable[owner] += platformAmount;
        claimable[request.winningMiner] += minerAmount;
        emit FeeAllocated(
            requestId,
            owner,
            request.winningMiner,
            platformAmount,
            minerAmount
        );
        emit RequestFinalized(
            requestId,
            request.winningOutput,
            request.winningCount >= request.quorum
        );
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
        if (requestId == 0 || requestId > requestCount) {
            revert UnknownRequest();
        }
        Request storage request = requests[requestId];
        if (msg.sender != request.requester || block.timestamp < request.deadline) {
            revert RefundUnavailable();
        }
        if (request.finalized || request.refunded || request.winningOutput != bytes32(0)) {
            revert RefundUnavailable();
        }

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

    function _validClaim(
        uint256 requestId,
        bytes32 outputHash,
        address miner,
        uint256 nonce
    ) internal pure returns (bool) {
        uint256 target = type(uint256).max >> CLAIM_DIFFICULTY;
        uint256 proof = uint256(
            keccak256(abi.encodePacked(requestId, outputHash, miner, nonce))
        );
        return proof < target;
    }
}
