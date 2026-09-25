import type { Address, Hex } from "viem";

export type VerifierMode = "LOCAL_DEV" | "PHALA_DSTACK";

export type DemoEvidenceV1 = {
  jobId: bigint;
  scenario: "success" | "tampered";
  robotId: string;
  challenge: string;
  capturedAt: bigint;
  imageHash: Hex;
  checkpoint: string;
  sequence: bigint;
};

export type DemoEvidenceWire = {
  jobId: string;
  scenario: "success" | "tampered";
  robotId: string;
  challenge: string;
  capturedAt: string;
  imageHash: Hex;
  checkpoint: string;
  sequence: string;
};

export type DemoVerdictV1 = {
  jobId: bigint;
  provider: Address;
  evidenceCommitment: Hex;
  outcome: 1;
  issuedAt: bigint;
  validUntil: bigint;
  nonce: Hex;
};

export type DemoVerdictWire = {
  jobId: string;
  provider: Address;
  evidenceCommitment: Hex;
  outcome: 1;
  issuedAt: string;
  validUntil: string;
  nonce: Hex;
};

export type JobSnapshot = {
  id: bigint;
  provider: Address;
  evaluator: Address;
  hook: Address;
  expiredAt: bigint;
  status: number;
  evidenceCommitment: Hex;
  blockTimestamp: bigint;
};
