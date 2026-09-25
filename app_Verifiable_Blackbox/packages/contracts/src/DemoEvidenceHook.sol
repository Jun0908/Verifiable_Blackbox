// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IACPHook } from "../vendor/erc8183/IACPHook.sol";

/// @notice Minimal ERC-8183 hook used by the hackathon demo.
/// @dev It records only the deliverable commitment submitted by the provider.
contract DemoEvidenceHook is IACPHook {
    address public immutable core;

    bytes4 public constant SUBMIT_SELECTOR = bytes4(keccak256("submit(uint256,bytes32,bytes)"));

    mapping(uint256 jobId => bytes32 commitment) public evidenceCommitments;

    event EvidenceCommitted(uint256 indexed jobId, bytes32 indexed evidenceCommitment);

    error OnlyCore();
    error ZeroAddress();
    error ZeroEvidenceCommitment();
    error EvidenceAlreadyCommitted();

    constructor(address core_) {
        if (core_ == address(0)) revert ZeroAddress();
        core = core_;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert OnlyCore();
        _;
    }

    function beforeAction(uint256, bytes4 selector, bytes calldata data) external view onlyCore {
        if (selector != SUBMIT_SELECTOR) return;

        (, bytes32 evidenceCommitment,) = abi.decode(data, (address, bytes32, bytes));
        if (evidenceCommitment == bytes32(0)) revert ZeroEvidenceCommitment();
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyCore {
        if (selector != SUBMIT_SELECTOR) return;
        if (evidenceCommitments[jobId] != bytes32(0)) revert EvidenceAlreadyCommitted();

        (, bytes32 evidenceCommitment,) = abi.decode(data, (address, bytes32, bytes));
        if (evidenceCommitment == bytes32(0)) revert ZeroEvidenceCommitment();

        evidenceCommitments[jobId] = evidenceCommitment;
        emit EvidenceCommitted(jobId, evidenceCommitment);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}

