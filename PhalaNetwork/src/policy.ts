import { getAddress, zeroHash } from "viem";
import { SUBMITTED_JOB_STATUS } from "./contracts.js";
import { evidenceCommitment, expectedChallenge } from "./evidence.js";
import { invalidEvidence } from "./errors.js";
import type { Config } from "./config.js";
import type { DemoEvidenceV1, JobSnapshot } from "./types.js";

export function validateEvidence(
  evidence: DemoEvidenceV1,
  snapshot: JobSnapshot,
  config: Config,
): `0x${string}` {
  if (snapshot.id === 0n || snapshot.id !== evidence.jobId) throw invalidEvidence("JOB_NOT_FOUND");
  if (snapshot.status !== SUBMITTED_JOB_STATUS) throw invalidEvidence("JOB_NOT_SUBMITTED");
  if (getAddress(snapshot.evaluator) !== config.evaluatorAddress) {
    throw invalidEvidence("EVALUATOR_MISMATCH");
  }
  if (getAddress(snapshot.hook) !== config.evidenceHookAddress) throw invalidEvidence("HOOK_MISMATCH");
  if (evidence.robotId !== config.expectedRobotId) throw invalidEvidence("ROBOT_ID_MISMATCH");
  if (evidence.challenge !== expectedChallenge(evidence.jobId, evidence.scenario)) {
    throw invalidEvidence("CHALLENGE_MISMATCH");
  }
  if (evidence.sequence !== config.expectedSequence) throw invalidEvidence("SEQUENCE_MISMATCH");
  if (evidence.checkpoint !== config.expectedCheckpoint) throw invalidEvidence("CHECKPOINT_MISMATCH");

  if (
    evidence.capturedAt > snapshot.blockTimestamp + config.maxClockSkewSeconds ||
    evidence.capturedAt >= snapshot.expiredAt ||
    snapshot.blockTimestamp >= snapshot.expiredAt
  ) {
    throw invalidEvidence("EVIDENCE_TIME_INVALID");
  }
  if (snapshot.blockTimestamp > evidence.capturedAt + config.maxEvidenceAgeSeconds) {
    throw invalidEvidence("EVIDENCE_TOO_OLD");
  }

  const computed = evidenceCommitment(evidence);
  if (snapshot.evidenceCommitment === zeroHash || computed.toLowerCase() !== snapshot.evidenceCommitment.toLowerCase()) {
    throw invalidEvidence("EVIDENCE_HASH_MISMATCH");
  }
  return computed;
}
