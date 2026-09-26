import {keccak256, toBytes, type Address, type Hex} from "viem";

export const ROVER_JOB_DESCRIPTION = "vbb://rover/session-v1";
export type JudgmentMode = "VIDEO" | "SKIP_VIDEO";
export type RoverOptions = {judgmentMode: JudgmentMode; operation: "FORWARD" | "STILL"; durationMs: number; speed: number};
export type RoverAccess = {
  action: "prepare" | "status"; chainId: number; core: Address; jobId: string;
  requestId: string; issuedAt: number; options?: RoverOptions;
};
export type RoverSessionContext = {
  version: 1; chainId: number; core: Address; evaluator: Address; token: Address;
  jobId: string; client: Address; provider: Address; budget: string; jobExpiresAt: string;
  sessionId: string; nonce: Hex; issuedAt: number; expiresAt: number;
  options: RoverOptions; camera: "external-fixed" | null; cameraUrl: string | null; policyHash: Hex; conditionsHash: Hex;
};
export type RoverSessionRecord = {
  context: RoverSessionContext; phase: "PREPARED" | "AUTHORIZED" | "SUPERSEDED" | "EXPIRED" | "STARTING" | "RECORDING" | "OPERATING" | "STOPPING" | "CAPTURED" | "ERROR";
  authorizationSignature?: Hex; authorizedAt?: string;
  run?: RoverRun; error?: string;
};
export type RoverRunRequest = {
  sessionId: string; jobId: string; chainId: number; core: Address; judgmentMode: JudgmentMode;
  operation: RoverOptions["operation"]; durationMs: number; speed: number; cameraUrl: string | null; conditionsHash: Hex; policyHash: Hex; expiresAt: number;
};
export type RoverRun = {
  version: 1; request: RoverRunRequest; phase: "STARTING" | "RECORDING" | "OPERATING" | "STOPPING" | "CAPTURED" | "ERROR";
  commands: Array<{sessionId: string; sequence: number; sentAt: number; x: number; y: number; z: number; speed: number; deadman: boolean; result: "SENT" | "FAILED"; deviceSequence?: number}>;
  stop: null | {requestedAt: number; confirmed: boolean; confirmedAt?: number; response?: {armed: boolean; motors: boolean; i2c: boolean}};
  recording: {state: string; frames: Array<{index: number; sha256: string; capturedAt: number; phase: string}>; sha256?: string | null; framesHash?: string; bytes?: number; error?: string};
  operationHash?: string; operationStartedAt?: number; operationEndedAt?: number; error?: string;
};
export function roverRunRequest(context: RoverSessionContext): RoverRunRequest {
  return {sessionId: context.sessionId, jobId: context.jobId, chainId: context.chainId, core: context.core,
    ...context.options, cameraUrl: context.cameraUrl, conditionsHash: context.conditionsHash, policyHash: context.policyHash, expiresAt: context.expiresAt};
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw Error("INVALID_CANONICAL_VALUE");
}
export const roverHash = (value: unknown) => keccak256(toBytes(canonicalJson(value)));

export function roverAccessMessage(access: RoverAccess) {
  return ["Verifiable Blackbox — Rover session access v1",
    "I request access to this Job's Rover session. This signature does not authorize payment.",
    canonicalJson(access)].join("\n");
}

export function roverAuthorizationMessage(context: RoverSessionContext) {
  const condition = context.options.judgmentMode === "VIDEO"
    ? "Payment requires successful drive commands, confirmed stop, and MOVING from this session's video."
    : "VIDEO RECOGNITION IS SKIPPED. I authorize payment based on successful drive commands and confirmed stop; recording and video analysis are not required.";
  return ["Verifiable Blackbox — Rover conditional payment v1", condition,
    "A stationary demo does not authorize payment. Phala checks Evidence and Job integrity.",
    `Amount (base units): ${context.budget}`, `Provider: ${context.provider}`,
    `Expires at (Unix): ${context.expiresAt}`, canonicalJson(context)].join("\n");
}
