import {keccak256, toBytes, type Address, type Hex} from "viem";
import type {DemoEvidenceWire, DemoVerifyResponse} from "./contracts";

export const ROVER_JOB_DESCRIPTION = "vbb://rover/session-v1";
export const ROVER_BUTTON_JOB_DESCRIPTION = "vbb://rover/forward-button-v1";
export type JudgmentMode = "VIDEO" | "SKIP_VIDEO";
export type RoverOptions = {judgmentMode: JudgmentMode; operation: "FORWARD" | "STILL"; durationMs: number; speed: number};
export type RoverAccess = {
  action: "prepare" | "status"; chainId: number; core: Address; jobId: string;
  requestId: string; issuedAt: number; options?: RoverOptions;
};
export type RoverSessionContext = {
  controlMode?: "manual";
  paymentPolicy?: "forward-button-v1";
  version: 1; chainId: number; core: Address; evaluator: Address; token: Address;
  jobId: string; client: Address; provider: Address; budget: string; jobExpiresAt: string;
  sessionId: string; nonce: Hex; issuedAt: number; expiresAt: number;
  options: RoverOptions; camera: "external-fixed" | null; cameraUrl: string | null; policyHash: Hex; conditionsHash: Hex;
};
export type RoverSessionRecord = {
  context: RoverSessionContext; phase: "PREPARED" | "AUTHORIZED" | "SUPERSEDED" | "EXPIRED" | "STARTING" | "RECORDING" | "OPERATING" | "STOPPING" | "CAPTURED" | "ERROR";
  authorizationSignature?: Hex; authorizedAt?: string;
  controlToken?: Hex;
  buttonAuthorization?: {policy: "forward-button-v1"; contextHash: Hex; owner: Address; authenticatedAt: string; pressedAt?: number};
  run?: RoverRun; error?: string;
  skipApproval?: {context: RoverSkipContext; signature?: Hex; authorizedAt?: string};
  analysis?: RoverVideoResult;
  payment?: {
    phase: "ELIGIBLE" | "SUBMITTING" | "SUBMITTED" | "VERIFYING" | "PAYING" | "PAID";
    bundle: RoverPaymentBundle; evidence: DemoEvidenceWire;
    submitTransactionHash?: Hex; completeTransactionHash?: Hex; verification?: DemoVerifyResponse;
    receiptId?: Hex; error?: string;
  };
};
export type RoverPaymentBundle = {
  version: 1; context: RoverSessionContext; authorizationSignature: Hex | null;
  buttonAuthorization?: RoverSessionRecord["buttonAuthorization"];
  skipApproval: RoverSessionRecord["skipApproval"] | null; operationRecordHash: Hex;
  forwardPressed: true; videoRecognitionSkipped: boolean; video: RoverVideoResult;
};
export type RoverVideoResult = {
  version: 1; source: "job-recording"; chainId: number; core: Address; jobId: string; sessionId: string;
  recordingSha256: string | null; policyHash: Hex; judgment: "MOVING" | "STILL" | "INCONCLUSIVE";
  execution: "ANALYZED" | "UNAVAILABLE" | "SKIPPED"; reason: string | null;
  executionId: string; analyzedAt: string; frameCount?: number;
};
export type RoverSkipContext = {
  version: 1; purpose: "SKIP_VIDEO_AFTER_STOP"; chainId: number; core: Address;
  jobId: string; sessionId: string; client: Address; provider: Address; budget: string;
  sessionContextHash: Hex; operationRecordHash: Hex; nonce: Hex; issuedAt: number; expiresAt: number;
};
export type RoverRunRequest = {
  recordOnly?: true;
  buttonControl?: true;
  sessionId: string; jobId: string; chainId: number; core: Address; judgmentMode: JudgmentMode;
  operation: RoverOptions["operation"]; durationMs: number; speed: number; cameraUrl: string | null; conditionsHash: Hex; policyHash: Hex; expiresAt: number;
};
export type RoverRun = {
  version: 1; request: RoverRunRequest; phase: "STARTING" | "RECORDING" | "OPERATING" | "STOPPING" | "CAPTURED" | "ERROR";
  commands: Array<{sessionId: string; sequence: number; sentAt: number; x: number; y: number; z: number; speed: number; deadman: boolean; result: "SENT" | "FAILED"; deviceSequence?: number}>;
  stop: null | {requestedAt: number; confirmed: boolean; confirmedAt?: number; response?: {armed: boolean; motors: boolean; i2c: boolean}};
  recording: {state: string; frames: Array<{index: number; sha256: string; capturedAt: number; phase: string}>; sha256?: string | null; framesHash?: string; bytes?: number; error?: string};
  operationHash?: string; operationStartedAt?: number; operationEndedAt?: number; error?: string;
  forwardPressed?: boolean | null;
  inputs?: Array<{sessionId: string; sequence: number; action: "press" | "release" | "finish"; receivedAt: number}>;
  observationEndsAt?: number;
};
export function roverRunRequest(context: RoverSessionContext): RoverRunRequest {
  return {sessionId: context.sessionId, jobId: context.jobId, chainId: context.chainId, core: context.core,
    ...(context.controlMode === "manual" ? {recordOnly: true as const} : {}),
    ...(context.paymentPolicy === "forward-button-v1" ? {buttonControl: true as const} : {}),
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

export function roverSkipUnavailableReason(record: RoverSessionRecord): string | null {
  const run = record.run;
  if (!run || !["CAPTURED", "ERROR"].includes(record.phase) || run.phase !== record.phase) return "RUN_NOT_FINISHED";
  if (run.forwardPressed !== true) return "FORWARD_PRESS_REQUIRED";
  if (record.context.options.operation !== "FORWARD" || roverHash(run.request) !== roverHash(roverRunRequest(record.context))) return "RUN_CONTEXT_MISMATCH";
  if (run.phase === "ERROR" && !["RECORDING_INCOMPLETE", "RECORDING_SHUTDOWN_FAILED"].includes(run.error ?? "")) return "RUN_NOT_COMPLETED";
  if (!Number.isFinite(run.operationStartedAt) || !Number.isFinite(run.operationEndedAt)
    || run.operationStartedAt! < record.context.issuedAt || run.operationEndedAt! > record.context.expiresAt
    || run.operationEndedAt! < run.operationStartedAt!) return "RUN_NOT_COMPLETED";
  const sent = run.commands.filter(event => event.sessionId === record.context.sessionId && event.result === "SENT"
    && event.deadman && event.y > 0 && event.speed > 0 && Number.isFinite(event.sentAt)
    && event.sentAt >= run.operationStartedAt! && event.sentAt <= run.operationEndedAt!);
  if (!sent.length) return "DRIVE_NOT_SENT";
  if (!run.stop?.confirmed || !Number.isFinite(run.stop.confirmedAt)
    || run.stop.confirmedAt! < Math.max(run.operationEndedAt!, ...sent.map(event => event.sentAt))) return "STOP_UNCONFIRMED";
  return null;
}

export function roverOperationRecordHash(run: RoverRun): Hex {
  return roverHash({request: run.request, forwardPressed: run.forwardPressed ?? null,
    inputs: run.inputs ?? [],
    commands: run.commands, stop: run.stop, operationStartedAt: run.operationStartedAt ?? null,
    operationEndedAt: run.operationEndedAt ?? null, bridgeOperationHash: run.operationHash ?? null});
}

export function roverSkipAuthorizationMessage(context: RoverSkipContext): string {
  return ["Verifiable Blackbox — Rover video skip approval v1",
    "VIDEO RECOGNITION IS SKIPPED. I authorize payment for this recorded run even when its video result is INCONCLUSIVE or STILL.",
    "Payment requires a recorded forward button press, successful forward commands, and confirmed stop. This approval does not start another run or change the video result.",
    `Amount (base units): ${context.budget}`, `Provider: ${context.provider}`,
    `Expires at (Unix): ${context.expiresAt}`, canonicalJson(context)].join("\n");
}

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
    "Start recording, then hold Forward to drive. Releasing the button stops the run. An observation with no press does not authorize payment.",
    "A stationary demo does not authorize payment. Phala checks Evidence and Job integrity.",
    `Amount (base units): ${context.budget}`, `Provider: ${context.provider}`,
    `Expires at (Unix): ${context.expiresAt}`, canonicalJson(context)].join("\n");
}
