// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { MockUSDC } from "../src/MockUSDC.sol";
import { DemoEvidenceHook } from "../src/DemoEvidenceHook.sol";
import { MockTeeEvaluator } from "../src/MockTeeEvaluator.sol";
import { AgenticCommerce } from "../vendor/erc8183/AgenticCommerce.sol";
import { HackathonAgenticCommerce } from "../src/HackathonAgenticCommerce.sol";

contract HackathonDemoTest is Test {
    uint256 internal constant CLIENT_START_BALANCE = 1_000e6;
    uint256 internal constant JOB_BUDGET = 100e6;
    uint256 internal constant MOCK_TEE_PRIVATE_KEY = 0xA11CE;
    uint256 internal constant INVALID_TEE_PRIVATE_KEY = 0xB0B;

    address internal client;
    address internal provider;
    address internal relayer;
    address internal mockTeeSigner;

    MockUSDC internal token;
    HackathonAgenticCommerce internal core;
    DemoEvidenceHook internal evidenceHook;
    MockTeeEvaluator internal evaluator;

    function setUp() public {
        vm.warp(1_800_000_000);

        client = makeAddr("client");
        provider = makeAddr("provider");
        relayer = makeAddr("relayer");
        mockTeeSigner = vm.addr(MOCK_TEE_PRIVATE_KEY);

        token = new MockUSDC(address(this));

        HackathonAgenticCommerce implementation = new HackathonAgenticCommerce();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(AgenticCommerce.initialize, (address(token), address(this)))
        );
        core = HackathonAgenticCommerce(address(proxy));

        evidenceHook = new DemoEvidenceHook(address(core));
        evaluator = new MockTeeEvaluator(address(core), address(evidenceHook), mockTeeSigner);

        core.setHookWhitelist(address(evidenceHook), true);
        token.mint(client, CLIENT_START_BALANCE);
        token.transferOwnership(address(core));
    }

    function test_OneClickDemoCreatesAndFundsWithoutApproval() public {
        vm.prank(client);
        uint256 jobId = core.createAndFundDemo(
            provider,
            address(evaluator),
            block.timestamp + 1 days,
            "vbb://demo/one-click",
            address(evidenceHook)
        );

        AgenticCommerce.Job memory job = core.getJob(jobId);
        assertEq(job.client, client);
        assertEq(job.budget, JOB_BUDGET);
        assertEq(uint8(job.status), uint8(AgenticCommerce.JobStatus.Funded));
        assertEq(token.balanceOf(client), CLIENT_START_BALANCE);
        assertEq(token.balanceOf(address(core)), JOB_BUDGET);
        assertEq(token.allowance(client, address(core)), 0);
    }

    function test_OneClickDemoConsumesOldExactAllowance() public {
        vm.prank(client);
        token.approve(address(core), JOB_BUDGET);

        vm.prank(client);
        core.createAndFundDemo(
            provider,
            address(evaluator),
            block.timestamp + 1 days,
            "vbb://demo/approved-client",
            address(evidenceHook)
        );

        assertEq(token.balanceOf(client), CLIENT_START_BALANCE - JOB_BUDGET);
        assertEq(token.balanceOf(address(core)), JOB_BUDGET);
        assertEq(token.allowance(client, address(core)), 0);
    }

    function test_HappyPath_Releases100MockUsdc() public {
        (uint256 jobId, bytes32 evidenceCommitment) = _createSubmittedJob();
        MockTeeEvaluator.DemoVerdictV1 memory verdict = _validVerdict(jobId, evidenceCommitment);
        bytes32 verdictDigest = evaluator.hashVerdict(verdict);
        bytes memory signature = _sign(MOCK_TEE_PRIVATE_KEY, verdictDigest);

        vm.prank(relayer);
        bytes32 receiptId = evaluator.settle(verdict, signature);

        AgenticCommerce.Job memory completedJob = core.getJob(jobId);
        MockTeeEvaluator.DemoReceiptV1 memory receipt = evaluator.getReceipt(receiptId);

        assertEq(uint8(completedJob.status), uint8(AgenticCommerce.JobStatus.Completed));
        assertEq(token.balanceOf(client), 900e6);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(token.balanceOf(provider), JOB_BUDGET);
        assertEq(evaluator.receiptIdByJob(jobId), receiptId);
        assertTrue(evaluator.consumedVerdicts(verdictDigest));

        assertEq(receipt.receiptId, receiptId);
        assertEq(receipt.jobId, jobId);
        assertEq(receipt.provider, provider);
        assertEq(receipt.evidenceCommitment, evidenceCommitment);
        assertEq(receipt.verdictDigest, verdictDigest);
        assertEq(receipt.verdictSigner, mockTeeSigner);
    }

    function test_TamperedEvidence_DoesNotReleasePayment() public {
        (uint256 jobId, bytes32 evidenceCommitment) = _createSubmittedJob();
        bytes32 tamperedEvidence = keccak256(abi.encode(evidenceCommitment, "tampered"));
        MockTeeEvaluator.DemoVerdictV1 memory verdict = _validVerdict(jobId, tamperedEvidence);
        bytes memory signature = _sign(MOCK_TEE_PRIVATE_KEY, evaluator.hashVerdict(verdict));

        vm.expectRevert(MockTeeEvaluator.EvidenceMismatch.selector);
        vm.prank(relayer);
        evaluator.settle(verdict, signature);

        _assertPaymentStillEscrowed(jobId);
    }

    function test_InvalidTeeSignature_DoesNotReleasePayment() public {
        (uint256 jobId, bytes32 evidenceCommitment) = _createSubmittedJob();
        MockTeeEvaluator.DemoVerdictV1 memory verdict = _validVerdict(jobId, evidenceCommitment);
        bytes memory invalidSignature =
            _sign(INVALID_TEE_PRIVATE_KEY, evaluator.hashVerdict(verdict));

        vm.expectRevert(MockTeeEvaluator.InvalidSigner.selector);
        vm.prank(relayer);
        evaluator.settle(verdict, invalidSignature);

        _assertPaymentStillEscrowed(jobId);
    }

    function test_ExpiredVerdictKeepsEscrow() public {
        (uint256 jobId, bytes32 commitment) = _createSubmittedJob();
        MockTeeEvaluator.DemoVerdictV1 memory verdict = _validVerdict(jobId, commitment);
        bytes memory signature = _sign(MOCK_TEE_PRIVATE_KEY, evaluator.hashVerdict(verdict));
        vm.warp(verdict.validUntil);
        vm.expectRevert(MockTeeEvaluator.InvalidVerdictTime.selector);
        evaluator.settle(verdict, signature);
        _assertPaymentStillEscrowed(jobId);
    }

    function test_ExpiredJobKeepsEscrow() public {
        (uint256 jobId, bytes32 commitment) = _createSubmittedJob();
        vm.warp(block.timestamp + 1 days);
        MockTeeEvaluator.DemoVerdictV1 memory verdict = _validVerdict(jobId, commitment);
        bytes memory signature = _sign(MOCK_TEE_PRIVATE_KEY, evaluator.hashVerdict(verdict));
        vm.expectRevert(MockTeeEvaluator.JobExpired.selector);
        evaluator.settle(verdict, signature);
        _assertPaymentStillEscrowed(jobId);
    }

    function test_ReplayCannotPayTwice() public {
        (uint256 jobId, bytes32 commitment) = _createSubmittedJob();
        MockTeeEvaluator.DemoVerdictV1 memory verdict = _validVerdict(jobId, commitment);
        bytes memory signature = _sign(MOCK_TEE_PRIVATE_KEY, evaluator.hashVerdict(verdict));
        bytes32 receiptId = evaluator.settle(verdict, signature);
        vm.expectRevert(MockTeeEvaluator.JobNotSubmitted.selector);
        evaluator.settle(verdict, signature);
        assertEq(token.balanceOf(provider), JOB_BUDGET);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(evaluator.receiptIdByJob(jobId), receiptId);
    }

    function test_WrongProviderKeepsEscrow() public {
        (uint256 jobId, bytes32 commitment) = _createSubmittedJob();
        MockTeeEvaluator.DemoVerdictV1 memory verdict = _validVerdict(jobId, commitment);
        verdict.provider = client;
        bytes memory signature = _sign(MOCK_TEE_PRIVATE_KEY, evaluator.hashVerdict(verdict));
        vm.expectRevert(MockTeeEvaluator.ProviderMismatch.selector);
        evaluator.settle(verdict, signature);
        _assertPaymentStillEscrowed(jobId);
    }

    function _createSubmittedJob() internal returns (uint256 jobId, bytes32 evidenceCommitment) {
        vm.prank(client);
        jobId = core.createJob(
            provider,
            address(evaluator),
            block.timestamp + 1 days,
            "vbb://demo/inspection-checkpoint-a",
            address(evidenceHook)
        );

        vm.prank(provider);
        core.setBudget(jobId, JOB_BUDGET, "");

        vm.startPrank(client);
        token.approve(address(core), JOB_BUDGET);
        core.fund(jobId, "");
        vm.stopPrank();

        evidenceCommitment = keccak256(
            abi.encode(
                "DEMO_EVIDENCE_V1",
                jobId,
                "rover-demo-001",
                "checkpoint-a",
                bytes32(uint256(0xCAFE))
            )
        );

        vm.prank(provider);
        core.submit(jobId, evidenceCommitment, "");

        assertEq(evidenceHook.evidenceCommitments(jobId), evidenceCommitment);
        assertEq(token.balanceOf(client), 900e6);
        assertEq(token.balanceOf(address(core)), JOB_BUDGET);
        assertEq(token.balanceOf(provider), 0);
    }

    function _validVerdict(uint256 jobId, bytes32 evidenceCommitment)
        internal
        view
        returns (MockTeeEvaluator.DemoVerdictV1 memory)
    {
        return MockTeeEvaluator.DemoVerdictV1({
            jobId: jobId,
            provider: provider,
            evidenceCommitment: evidenceCommitment,
            outcome: evaluator.PASS(),
            issuedAt: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 5 minutes),
            nonce: keccak256(abi.encode("demo-verdict", jobId, evidenceCommitment))
        });
    }

    function _sign(uint256 privateKey, bytes32 digest)
        internal
        pure
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _assertPaymentStillEscrowed(uint256 jobId) internal view {
        AgenticCommerce.Job memory submittedJob = core.getJob(jobId);
        assertEq(uint8(submittedJob.status), uint8(AgenticCommerce.JobStatus.Submitted));
        assertEq(token.balanceOf(client), 900e6);
        assertEq(token.balanceOf(address(core)), JOB_BUDGET);
        assertEq(token.balanceOf(provider), 0);
        assertEq(evaluator.receiptIdByJob(jobId), bytes32(0));
    }
}
