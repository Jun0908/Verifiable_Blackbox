import "server-only";
import {randomBytes, randomUUID} from "node:crypto";
import {verifyMessage, type Address, type Hex} from "viem";
import {roverAccessMessage, roverAuthorizationMessage, roverHash, roverOperationRecordHash,
  roverSkipAuthorizationMessage, roverSkipUnavailableReason, type RoverAccess, type RoverOptions,
  type RoverSessionContext, type RoverSessionRecord, type RoverSkipContext} from "@/lib/rover-session";
import {assertJobId, RoverSessionStore} from "./store";

type SessionJob = {id: bigint; client: Address; provider: Address; budget: bigint; expiredAt: bigint; evaluator: Address; hook: Address};
export type SessionDependencies = {
  store: RoverSessionStore; evaluator: Address; token: Address;
  fundedJob(jobId: string): Promise<SessionJob>; now(): number;
  readJob?(jobId: string): Promise<SessionJob>;
  videoPolicy(): Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("INVALID_SESSION_REQUEST");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw Error("INVALID_SESSION_REQUEST");
}
export function parseOptions(value: unknown): RoverOptions {
  const data = object(value);
  keys(data, ["judgmentMode", "operation", "durationMs", "speed"]);
  if (!["VIDEO", "SKIP_VIDEO"].includes(String(data.judgmentMode)) || !["FORWARD", "STILL"].includes(String(data.operation))
    || !Number.isInteger(data.durationMs) || Number(data.durationMs) < 500 || Number(data.durationMs) > 3000
    || !Number.isInteger(data.speed) || Number(data.speed) < 1 || Number(data.speed) > 50) throw Error("INVALID_SESSION_OPTIONS");
  return data as RoverOptions;
}
export async function signatureFor(address: Address, message: string, signature: unknown) {
  if (typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature)
    || !await verifyMessage({address, message, signature: signature as Hex}).catch(() => false)) throw Error("OWNER_SIGNATURE_REQUIRED");
}

export class RoverSessions {
  constructor(readonly deps: SessionDependencies) {}
  private async validateStoppedSession(session: RoverSessionRecord) {
    const context = session.context;
    await signatureFor(context.client, roverAuthorizationMessage(context), session.authorizationSignature);
    if (context.options.judgmentMode !== "VIDEO") throw Error("VIDEO_SKIP_ALREADY_SELECTED");
    if (context.expiresAt <= this.deps.now()) throw Error("SESSION_EXPIRED");
    const job = await this.deps.fundedJob(context.jobId);
    if (job.expiredAt <= BigInt(this.deps.now())) throw Error("JOB_EXPIRED");
    if (job.id.toString() !== context.jobId || context.chainId !== this.deps.store.scope.chainId
      || context.core.toLowerCase() !== this.deps.store.scope.core.toLowerCase()
      || context.client.toLowerCase() !== job.client.toLowerCase() || context.provider.toLowerCase() !== job.provider.toLowerCase()
      || context.evaluator.toLowerCase() !== this.deps.evaluator.toLowerCase()
      || context.evaluator.toLowerCase() !== job.evaluator.toLowerCase() || context.token.toLowerCase() !== this.deps.token.toLowerCase()
      || context.budget !== job.budget.toString() || context.jobExpiresAt !== job.expiredAt.toString()) throw Error("SESSION_CONTEXT_CHANGED");
    parseOptions(context.options);
    if (context.conditionsHash !== roverHash({options: context.options, camera: context.camera, cameraUrl: context.cameraUrl, policyHash: context.policyHash})) throw Error("SESSION_CONTEXT_CHANGED");
    const reason = roverSkipUnavailableReason(session);
    if (reason) throw Error(reason);
  }
  private skipContext(session: RoverSessionRecord, nonce: Hex, issuedAt: number): RoverSkipContext {
    const context = session.context;
    return {version: 1, purpose: "SKIP_VIDEO_AFTER_STOP", chainId: context.chainId, core: context.core,
      jobId: context.jobId, sessionId: context.sessionId, client: context.client, provider: context.provider,
      budget: context.budget, sessionContextHash: roverHash(context), operationRecordHash: roverOperationRecordHash(session.run!),
      nonce, issuedAt, expiresAt: Math.min(issuedAt + 900, context.expiresAt, Number(context.jobExpiresAt))};
  }
  private stoppedRecord(sessions: RoverSessionRecord[], jobId: string, sessionId: unknown) {
    if (typeof sessionId !== "string" || !uuid.test(sessionId)) throw Error("INVALID_SESSION_ID");
    const record = sessions.find(s => s.context.sessionId === sessionId);
    if (!record || record.context.jobId !== jobId) throw Error("SESSION_NOT_FOUND");
    if (record !== sessions.at(-1)) throw Error("SESSION_SUPERSEDED");
    return record;
  }
  async prepareSkip(jobId: unknown, sessionId: unknown, signature: unknown) {
    assertJobId(jobId);
    return this.deps.store.update(jobId, async job => {
      const record = this.stoppedRecord(job.sessions, jobId, sessionId);
      await signatureFor(record.context.client, roverAuthorizationMessage(record.context), signature);
      await this.validateStoppedSession(record);
      if (record.skipApproval) {
        this.validateSkipContext(record);
        return record;
      }
      record.skipApproval = {context: this.skipContext(record, `0x${randomBytes(32).toString("hex")}`, this.deps.now())};
      return record;
    });
  }
  private validateSkipContext(record: RoverSessionRecord) {
    const approval = record.skipApproval;
    if (!approval) throw Error("SKIP_APPROVAL_NOT_PREPARED");
    const {nonce, issuedAt, expiresAt} = approval.context;
    if (!/^0x[0-9a-f]{64}$/i.test(nonce) || !Number.isSafeInteger(issuedAt) || issuedAt > this.deps.now()
      || issuedAt < record.context.issuedAt || expiresAt <= this.deps.now()) throw Error("SKIP_APPROVAL_EXPIRED_OR_INVALID");
    if (roverHash(approval.context) !== roverHash(this.skipContext(record, nonce, issuedAt))) throw Error("SKIP_APPROVAL_CONTEXT_CHANGED");
  }
  async authorizeSkip(jobId: unknown, sessionId: unknown, signature: unknown) {
    assertJobId(jobId);
    return this.deps.store.update(jobId, async job => {
      const record = this.stoppedRecord(job.sessions, jobId, sessionId);
      this.validateSkipContext(record);
      await signatureFor(record.context.client, roverSkipAuthorizationMessage(record.skipApproval!.context), signature);
      await this.validateStoppedSession(record);
      if (record.skipApproval!.signature) {
        await signatureFor(record.context.client, roverSkipAuthorizationMessage(record.skipApproval!.context), record.skipApproval!.signature);
        return record;
      }
      record.skipApproval!.signature = signature as Hex;
      record.skipApproval!.authorizedAt = new Date(this.deps.now() * 1000).toISOString();
      return record;
    });
  }
  private async access(raw: unknown, signature: unknown, action: RoverAccess["action"]) {
    const input = object(raw);
    keys(input, ["action", "chainId", "core", "jobId", "requestId", "issuedAt", ...(action === "prepare" ? ["options"] : [])]);
    assertJobId(input.jobId);
    if (input.action !== action || input.chainId !== this.deps.store.scope.chainId
      || typeof input.core !== "string" || input.core.toLowerCase() !== this.deps.store.scope.core.toLowerCase()
      || typeof input.requestId !== "string" || !uuid.test(input.requestId)
      || !Number.isSafeInteger(input.issuedAt) || Number(input.issuedAt) > this.deps.now() + 30
      || Number(input.issuedAt) < this.deps.now() - 300) throw Error("SESSION_ACCESS_EXPIRED_OR_INVALID");
    if (action === "prepare") parseOptions(input.options);
    const access = input as RoverAccess;
    const job = await (action === "status" && this.deps.readJob ? this.deps.readJob(access.jobId) : this.deps.fundedJob(access.jobId));
    await signatureFor(job.client, roverAccessMessage(access), signature);
    return {access, job};
  }
  async prepare(raw: unknown, signature: unknown) {
    const {access, job} = await this.access(raw, signature, "prepare");
    const options = access.options!;
    const now = this.deps.now();
    if (job.expiredAt <= BigInt(now)) throw Error("JOB_EXPIRED");
    const policy = options.judgmentMode === "VIDEO" ? await this.deps.videoPolicy()
      : {version: "rover-command-v1", drive: "successful-nonzero", stop: "confirmed", analysis: "SKIPPED"};
    const cameraUrl = options.judgmentMode === "VIDEO" ? (policy as {cameraUrl: string}).cameraUrl : null;
    if (options.judgmentMode === "VIDEO" && (typeof cameraUrl !== "string" || !cameraUrl.startsWith("http://"))) throw Error("CAMERA_CONFIGURATION_REQUIRED");
    return this.deps.store.update(access.jobId, async record => {
      const duplicate = record.requests[access.requestId];
      if (duplicate) {
        if (duplicate.hash !== roverHash(access)) throw Error("SESSION_REQUEST_CHANGED");
        const existing = record.sessions.find(s => s.context.sessionId === duplicate.sessionId);
        if (!existing) throw Error("SESSION_RECORD_INVALID");
        return existing;
      }
      if (record.sessions.some(s => ["STARTING", "RECORDING", "OPERATING", "STOPPING"].includes(s.phase)
        || (["AUTHORIZED", "CAPTURED"].includes(s.phase) && s.context.expiresAt > now))) throw Error("SESSION_ALREADY_AUTHORIZED");
      if (record.sessions.length >= 100) throw Error("SESSION_LIMIT_REACHED");
      for (const session of record.sessions) {
        if (session.context.expiresAt <= now) session.phase = "EXPIRED";
        else if (session.phase === "PREPARED") session.phase = "SUPERSEDED";
      }
      const camera = options.judgmentMode === "VIDEO" ? "external-fixed" as const : null;
      const policyHash = roverHash(policy);
      const context: RoverSessionContext = {version: 1, chainId: this.deps.store.scope.chainId,
        core: this.deps.store.scope.core as Address, evaluator: this.deps.evaluator, token: this.deps.token,
        jobId: access.jobId, client: job.client, provider: job.provider, budget: job.budget.toString(), jobExpiresAt: job.expiredAt.toString(),
        sessionId: randomUUID(), nonce: `0x${randomBytes(32).toString("hex")}`, issuedAt: now,
        expiresAt: Math.min(now + 900, Number(job.expiredAt)), options, camera, cameraUrl, policyHash,
        conditionsHash: roverHash({options, camera, cameraUrl, policyHash})};
      const session: RoverSessionRecord = {context, phase: "PREPARED"};
      record.sessions.push(session);
      record.requests[access.requestId] = {hash: roverHash(access), sessionId: context.sessionId};
      return session;
    });
  }
  async authorize(jobId: unknown, sessionId: unknown, signature: unknown) {
    assertJobId(jobId);
    if (typeof sessionId !== "string" || !uuid.test(sessionId)) throw Error("INVALID_SESSION_ID");
    return this.deps.store.update(jobId, async record => {
      const session = record.sessions.find(s => s.context.sessionId === sessionId);
      if (!session) throw Error("SESSION_NOT_FOUND");
      const context = session.context;
      await signatureFor(context.client, roverAuthorizationMessage(context), signature);
      if (context.expiresAt <= this.deps.now()) throw Error("SESSION_EXPIRED");
      if (session.phase !== "PREPARED") throw Error("SESSION_AUTHORIZATION_USED");
      const job = await this.deps.fundedJob(jobId);
      if (job.expiredAt <= BigInt(this.deps.now())) throw Error("JOB_EXPIRED");
      if (context.jobId !== jobId || job.id.toString() !== jobId || context.chainId !== this.deps.store.scope.chainId
        || context.core.toLowerCase() !== this.deps.store.scope.core.toLowerCase()
        || context.client.toLowerCase() !== job.client.toLowerCase() || context.provider.toLowerCase() !== job.provider.toLowerCase()
        || context.evaluator.toLowerCase() !== this.deps.evaluator.toLowerCase()
        || context.evaluator.toLowerCase() !== job.evaluator.toLowerCase() || context.token.toLowerCase() !== this.deps.token.toLowerCase()
        || context.budget !== job.budget.toString() || context.jobExpiresAt !== job.expiredAt.toString()) throw Error("SESSION_CONTEXT_CHANGED");
      parseOptions(context.options);
      if (context.conditionsHash !== roverHash({options: context.options, camera: context.camera, cameraUrl: context.cameraUrl, policyHash: context.policyHash})) throw Error("SESSION_CONTEXT_CHANGED");
      session.authorizationSignature = signature as Hex;
      session.authorizedAt = new Date(this.deps.now() * 1000).toISOString();
      session.phase = "AUTHORIZED";
      return session;
    });
  }
  async status(raw: unknown, signature: unknown) {
    const {access} = await this.access(raw, signature, "status");
    const session = (await this.deps.store.read(access.jobId))?.sessions.at(-1) ?? null;
    if (session && session.context.expiresAt <= this.deps.now() && !session.payment) return {...session, phase: "EXPIRED" as const};
    return session;
  }
}
