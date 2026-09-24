// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AIShardUnlock {
    address public immutable owner;
    uint256 public shardCount;

    struct Shard {
        string cid;
        bytes32 shardHash;
        uint256 difficulty;
        bool unlocked;
    }

    mapping(uint256 => Shard) public shards;
    mapping(uint256 => string) public shardMessage;

    event ShardUnlocked(
        uint256 indexed shardId,
        address indexed miner,
        string message,
        string cid,
        bytes32 shardHash,
        uint256 nonce
    );

    error NotOwner();
    error UnknownShard();
    error AlreadyUnlocked();
    error InvalidProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addShard(
        string calldata cid,
        bytes32 shardHash,
        uint256 difficulty,
        string calldata message
    ) external onlyOwner {
        uint256 shardId = shardCount;
        shards[shardId] = Shard(cid, shardHash, difficulty, false);
        shardMessage[shardId] = message;
        shardCount = shardId + 1;
    }

    function submitProof(uint256 shardId, uint256 nonce) external {
        if (shardId >= shardCount) revert UnknownShard();
        Shard storage s = shards[shardId];
        if (s.unlocked) revert AlreadyUnlocked();
        if (!_validProof(shardId, nonce, s.difficulty)) revert InvalidProof();

        s.unlocked = true;
        emit ShardUnlocked(
            shardId,
            msg.sender,
            shardMessage[shardId],
            s.cid,
            s.shardHash,
            nonce
        );
    }

    function isUnlocked(uint256 shardId) external view returns (bool) {
        return shards[shardId].unlocked;
    }

    function _validProof(
        uint256 shardId,
        uint256 nonce,
        uint256 difficulty
    ) internal pure returns (bool) {
        uint256 target = type(uint256).max >> difficulty;
        uint256 h = uint256(keccak256(abi.encodePacked(shardId, nonce)));
        return h < target;
    }
}
