import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import { z } from "zod";
import { EVIDENCE_SCHEMA } from "./contracts.js";
import { invalidRequest } from "./errors.js";
import type { DemoEvidenceV1, DemoEvidenceWire } from "./types.js";

const decimalSchema = z.union([
  z.string().max(78).regex(/^(0|[1-9][0-9]*)$/),
  z.number().int().nonnegative().safe(),
]);

const evidenceSchema = z
  .object({
    jobId: decimalSchema,
    scenario: z.enum(["success", "tampered"]),
    robotId: z.string().min(1).max(128),
    challenge: z.string().min(1).max(256),
    capturedAt: decimalSchema,
    imageHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    checkpoint: z.string().min(1).max(128),
    sequence: decimalSchema,
  })
  .strict();

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export function parseEvidence(input: unknown): DemoEvidenceV1 {
  const result = evidenceSchema.safeParse(input);
  if (!result.success) throw invalidRequest("EVIDENCE_SCHEMA_INVALID");

  const evidence: DemoEvidenceV1 = {
    ...result.data,
    jobId: BigInt(result.data.jobId),
    capturedAt: BigInt(result.data.capturedAt),
    imageHash: result.data.imageHash.toLowerCase() as Hex,
    sequence: BigInt(result.data.sequence),
  };

  if (evidence.jobId === 0n || evidence.jobId > UINT256_MAX) {
    throw invalidRequest("JOB_ID_OUT_OF_RANGE");
  }
  if (evidence.sequence > UINT256_MAX) throw invalidRequest("SEQUENCE_OUT_OF_RANGE");
  if (evidence.capturedAt > UINT64_MAX) throw invalidRequest("CAPTURED_AT_OUT_OF_RANGE");
  return evidence;
}

export function evidenceCommitment(evidence: DemoEvidenceV1): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string schema,uint256 jobId,string robotId,string challenge,uint64 capturedAt,bytes32 imageHash,string checkpoint,uint256 sequence",
      ),
      [
        EVIDENCE_SCHEMA,
        evidence.jobId,
        evidence.robotId,
        evidence.challenge,
        evidence.capturedAt,
        evidence.imageHash,
        evidence.checkpoint,
        evidence.sequence,
      ],
    ),
  );
}

export function expectedChallenge(jobId: bigint, scenario: DemoEvidenceV1["scenario"]): string {
  return `challenge-${scenario}-${jobId}`;
}

export function evidenceToWire(evidence: DemoEvidenceV1): DemoEvidenceWire {
  return { ...evidence, jobId: evidence.jobId.toString(), capturedAt: evidence.capturedAt.toString(), sequence: evidence.sequence.toString() };
}
