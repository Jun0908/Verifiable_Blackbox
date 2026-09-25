import { loadConfig } from "../src/config.js";
import { evidenceCommitment, parseEvidence } from "../src/evidence.js";
import type { DemoEvidenceV1, JobSnapshot } from "../src/types.js";

export const LOCAL_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

export const config = loadConfig({
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  ERC8183_ADDRESS: "0x0000000000000000000000000000000000000001",
  EVIDENCE_HOOK_ADDRESS: "0x0000000000000000000000000000000000000002",
  EVALUATOR_ADDRESS: "0x0000000000000000000000000000000000000003",
  VERIFIER_MODE: "LOCAL_DEV",
  VERDICT_SIGNING_KEY: LOCAL_PRIVATE_KEY,
});

export const evidence: DemoEvidenceV1 = parseEvidence({
  jobId: "42",
  scenario: "success",
  robotId: "rover-demo-001",
  challenge: "challenge-success-42",
  capturedAt: 1_700_000_000,
  imageHash: "0x000000000000000000000000000000000000000000000000000000000000cafe",
  checkpoint: "checkpoint-a",
  sequence: 1,
});

export function snapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: evidence.jobId,
    provider: "0x0000000000000000000000000000000000000004",
    evaluator: config.evaluatorAddress,
    hook: config.evidenceHookAddress,
    expiredAt: 1_700_001_000n,
    status: 2,
    evidenceCommitment: evidenceCommitment(evidence),
    blockTimestamp: 1_700_000_100n,
    ...overrides,
  };
}
