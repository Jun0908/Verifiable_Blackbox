import "server-only";
import {roverAuthorizationMessage, roverHash, roverOperationRecordHash, roverSkipAuthorizationMessage,
  roverSkipUnavailableReason, type RoverPaymentBundle, type RoverSessionRecord} from "@/lib/rover-session";
import {signatureFor, parseOptions} from "./service";

export async function roverPaymentBundle(record: RoverSessionRecord, now: number): Promise<RoverPaymentBundle> {
  const c = record.context, run = record.run;
  if (record.buttonAuthorization) {
    const approval = record.buttonAuthorization;
    if (approval.policy !== "forward-button-v1" || approval.owner.toLowerCase() !== c.client.toLowerCase()
      || approval.contextHash !== roverHash(c)) throw Error("SESSION_CONTEXT_CHANGED");
    if (!["CAPTURED", "ERROR"].includes(record.phase)) throw Error("RUN_NOT_FINISHED");
    if (!Number.isFinite(approval.pressedAt) || approval.pressedAt! < c.issuedAt || approval.pressedAt! > now + 1
      || approval.pressedAt! >= Number(c.jobExpiresAt)) throw Error("FORWARD_PRESS_REQUIRED");
    if (Number(c.jobExpiresAt) <= now) throw Error("JOB_EXPIRED");
    const video = record.payment?.bundle.video ?? record.analysis ?? {version: 1 as const, source: "job-recording" as const,
      chainId: c.chainId, core: c.core, jobId: c.jobId, sessionId: c.sessionId, recordingSha256: run?.recording.sha256 ?? null,
      policyHash: c.policyHash, judgment: "INCONCLUSIVE" as const, execution: c.options.judgmentMode === "SKIP_VIDEO" ? "SKIPPED" as const : "UNAVAILABLE" as const,
      reason: c.options.judgmentMode === "SKIP_VIDEO" ? "VIDEO_RECOGNITION_SKIPPED" : "ANALYSIS_PENDING",
      executionId: c.sessionId, analyzedAt: new Date(c.issuedAt * 1000).toISOString()};
    return {version: 1, context: c, authorizationSignature: null, buttonAuthorization: approval, skipApproval: null,
      operationRecordHash: roverHash({button: approval, run: run ?? null}), forwardPressed: true,
      videoRecognitionSkipped: c.options.judgmentMode === "SKIP_VIDEO", video};
  }
  await signatureFor(c.client, roverAuthorizationMessage(c), record.authorizationSignature);
  if (c.expiresAt <= now || Number(c.jobExpiresAt) <= now) throw Error("SESSION_EXPIRED");
  parseOptions(c.options);
  if (c.conditionsHash !== roverHash({options: c.options, camera: c.camera, cameraUrl: c.cameraUrl, policyHash: c.policyHash})) throw Error("SESSION_CONTEXT_CHANGED");
  const unavailable = roverSkipUnavailableReason(record);
  if (unavailable) throw Error(unavailable);
  if (!run!.inputs?.some(input => input.action === "press" && input.sessionId === c.sessionId
    && input.receivedAt >= run!.operationStartedAt! && input.receivedAt <= run!.operationEndedAt!)) throw Error("FORWARD_PRESS_REQUIRED");
  let skipped = c.options.judgmentMode === "SKIP_VIDEO";
  const extra = record.skipApproval;
  if (extra?.signature) {
    const a = extra.context;
    const expected = {version: 1, purpose: "SKIP_VIDEO_AFTER_STOP", chainId: c.chainId, core: c.core, jobId: c.jobId,
      sessionId: c.sessionId, client: c.client, provider: c.provider, budget: c.budget,
      sessionContextHash: roverHash(c), operationRecordHash: roverOperationRecordHash(run!), nonce: a.nonce,
      issuedAt: a.issuedAt, expiresAt: Math.min(a.issuedAt + 900, c.expiresAt, Number(c.jobExpiresAt))};
    if (roverHash(a) !== roverHash(expected) || a.issuedAt < c.issuedAt || a.issuedAt > now || a.expiresAt <= now) throw Error("SKIP_APPROVAL_CONTEXT_CHANGED");
    await signatureFor(c.client, roverSkipAuthorizationMessage(a), extra.signature);
    skipped = true;
  }
  const video = record.analysis;
  if (!video || video.version !== 1 || video.source !== "job-recording" || video.jobId !== c.jobId || video.sessionId !== c.sessionId
    || video.chainId !== c.chainId || video.core !== c.core || video.policyHash !== c.policyHash
    || video.recordingSha256 !== (run!.recording.sha256 ?? null)
    || !["MOVING", "STILL", "INCONCLUSIVE"].includes(video.judgment)) throw Error("ANALYSIS_CONTEXT_MISMATCH");
  if (!skipped) {
    if (video.judgment !== "MOVING" || video.execution !== "ANALYZED") throw Error("VIDEO_MOVEMENT_REQUIRED");
    if (!run!.recording.sha256 || !run!.recording.frames.length) throw Error("RECORDING_UNAVAILABLE");
    const analyzedAt = Date.parse(video.analyzedAt) / 1000;
    if (!Number.isFinite(analyzedAt) || analyzedAt < c.issuedAt || analyzedAt > now + 30 || analyzedAt >= c.expiresAt) throw Error("ANALYSIS_EXPIRED_OR_INVALID");
  }
  return {version: 1, context: c, authorizationSignature: record.authorizationSignature!,
    skipApproval: extra?.signature ? extra : null, operationRecordHash: roverOperationRecordHash(run!),
    forwardPressed: true, videoRecognitionSkipped: skipped, video};
}
