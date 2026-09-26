import "server-only";
import {roverAuthorizationMessage, roverHash, roverRunRequest, type RoverRun, type RoverSessionRecord} from "@/lib/rover-session";
import {bridgeUrl} from "../bridge-config";
import {getFundedDemoJob} from "../provider";
import {signatureFor} from "./service";
import {sessionStore} from "./guard";
import {assertJobId} from "./store";
import {videoPolicy} from "./index";

async function bridge(path: string, body?: unknown): Promise<RoverRun> {
  const token = process.env.VBB_BRIDGE_TOKEN;
  if (!token) throw Error("BRIDGE_UNAVAILABLE");
  let response: Response;
  try {
    response = await fetch(bridgeUrl(path), {method: body ? "POST" : "GET", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000), cache: "no-store"});
  } catch {throw Error("BRIDGE_UNAVAILABLE");}
  if (!response.ok) throw Error("BRIDGE_REQUEST_REJECTED");
  return response.json();
}

export async function ownedSession(jobId: unknown, sessionId: unknown, signature: unknown): Promise<RoverSessionRecord> {
  assertJobId(jobId);
  if (typeof sessionId !== "string") throw Error("INVALID_SESSION_ID");
  const record = (await sessionStore().read(jobId))?.sessions.find(s => s.context.sessionId === sessionId);
  if (!record?.authorizationSignature) throw Error("AUTHORIZATION_REQUIRED");
  await signatureFor(record.context.client, roverAuthorizationMessage(record.context), signature);
  await signatureFor(record.context.client, roverAuthorizationMessage(record.context), record.authorizationSignature);
  return record;
}

export async function inputRoverSession(jobId: unknown, sessionId: unknown, signature: unknown, action: unknown, sequence: unknown) {
  if (!["press", "hold", "release", "finish"].includes(String(action)) || !Number.isSafeInteger(sequence) || Number(sequence) < 0) throw Error("INVALID_INPUT");
  const record = await ownedSession(jobId, sessionId, signature);
  if (record.context.expiresAt <= Math.floor(Date.now() / 1000)) throw Error("SESSION_EXPIRED");
  if (!["STARTING", "RECORDING", "OPERATING"].includes(record.phase)) throw Error("INPUT_WINDOW_CLOSED");
  await bridge("jobs/input", {sessionId, action, sequence});
  return {accepted: true};
}

async function saveRun(session: RoverSessionRecord, run: RoverRun) {
  if (!run || run.version !== 1 || roverHash(run.request) !== roverHash(roverRunRequest(session.context))
    || !["STARTING", "RECORDING", "OPERATING", "STOPPING", "CAPTURED", "ERROR"].includes(run.phase)
    || !Array.isArray(run.commands) || !run.recording || !Array.isArray(run.recording.frames)) throw Error("RUN_CONTEXT_MISMATCH");
  return sessionStore().update(session.context.jobId, async job => {
    const record = job.sessions.find(s => s.context.sessionId === session.context.sessionId);
    if (!record || !["STARTING", "RECORDING", "OPERATING", "STOPPING", "CAPTURED", "ERROR"].includes(record.phase)) throw Error("SESSION_STATE_CHANGED");
    // A delayed HTTP response cannot undo a final run record.
    if (["CAPTURED", "ERROR"].includes(record.phase)) return record;
    record.run = run;
    record.phase = run.phase;
    if (run.error) record.error = run.error;
    return record;
  });
}

export async function startRoverSession(jobId: unknown, sessionId: unknown, signature: unknown) {
  const session = await ownedSession(jobId, sessionId, signature);
  const context = session.context;
  if (context.expiresAt <= Math.floor(Date.now() / 1000)) throw Error("SESSION_EXPIRED");
  if (context.options.judgmentMode === "VIDEO" && context.policyHash !== roverHash(await videoPolicy())) throw Error("CAMERA_OR_POLICY_CHANGED");
  const job = await getFundedDemoJob(BigInt(context.jobId));
  if (job.client.toLowerCase() !== context.client.toLowerCase() || job.provider.toLowerCase() !== context.provider.toLowerCase()
    || job.budget.toString() !== context.budget || job.expiredAt.toString() !== context.jobExpiresAt) throw Error("SESSION_CONTEXT_CHANGED");
  await sessionStore().update(context.jobId, async jobRecord => {
    const record = jobRecord.sessions.find(s => s.context.sessionId === context.sessionId);
    if (!record || !["AUTHORIZED", "STARTING"].includes(record.phase)) throw Error("SESSION_ALREADY_STARTED");
    record.phase = "STARTING";
  });
  // Retrying STARTING asks the Bridge for the same persistent run; it never creates another run.
  return saveRun(session, await bridge("jobs/start", roverRunRequest(context)));
}

export async function roverRunStatus(jobId: unknown, sessionId: unknown, signature: unknown) {
  const record = await ownedSession(jobId, sessionId, signature);
  if (!["STARTING", "RECORDING", "OPERATING", "STOPPING"].includes(record.phase)) return record;
  return saveRun(record, await bridge(`jobs/status?sessionId=${record.context.sessionId}`));
}

export async function stopRoverSession(jobId: unknown, sessionId: unknown, signature: unknown) {
  const record = await ownedSession(jobId, sessionId, signature);
  await bridge("jobs/stop", {sessionId: record.context.sessionId});
  return roverRunStatus(jobId, sessionId, signature);
}
