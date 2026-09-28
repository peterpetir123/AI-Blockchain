// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ModelRegistry {
    struct ModelVersion {
        string cid;
        bytes32 modelHash;
        string name;
        string format;
        string quantization;
        string runtimeVersion;
    }

    address public immutable owner;
    uint256 public modelVersionCount;
    uint256 public activeModelVersion;
    mapping(uint256 => ModelVersion) public models;

    event ModelRegistered(
        uint256 indexed version,
        bytes32 indexed modelHash,
        string cid,
        string name,
        string format,
        string quantization,
        string runtimeVersion
    );
    event ModelActivated(uint256 indexed version);
    event InferenceRecorded(
        uint256 indexed modelVersion,
        address indexed node,
        bytes32 inputHash,
        bytes32 outputHash
    );

    error NotOwner();
    error InvalidModel();
    error UnknownModel();
    error NoActiveModel();
    error InvalidInferenceHash();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function registerModel(
        string calldata cid,
        bytes32 modelHash,
        string calldata name,
        string calldata format,
        string calldata quantization,
        string calldata runtimeVersion
    ) external onlyOwner returns (uint256 version) {
        if (
            bytes(cid).length == 0 || modelHash == bytes32(0) ||
            bytes(name).length == 0 || bytes(format).length == 0 ||
            bytes(runtimeVersion).length == 0
        ) revert InvalidModel();

        version = ++modelVersionCount;
        models[version] = ModelVersion({
            cid: cid,
            modelHash: modelHash,
            name: name,
            format: format,
            quantization: quantization,
            runtimeVersion: runtimeVersion
        });

        emit ModelRegistered(
            version,
            modelHash,
            cid,
            name,
            format,
            quantization,
            runtimeVersion
        );
    }

    function activateModel(uint256 version) external onlyOwner {
        if (version == 0 || version > modelVersionCount) revert UnknownModel();
        activeModelVersion = version;
        emit ModelActivated(version);
    }

    function recordInference(bytes32 inputHash, bytes32 outputHash) external {
        uint256 version = activeModelVersion;
        if (version == 0) revert NoActiveModel();
        if (inputHash == bytes32(0) || outputHash == bytes32(0)) {
            revert InvalidInferenceHash();
        }

        emit InferenceRecorded(version, msg.sender, inputHash, outputHash);
    }
}
