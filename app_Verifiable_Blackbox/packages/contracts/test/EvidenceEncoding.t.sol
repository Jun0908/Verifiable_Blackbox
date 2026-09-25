// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";

contract EvidenceEncodingTest is Test {
    function test_TypeScriptAndSolidityCommitmentAgree() public pure {
        bytes32 commitment = keccak256(abi.encode(
            "DEMO_EVIDENCE_V1", uint256(1), "rover-demo-001", "challenge-success-1",
            uint64(1800000000), bytes32(uint256(0xcafe)), "checkpoint-a", uint256(1)
        ));
        assertEq(commitment, 0xd6d4bcf5e475d8245babcb9f5b6f37d8066c591476ae8acffd77ac0f5850248d);
    }
}
