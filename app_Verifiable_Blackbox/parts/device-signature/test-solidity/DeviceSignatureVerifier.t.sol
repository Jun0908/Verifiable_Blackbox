// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {DeviceSignatureVerifier} from "../contracts/DeviceSignatureVerifier.sol";

contract DeviceSignatureVerifierTest is Test {
    DeviceSignatureVerifier verifier;
    bytes key = hex"6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";
    bytes signature = hex"912032de7aaa10422f0a8bf8798a5a4f773c4d7d85bb81b1815456ceb8e66b5c7257a212bb59eebf4138a76c693a2e3cb2c60125a81092b2e055719c66732aca";
    bytes32 constant DIGEST = 0x8d849a9246abf71ae4cf7189f16cf68676e86d3e6f8c1596b95b8c080e02189b;
    address constant CORE = 0x1111111111111111111111111111111111111111;

    function setUp() public { verifier = new DeviceSignatureVerifier(); }

    function testSharedFixtureAndEncoding() public view {
        assertEq(verifier.hashJob(31337, CORE, 7), DIGEST);
        assertEq(verifier.verify(key, DIGEST, signature), bytes4(0x024ad318));
    }

    function testOtherJobChainCoreRejected() public view {
        assertEq(verifier.verify(key, verifier.hashJob(31337, CORE, 8), signature), bytes4(0xffffffff));
        assertEq(verifier.verify(key, verifier.hashJob(1, CORE, 7), signature), bytes4(0xffffffff));
        assertEq(verifier.verify(key, verifier.hashJob(31337, address(2), 7), signature), bytes4(0xffffffff));
    }

    function testInvalidKeyAndSignatureRejected() public view {
        assertEq(verifier.verify(new bytes(64), DIGEST, signature), bytes4(0xffffffff));
        assertEq(verifier.verify(key, DIGEST, new bytes(64)), bytes4(0xffffffff));
        assertEq(verifier.verify(key, DIGEST, hex"01"), bytes4(0xffffffff));
    }

    function testHighSRejected() public view {
        uint256 s;
        for (uint256 i = 32; i < 64; i++) s = (s << 8) | uint8(signature[i]);
        bytes memory altered = abi.encodePacked(
            bytes32(signature),
            bytes32(uint256(0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551)
              - s)
        );
        assertEq(verifier.verify(key, DIGEST, altered), bytes4(0xffffffff));
    }

    function testFuzzChangedJobRejected(uint256 jobId) public view {
        vm.assume(jobId != 7);
        assertEq(verifier.verify(key, verifier.hashJob(31337, CORE, jobId), signature), bytes4(0xffffffff));
    }
}
