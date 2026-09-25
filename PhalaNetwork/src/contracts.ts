export const PASS_OUTCOME = 1 as const;
export const SUBMITTED_JOB_STATUS = 2;
export const MAX_EVALUATOR_VERDICT_TTL_SECONDS = 15 * 60;
export const EVIDENCE_SCHEMA = "DEMO_EVIDENCE_V1";

export const erc8183Abi = [
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
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
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

export const verdictTypes = {
  DemoVerdictV1: [
    { name: "jobId", type: "uint256" },
    { name: "provider", type: "address" },
    { name: "evidenceCommitment", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
