import { describe, expect, it } from "vitest";
import { zeroHash } from "viem";
import { evidenceCommitment } from "../src/evidence.js";
import { validateEvidence } from "../src/policy.js";
import { config, evidence, snapshot } from "./helpers.js";
describe("policy", () => {
  it("passes matching evidence including the tampered scenario label", () => {
    expect(validateEvidence(evidence, snapshot(), config)).toBe(evidenceCommitment(evidence));
    const e = { ...evidence, scenario: "tampered" as const, challenge: "challenge-tampered-42" };
    expect(validateEvidence(e, snapshot({evidenceCommitment: evidenceCommitment(e)}), config)).toBe(evidenceCommitment(e));
  });
  it.each([
    [{id: 0n}, "JOB_NOT_FOUND"], [{id: 43n}, "JOB_NOT_FOUND"], [{status: 1}, "JOB_NOT_SUBMITTED"],
    [{evaluator: "0x0000000000000000000000000000000000000009"}, "EVALUATOR_MISMATCH"],
    [{hook: "0x0000000000000000000000000000000000000009"}, "HOOK_MISMATCH"],
    [{expiredAt: 1700000100n}, "EVIDENCE_TIME_INVALID"],
    [{evidenceCommitment: zeroHash}, "EVIDENCE_HASH_MISMATCH"],
    [{evidenceCommitment: `0x${"ab".repeat(32)}`}, "EVIDENCE_HASH_MISMATCH"],
  ] as const)("rejects invalid Job %o", (patch, reason) => {
    expect(() => validateEvidence(evidence, snapshot(patch), config)).toThrow(reason);
  });
  it.each([
    [{robotId: "other"}, "ROBOT_ID_MISMATCH"], [{challenge: "other"}, "CHALLENGE_MISMATCH"],
    [{sequence: 2n}, "SEQUENCE_MISMATCH"], [{checkpoint: "other"}, "CHECKPOINT_MISMATCH"],
    [{capturedAt: 1700000161n}, "EVIDENCE_TIME_INVALID"], [{capturedAt: 1699999499n}, "EVIDENCE_TOO_OLD"],
    [{capturedAt: 1700001000n}, "EVIDENCE_TIME_INVALID"],
  ])("rejects invalid Evidence %o", (patch, reason) => {
    expect(() => validateEvidence({...evidence, ...patch}, snapshot(), config)).toThrow(reason as string);
  });
  it.each([1700000160n, 1699999500n])("accepts inclusive skew/age boundary %s", (capturedAt) => {
    const e = {...evidence, capturedAt};
    expect(validateEvidence(e, snapshot({evidenceCommitment: evidenceCommitment(e)}), config)).toBe(evidenceCommitment(e));
  });
});
