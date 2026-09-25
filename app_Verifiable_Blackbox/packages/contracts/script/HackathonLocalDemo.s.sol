// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { MockUSDC } from "../src/MockUSDC.sol";
import { DemoEvidenceHook } from "../src/DemoEvidenceHook.sol";
import { MockTeeEvaluator } from "../src/MockTeeEvaluator.sol";
import { AgenticCommerce } from "../vendor/erc8183/AgenticCommerce.sol";
import { HackathonAgenticCommerce } from "../src/HackathonAgenticCommerce.sol";

contract HackathonLocalDemo is Script {
    uint256 internal constant DEFAULT_DEPLOYER_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant DEFAULT_CLIENT_PRIVATE_KEY = 0xC11E17;
    uint256 internal constant DEFAULT_PROVIDER_PRIVATE_KEY = 0xB0B;
    uint256 internal constant DEFAULT_RELAYER_PRIVATE_KEY = 0xD00D;
    uint256 internal constant DEFAULT_TEE_PRIVATE_KEY = 0xA11CE;

    uint256 internal constant CLIENT_START_BALANCE = 1_000e6;
    uint256 internal constant JOB_BUDGET = 100e6;

    struct DemoContracts {
        MockUSDC token;
        AgenticCommerce core;
        DemoEvidenceHook hook;
        MockTeeEvaluator evaluator;
    }

    struct DemoActors {
        uint256 clientKey;
        uint256 providerKey;
        uint256 relayerKey;
        address client;
        address provider;
        address relayer;
        address teeSigner;
    }

    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_PRIVATE_KEY);
        uint256 teeKey = vm.envOr("DEMO_TEE_PRIVATE_KEY", DEFAULT_TEE_PRIVATE_KEY);
        DemoActors memory actors = _actors(teeKey);
        DemoContracts memory demo = _deploy(deployerKey, actors);

        _writeDeployment(demo, actors.provider, actors.relayer, actors.teeSigner);
        _runSuccess(demo, actors, teeKey);
        _runTampered(demo, actors, teeKey);
    }

    function _actors(uint256 teeKey) internal returns (DemoActors memory actors) {
        actors.clientKey = vm.envOr("DEMO_CLIENT_PRIVATE_KEY", DEFAULT_CLIENT_PRIVATE_KEY);
        actors.providerKey = vm.envOr("DEMO_PROVIDER_PRIVATE_KEY", DEFAULT_PROVIDER_PRIVATE_KEY);
        actors.relayerKey = vm.envOr("DEMO_RELAYER_PRIVATE_KEY", DEFAULT_RELAYER_PRIVATE_KEY);
        actors.client = vm.addr(actors.clientKey);
        actors.provider = vm.addr(actors.providerKey);
        actors.relayer = vm.addr(actors.relayerKey);
        actors.teeSigner = vm.addr(teeKey);
    }

    function _deploy(uint256 deployerKey, DemoActors memory actors)
        internal
        returns (DemoContracts memory demo)
    {
        vm.startBroadcast(deployerKey);

        _fundGas(actors.client);
        _fundGas(actors.provider);
        _fundGas(actors.relayer);

        demo.token = new MockUSDC(vm.addr(deployerKey));
        HackathonAgenticCommerce implementation = new HackathonAgenticCommerce();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(AgenticCommerce.initialize, (address(demo.token), vm.addr(deployerKey)))
        );
        demo.core = AgenticCommerce(address(proxy));
        demo.hook = new DemoEvidenceHook(address(demo.core));
        demo.evaluator =
            new MockTeeEvaluator(address(demo.core), address(demo.hook), actors.teeSigner);

        demo.core.setHookWhitelist(address(demo.hook), true);
        demo.token.mint(actors.client, CLIENT_START_BALANCE);
        demo.token.transferOwnership(address(demo.core));
        vm.stopBroadcast();

        console2.log("Chain ID", block.chainid);
        console2.log("MockUSDC", address(demo.token));
        console2.log("ERC-8183 Core", address(demo.core));
        console2.log("DemoEvidenceHook", address(demo.hook));
        console2.log("MockTeeEvaluator", address(demo.evaluator));
        console2.log("Client", actors.client);
        console2.log("Provider", actors.provider);
        console2.log("Relayer", actors.relayer);
        console2.log("Mock TEE signer", actors.teeSigner);
    }

    function _runSuccess(DemoContracts memory demo, DemoActors memory actors, uint256 teeKey)
        internal
    {
        console2.log("");
        console2.log("=== SUCCESS SCENARIO ===");
        (uint256 jobId, bytes32 commitment) = _createSubmittedJob(demo, actors, "success");
        MockTeeEvaluator.DemoVerdictV1 memory verdict =
            _verdict(demo, jobId, actors.provider, commitment, "success");
        bytes memory signature = _sign(teeKey, demo.evaluator.hashVerdict(verdict));

        vm.startBroadcast(actors.relayerKey);
        bytes32 receiptId = demo.evaluator.settle(verdict, signature);
        vm.stopBroadcast();

        _printSuccess(demo, jobId, commitment, receiptId, actors.client, actors.provider);
    }

    function _runTampered(DemoContracts memory demo, DemoActors memory actors, uint256 teeKey)
        internal
    {
        console2.log("");
        console2.log("=== TAMPERED SCENARIO ===");
        (uint256 jobId, bytes32 originalCommitment) = _createSubmittedJob(demo, actors, "tampered");
        bytes32 tamperedCommitment = keccak256(abi.encode(originalCommitment, "changed"));
        MockTeeEvaluator.DemoVerdictV1 memory verdict =
            _verdict(demo, jobId, actors.provider, tamperedCommitment, "tampered");
        bytes memory signature = _sign(teeKey, demo.evaluator.hashVerdict(verdict));

        vm.prank(actors.relayer);
        (bool settled,) = address(demo.evaluator)
            .call(abi.encodeCall(MockTeeEvaluator.settle, (verdict, signature)));
        require(!settled, "tampered evidence unexpectedly settled");

        _printFailure(demo, jobId, originalCommitment, tamperedCommitment, actors.provider);
    }

    function _fundGas(address recipient) internal {
        (bool funded,) = recipient.call{ value: 1 ether }("");
        require(funded, "gas funding failed");
    }

    function _createSubmittedJob(
        DemoContracts memory demo,
        DemoActors memory actors,
        string memory scenario
    ) internal returns (uint256 jobId, bytes32 evidenceCommitment) {
        vm.startBroadcast(actors.clientKey);
        jobId = demo.core
            .createJob(
                actors.provider,
                address(demo.evaluator),
                block.timestamp + 1 days,
                string.concat("vbb://demo/", scenario),
                address(demo.hook)
            );
        vm.stopBroadcast();

        vm.startBroadcast(actors.providerKey);
        demo.core.setBudget(jobId, JOB_BUDGET, "");
        vm.stopBroadcast();

        vm.startBroadcast(actors.clientKey);
        demo.token.approve(address(demo.core), JOB_BUDGET);
        demo.core.fund(jobId, "");
        vm.stopBroadcast();

        evidenceCommitment = _evidenceCommitment(jobId, scenario);
        vm.startBroadcast(actors.providerKey);
        demo.core.submit(jobId, evidenceCommitment, "");
        vm.stopBroadcast();

        require(demo.token.balanceOf(actors.client) >= 800e6, "unexpected client balance");
    }

    function _evidenceCommitment(uint256 jobId, string memory scenario)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "DEMO_EVIDENCE_V1",
                jobId,
                "rover-demo-001",
                string.concat("challenge-", scenario),
                bytes32(uint256(0xCAFE)),
                "checkpoint-a",
                uint256(1)
            )
        );
    }

    function _verdict(
        DemoContracts memory demo,
        uint256 jobId,
        address provider,
        bytes32 evidenceCommitment,
        string memory scenario
    ) internal view returns (MockTeeEvaluator.DemoVerdictV1 memory) {
        return MockTeeEvaluator.DemoVerdictV1({
                jobId: jobId,
                provider: provider,
                evidenceCommitment: evidenceCommitment,
                outcome: demo.evaluator.PASS(),
                issuedAt: uint64(block.timestamp),
                validUntil: uint64(block.timestamp + 5 minutes),
                nonce: keccak256(abi.encode("demo-verdict", scenario, jobId))
            });
    }

    function _sign(uint256 signerKey, bytes32 digest)
        internal
        pure
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _printSuccess(
        DemoContracts memory demo,
        uint256 jobId,
        bytes32 evidenceCommitment,
        bytes32 receiptId,
        address client,
        address provider
    ) internal view {
        AgenticCommerce.Job memory job = demo.core.getJob(jobId);
        console2.log("Job ID", jobId);
        console2.log("Status (3 = Completed)", uint256(job.status));
        console2.log("Evidence commitment");
        console2.logBytes32(evidenceCommitment);
        console2.log("Receipt ID");
        console2.logBytes32(receiptId);
        console2.log("Client mUSDC", demo.token.balanceOf(client) / 1e6);
        console2.log("Escrow mUSDC", demo.token.balanceOf(address(demo.core)) / 1e6);
        console2.log("Provider mUSDC", demo.token.balanceOf(provider) / 1e6);
        console2.log("PAYMENT RELEASED");
    }

    function _printFailure(
        DemoContracts memory demo,
        uint256 jobId,
        bytes32 originalCommitment,
        bytes32 tamperedCommitment,
        address provider
    ) internal view {
        AgenticCommerce.Job memory job = demo.core.getJob(jobId);
        console2.log("Job ID", jobId);
        console2.log("Status (2 = Submitted)", uint256(job.status));
        console2.log("Committed evidence");
        console2.logBytes32(originalCommitment);
        console2.log("Tampered evidence");
        console2.logBytes32(tamperedCommitment);
        console2.log("Receipt ID is zero");
        console2.logBytes32(demo.evaluator.receiptIdByJob(jobId));
        console2.log("Escrow mUSDC", demo.token.balanceOf(address(demo.core)) / 1e6);
        console2.log("Provider mUSDC (success job only)", demo.token.balanceOf(provider) / 1e6);
        console2.log("TEE REJECTED: EVIDENCE_HASH_MISMATCH");
        console2.log("PAYMENT BLOCKED");
    }

    function _writeDeployment(
        DemoContracts memory demo,
        address provider,
        address relayer,
        address teeSigner
    ) internal {
        string memory objectKey = "demo";
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "mockUsdc", address(demo.token));
        vm.serializeAddress(objectKey, "erc8183", address(demo.core));
        vm.serializeAddress(objectKey, "evidenceHook", address(demo.hook));
        vm.serializeAddress(objectKey, "evaluator", address(demo.evaluator));
        vm.serializeAddress(objectKey, "provider", provider);
        vm.serializeAddress(objectKey, "relayer", relayer);
        string memory json = vm.serializeAddress(objectKey, "mockTeeSigner", teeSigner);
        vm.writeJson(json, "deployments/demo.local.json");
    }
}
