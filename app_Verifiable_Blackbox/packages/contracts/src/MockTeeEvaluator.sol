// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { AgenticCommerce } from "../vendor/erc8183/AgenticCommerce.sol";
import { DemoEvidenceHook } from "./DemoEvidenceHook.sol";

/// @notice Demo evaluator accepting one fixed Mock TEE signer.
/// @dev This is intentionally not a Remote Attestation verifier.
contract MockTeeEvaluator is EIP712 {
    using ECDSA for bytes32;

    uint8 public constant PASS = 1;
    uint64 public constant MAX_VERDICT_TTL = 15 minutes;
    uint64 public constant MAX_CLOCK_SKEW = 60 seconds;

    bytes32 public constant VERDICT_TYPEHASH = keccak256(
        "DemoVerdictV1(uint256 jobId,address provider,bytes32 evidenceCommitment,uint8 outcome,uint64 issuedAt,uint64 validUntil,bytes32 nonce)"
    );

    AgenticCommerce public immutable core;
    DemoEvidenceHook public immutable evidenceHook;
    address public immutable mockTeeSigner;

    struct DemoVerdictV1 {
        uint256 jobId;
        address provider;
        bytes32 evidenceCommitment;
        uint8 outcome;
        uint64 issuedAt;
        uint64 validUntil;
        bytes32 nonce;
    }

    struct DemoReceiptV1 {
        bytes32 receiptId;
        uint256 jobId;
        address provider;
        bytes32 evidenceCommitment;
        bytes32 verdictDigest;
        address verdictSigner;
        uint64 completedAt;
    }

    mapping(bytes32 verdictDigest => bool consumed) public consumedVerdicts;
    mapping(bytes32 receiptId => DemoReceiptV1 receipt) private _receipts;
    mapping(uint256 jobId => bytes32 receiptId) public receiptIdByJob;

    event DemoWorkReceiptIssued(
        bytes32 indexed receiptId,
        uint256 indexed jobId,
        address indexed provider,
        bytes32 evidenceCommitment,
        bytes32 verdictDigest,
        address verdictSigner
    );

    error ZeroAddress();
    error InvalidJob();
    error JobNotSubmitted();
    error WrongEvaluator();
    error WrongHook();
    error ProviderMismatch();
    error EvidenceMismatch();
    error JobExpired();
    error InvalidOutcome();
    error InvalidVerdictTime();
    error VerdictAlreadyUsed();
    error InvalidSigner();

    constructor(address core_, address evidenceHook_, address mockTeeSigner_)
        EIP712("VerifiableBlackboxDemo", "1")
    {
        if (core_ == address(0) || evidenceHook_ == address(0) || mockTeeSigner_ == address(0)) {
            revert ZeroAddress();
        }

        core = AgenticCommerce(core_);
        evidenceHook = DemoEvidenceHook(evidenceHook_);
        mockTeeSigner = mockTeeSigner_;
    }

    function settle(DemoVerdictV1 calldata verdict, bytes calldata signature)
        external
        returns (bytes32 receiptId)
    {
        if (verdict.outcome != PASS) revert InvalidOutcome();
        if (
            verdict.issuedAt > block.timestamp + MAX_CLOCK_SKEW
                || verdict.validUntil <= block.timestamp || verdict.validUntil < verdict.issuedAt
                || verdict.validUntil - verdict.issuedAt > MAX_VERDICT_TTL
        ) revert InvalidVerdictTime();

        AgenticCommerce.Job memory job = core.getJob(verdict.jobId);
        if (job.id == 0) revert InvalidJob();
        if (job.status != AgenticCommerce.JobStatus.Submitted) revert JobNotSubmitted();
        if (job.evaluator != address(this)) revert WrongEvaluator();
        if (job.hook != address(evidenceHook)) revert WrongHook();
        if (job.provider != verdict.provider) revert ProviderMismatch();
        if (block.timestamp >= job.expiredAt || verdict.validUntil > job.expiredAt) {
            revert JobExpired();
        }

        bytes32 committedEvidence = evidenceHook.evidenceCommitments(verdict.jobId);
        if (committedEvidence == bytes32(0) || committedEvidence != verdict.evidenceCommitment) {
            revert EvidenceMismatch();
        }

        bytes32 verdictDigest = hashVerdict(verdict);
        if (consumedVerdicts[verdictDigest]) revert VerdictAlreadyUsed();
        if (verdictDigest.recover(signature) != mockTeeSigner) revert InvalidSigner();

        consumedVerdicts[verdictDigest] = true;
        receiptId =
            keccak256(abi.encode(block.chainid, address(core), verdict.jobId, verdictDigest));

        core.complete(verdict.jobId, receiptId, "");

        _receipts[receiptId] = DemoReceiptV1({
            receiptId: receiptId,
            jobId: verdict.jobId,
            provider: verdict.provider,
            evidenceCommitment: verdict.evidenceCommitment,
            verdictDigest: verdictDigest,
            verdictSigner: mockTeeSigner,
            completedAt: uint64(block.timestamp)
        });
        receiptIdByJob[verdict.jobId] = receiptId;

        emit DemoWorkReceiptIssued(
            receiptId,
            verdict.jobId,
            verdict.provider,
            verdict.evidenceCommitment,
            verdictDigest,
            mockTeeSigner
        );
    }

    function hashVerdict(DemoVerdictV1 calldata verdict) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                VERDICT_TYPEHASH,
                verdict.jobId,
                verdict.provider,
                verdict.evidenceCommitment,
                verdict.outcome,
                verdict.issuedAt,
                verdict.validUntil,
                verdict.nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function getReceipt(bytes32 receiptId) external view returns (DemoReceiptV1 memory) {
        return _receipts[receiptId];
    }
}

