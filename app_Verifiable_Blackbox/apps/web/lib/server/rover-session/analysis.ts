import "server-only";
import {createHash, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {roverHash, type RoverSessionRecord, type RoverVideoResult} from "@/lib/rover-session";
import {bridgeUrl} from "../bridge-config";
import {config} from "../stegavar";
import {ownedSession} from "./run";
import {sessionStore} from "./guard";

export async function recordedBytes(record: RoverSessionRecord, index?: number): Promise<Buffer> {
  const recording = record.run?.recording;
  const expected = index === undefined ? recording?.sha256 : recording?.frames[index]?.sha256;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw Error("RECORDING_UNAVAILABLE");
  const path = index === undefined ? "recording" : "frame";
  const response = await fetch(bridgeUrl(`jobs/${path}?sessionId=${record.context.sessionId}${index === undefined ? "" : `&index=${index}`}`),
    {headers: {Authorization: `Bearer ${process.env.VBB_BRIDGE_TOKEN}`}, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000)});
  if (!response.ok || !response.body) throw Error("RECORDING_UNAVAILABLE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > (index === undefined ? 64 * 1024 * 1024 : 2_000_000)) throw Error("RECORDING_TOO_LARGE");
      chunks.push(value);
    }
  } finally {await reader.cancel();}
  const buffer = Buffer.concat(chunks);
  if (createHash("sha256").update(buffer).digest("hex") !== expected) throw Error("RECORDING_HASH_MISMATCH");
  return buffer;
}

export async function analyzeRecordedSession(record: RoverSessionRecord): Promise<RoverVideoResult> {
  const context = record.context;
  const base: RoverVideoResult = {version: 1, source: "job-recording", chainId: context.chainId, core: context.core,
    jobId: context.jobId, sessionId: context.sessionId, recordingSha256: record.run?.recording.sha256 ?? null,
    policyHash: context.policyHash, judgment: "INCONCLUSIVE", execution: "UNAVAILABLE", reason: null,
    executionId: randomUUID(), analyzedAt: new Date().toISOString()};
  if (context.options.judgmentMode === "SKIP_VIDEO" || record.skipApproval?.signature) {
    return record.analysis ?? {...base, execution: "SKIPPED", reason: "VIDEO_RECOGNITION_SKIPPED"};
  }
  try {
    const policy = JSON.parse(await readFile(resolve(process.cwd(), "../../services/stegavar/config/rover_motion.json"), "utf8"));
    if (roverHash({cameraUrl: context.cameraUrl, motion: policy}) !== context.policyHash) throw Error("POLICY_CHANGED");
    const raw = await recordedBytes(record);
    const settings = config();
    const response = await fetch(`${settings.base}/analyze-recording`, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({version: 1, source: base.source, chainId: base.chainId, core: base.core, jobId: base.jobId, sessionId: base.sessionId,
        recordingSha256: base.recordingSha256, policyHash: base.policyHash, policy, rawBase64: raw.toString("base64")}),
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(settings.timeout)});
    if (!response.ok) throw Error(response.status === 409 ? "ANALYSIS_BUSY" : "ANALYSIS_UNAVAILABLE");
    const result = await response.json() as RoverVideoResult;
    for (const key of ["version", "source", "chainId", "core", "jobId", "sessionId", "recordingSha256", "policyHash"] as const) {
      if (result[key] !== base[key]) throw Error("ANALYSIS_CONTEXT_MISMATCH");
    }
    if (!["MOVING", "STILL", "INCONCLUSIVE"].includes(result.judgment) || result.execution !== "ANALYZED"
      || typeof result.executionId !== "string" || !/^[0-9a-f-]{36}$/.test(result.executionId)
      || !Number.isFinite(Date.parse(result.analyzedAt)) || !(result.reason === null || typeof result.reason === "string")) throw Error("ANALYSIS_CONTEXT_MISMATCH");
    return {...base, judgment: result.judgment, execution: "ANALYZED", reason: result.reason,
      executionId: result.executionId, analyzedAt: result.analyzedAt, ...(Number.isSafeInteger(result.frameCount) ? {frameCount: result.frameCount} : {})};
  } catch (error) {
    return {...base, reason: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "ANALYSIS_CONNECTION_FAILED"};
  }
}

export async function analyzeRoverSession(jobId: unknown, sessionId: unknown, signature: unknown) {
  const owner = await ownedSession(jobId, sessionId, signature);
  return sessionStore().update(owner.context.jobId, async job => {
    const record = job.sessions.find(s => s.context.sessionId === owner.context.sessionId);
    if (!record?.run || !["CAPTURED", "ERROR"].includes(record.phase)) throw Error("RUN_NOT_FINISHED");
    if (!record.analysis) record.analysis = await analyzeRecordedSession(record);
    return record;
  });
}
