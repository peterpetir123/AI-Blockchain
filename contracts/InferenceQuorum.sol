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
        bytes32 inputHash;
        uint256 quorum;
        uint256 deadline;
        bool finalized;
        bytes32 winningOutput;
        uint256 winningCount;
    }

    address public immutable owner;
    IModelRegistryVersion public immutable modelRegistry;
    uint256 public requestCount;

    mapping(uint256 => Request) public requests;
    mapping(uint256 => mapping(address => bytes32)) public submissions;
    mapping(uint256 => mapping(bytes32 => uint256)) public tally;

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

    error NotOwner();
    error InvalidRequest();
    error UnknownRequest();
    error RequestClosed();
    error AlreadySubmitted();
    error InvalidOutput();
    error QuorumNotReached();
    error NotImplemented();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address modelRegistryAddress) {
        if (modelRegistryAddress == address(0)) revert InvalidRequest();
        owner = msg.sender;
        modelRegistry = IModelRegistryVersion(modelRegistryAddress);
    }

    function createRequest(
        uint256 modelVersion,
        bytes32 inputHash,
        uint256 quorum,
        uint256 deadline
    ) external onlyOwner returns (uint256) {
        if (
            modelVersion == 0 ||
            modelVersion != modelRegistry.activeModelVersion() ||
            inputHash == bytes32(0) ||
            quorum == 0 ||
            deadline <= block.timestamp
        ) revert InvalidRequest();

        uint256 requestId = ++requestCount;
        requests[requestId] = Request({
            modelVersion: modelVersion,
            inputHash: inputHash,
            quorum: quorum,
            deadline: deadline,
            finalized: false,
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

    function submitOutput(uint256 requestId, bytes32 outputHash) external {
        if (requestId == 0 || requestId > requestCount) {
            revert UnknownRequest();
        }
        Request storage request = requests[requestId];
        if (request.finalized || block.timestamp >= request.deadline) {
            revert RequestClosed();
        }
        if (outputHash == bytes32(0)) revert InvalidOutput();
        if (submissions[requestId][msg.sender] != bytes32(0)) {
            revert AlreadySubmitted();
        }

        submissions[requestId][msg.sender] = outputHash;
        uint256 count = ++tally[requestId][outputHash];
        emit OutputSubmitted(requestId, msg.sender, outputHash);

        if (count >= request.quorum) {
            if (request.winningOutput == bytes32(0)) {
                request.winningOutput = outputHash;
                request.winningCount = count;
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
        emit RequestFinalized(
            requestId,
            request.winningOutput,
            request.winningCount >= request.quorum
        );
    }

    function isVerified(uint256 requestId) external view returns (bool) {
        if (requestId == 0 || requestId > requestCount) return false;
        Request storage request = requests[requestId];
        return request.finalized && request.winningCount >= request.quorum;
    }
}
