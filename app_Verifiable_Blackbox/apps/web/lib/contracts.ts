import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

export const JOB_BUDGET = 100_000_000n;
export const EXPECTED_IMAGE_HASH =
  "0x000000000000000000000000000000000000000000000000000000000000cafe" as Hex;

export type DemoDeployment = {
  chainId: number;
  rpcUrl: string;
  explorerUrl?: string;
  mockUsdc: Address;
  erc8183: Address;
  evidenceHook: Address;
  evaluator: Address;
  provider: Address;
  relayer: Address;
  mockTeeSigner: Address;
};

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
  scenario: DemoEvidenceV1["scenario"];
  robotId: string;
  challenge: string;
  capturedAt: string | number;
  imageHash: Hex;
  checkpoint: string;
  sequence: string | number;
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

export type DemoVerifierInfo = {
  mode: "MOCK_TEE" | "LOCAL_DEV" | "PHALA_DSTACK";
  attested: boolean;
  simulated: boolean;
  signerAddress: Address;
  attestationPath: string | null;
};

export type DemoVerifyResponse = {
  ok: true;
  verdict: DemoVerdictWire;
  signature: Hex;
  verifier: DemoVerifierInfo;
};

export type DemoVerifierConfig = {
  mode: "MOCK_TEE" | "PHALA";
  attestationAvailable: boolean;
};

export type DemoStatus = {
  jobId: string;
  status: number;
  clientBalance: string;
  escrowBalance: string;
  providerBalance: string;
  evidenceCommitment: Hex;
  receiptId: Hex;
};

export const jobStatusNames = [
  "Open",
  "Funded",
  "Submitted",
  "Completed",
  "Rejected",
  "Expired",
] as const;

export function expectedChallenge(jobId: bigint, scenario: DemoEvidenceV1["scenario"]) {
  return `challenge-${scenario}-${jobId}`;
}

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EVIDENCE_KEYS = new Set([
  "jobId",
  "scenario",
  "robotId",
  "challenge",
  "capturedAt",
  "imageHash",
  "checkpoint",
  "sequence",
]);

function parseDecimal(value: unknown, label: string): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer or decimal string`);
    }
    return BigInt(value);
  }
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be a non-negative safe integer or decimal string`);
  }
  return BigInt(value);
}

function parseBoundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string up to ${maxLength} characters`);
  }
  return value;
}

export function parseDemoEvidence(input: unknown): DemoEvidenceV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("evidence must be an object");
  }
  const candidate = input as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== EVIDENCE_KEYS.size
    || Object.keys(candidate).some((key) => !EVIDENCE_KEYS.has(key))
  ) {
    throw new Error("evidence has missing or unsupported fields");
  }

  const jobId = parseDecimal(candidate.jobId, "evidence.jobId");
  const capturedAt = parseDecimal(candidate.capturedAt, "evidence.capturedAt");
  const sequence = parseDecimal(candidate.sequence, "evidence.sequence");
  if (jobId === 0n || jobId > UINT256_MAX) throw new Error("evidence.jobId is out of range");
  if (capturedAt > UINT64_MAX) throw new Error("evidence.capturedAt is out of range");
  if (sequence > UINT256_MAX) throw new Error("evidence.sequence is out of range");
  if (candidate.scenario !== "success" && candidate.scenario !== "tampered") {
    throw new Error("evidence.scenario must be success or tampered");
  }
  if (typeof candidate.imageHash !== "string" || !BYTES32_PATTERN.test(candidate.imageHash)) {
    throw new Error("evidence.imageHash must be a 32-byte hex value");
  }

  return {
    jobId,
    scenario: candidate.scenario,
    robotId: parseBoundedString(candidate.robotId, "evidence.robotId", 128),
    challenge: parseBoundedString(candidate.challenge, "evidence.challenge", 256),
    capturedAt,
    imageHash: candidate.imageHash.toLowerCase() as Hex,
    checkpoint: parseBoundedString(candidate.checkpoint, "evidence.checkpoint", 128),
    sequence,
  };
}

export function demoEvidenceToWire(evidence: DemoEvidenceV1): DemoEvidenceWire {
  return {
    ...evidence,
    jobId: evidence.jobId.toString(),
    capturedAt: evidence.capturedAt.toString(),
    sequence: evidence.sequence.toString(),
  };
}

export function evidenceCommitment(evidence: DemoEvidenceV1): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string schema,uint256 jobId,string robotId,string challenge,uint64 capturedAt,bytes32 imageHash,string checkpoint,uint256 sequence",
      ),
      [
        "DEMO_EVIDENCE_V1",
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

export const mockUsdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "", type: "uint256"}],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {name: "spender", type: "address"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [{name: "", type: "bool"}],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      {name: "to", type: "address"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [],
  },
] as const;

export const erc8183Abi = [
  {
    type: "event", name: "JobCreated",
    inputs: [
      {name:"jobId", type:"uint256", indexed:true},
      {name:"client", type:"address", indexed:true},
      {name:"provider", type:"address", indexed:true},
      {name:"evaluator", type:"address", indexed:false},
      {name:"expiredAt", type:"uint256", indexed:false},
      {name:"hook", type:"address", indexed:false},
    ],
  },
  {
    type: "function",
    name: "jobCounter",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "uint256"}],
  },
  {
    type: "function",
    name: "createAndFundDemo",
    stateMutability: "nonpayable",
    inputs: [
      {name: "provider", type: "address"},
      {name: "evaluator", type: "address"},
      {name: "expiredAt", type: "uint256"},
      {name: "description", type: "string"},
      {name: "hook", type: "address"},
    ],
    outputs: [{name: "jobId", type: "uint256"}],
  },
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      {name: "provider", type: "address"},
      {name: "evaluator", type: "address"},
      {name: "expiredAt", type: "uint256"},
      {name: "description", type: "string"},
      {name: "hook", type: "address"},
    ],
    outputs: [{name: "jobId", type: "uint256"}],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      {name: "jobId", type: "uint256"},
      {name: "amount", type: "uint256"},
      {name: "optParams", type: "bytes"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      {name: "jobId", type: "uint256"},
      {name: "optParams", type: "bytes"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      {name: "jobId", type: "uint256"},
      {name: "deliverable", type: "bytes32"},
      {name: "optParams", type: "bytes"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{name: "jobId", type: "uint256"}],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {name: "id", type: "uint256"},
          {name: "client", type: "address"},
          {name: "provider", type: "address"},
          {name: "evaluator", type: "address"},
          {name: "description", type: "string"},
          {name: "budget", type: "uint256"},
          {name: "expiredAt", type: "uint256"},
          {name: "status", type: "uint8"},
          {name: "hook", type: "address"},
        ],
      },
    ],
  },
] as const;

export const evidenceHookAbi = [
  {
    type: "function",
    name: "evidenceCommitments",
    stateMutability: "view",
    inputs: [{name: "jobId", type: "uint256"}],
    outputs: [{name: "", type: "bytes32"}],
  },
] as const;

export const evaluatorAbi = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "verdict",
        type: "tuple",
        components: [
          {name: "jobId", type: "uint256"},
          {name: "provider", type: "address"},
          {name: "evidenceCommitment", type: "bytes32"},
          {name: "outcome", type: "uint8"},
          {name: "issuedAt", type: "uint64"},
          {name: "validUntil", type: "uint64"},
          {name: "nonce", type: "bytes32"},
        ],
      },
      {name: "signature", type: "bytes"},
    ],
    outputs: [{name: "receiptId", type: "bytes32"}],
  },
  {
    type: "function",
    name: "receiptIdByJob",
    stateMutability: "view",
    inputs: [{name: "jobId", type: "uint256"}],
    outputs: [{name: "", type: "bytes32"}],
  },
] as const;

export const verdictTypes = {
  DemoVerdictV1: [
    {name: "jobId", type: "uint256"},
    {name: "provider", type: "address"},
    {name: "evidenceCommitment", type: "bytes32"},
    {name: "outcome", type: "uint8"},
    {name: "issuedAt", type: "uint64"},
    {name: "validUntil", type: "uint64"},
    {name: "nonce", type: "bytes32"},
  ],
} as const;
