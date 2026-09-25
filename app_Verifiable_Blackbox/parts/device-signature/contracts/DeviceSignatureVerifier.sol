// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC7913P256Verifier} from "@openzeppelin/contracts/utils/cryptography/verifiers/ERC7913P256Verifier.sol";

/// @notice Standalone read-only verifier. Does not manage jobs or payments.
contract DeviceSignatureVerifier is ERC7913P256Verifier {
    function hashJob(uint256 chainId, address core, uint256 jobId) external pure returns (bytes32) {
        return sha256(abi.encode(sha256("DeviceJobSignatureV1"), chainId, core, jobId));
    }
}
