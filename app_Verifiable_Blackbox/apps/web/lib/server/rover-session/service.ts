import "server-only";
import {randomBytes, randomUUID} from "node:crypto";
import {verifyMessage, type Address, type Hex} from "viem";
import {roverAccessMessage, roverAuthorizationMessage, roverHash, type RoverAccess, type RoverOptions,
  type RoverSessionContext, type RoverSessionRecord} from "@/lib/rover-session";
import {assertJobId, RoverSessionStore} from "./store";

type SessionJob = {id: bigint; client: Address; provider: Address; budget: bigint; expiredAt: bigint; evaluator: Address; hook: Address};
export type SessionDependencies = {
  store: RoverSessionStore; evaluator: Address; token: Address;
  fundedJob(jobId: string): Promise<SessionJob>; now(): number;
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
    || !Number.isInteger(data.durationMs) || Number(data.durationMs) < 500 || Number(data.durationMs) > 5000
    || !Number.isInteger(data.speed) || Number(data.speed) < 1 || Number(data.speed) > 50) throw Error("INVALID_SESSION_OPTIONS");
  return data as RoverOptions;
}
async function signatureFor(address: Address, message: string, signature: unknown) {
  if (typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature)
    || !await verifyMessage({address, message, signature: signature as Hex}).catch(() => false)) throw Error("OWNER_SIGNATURE_REQUIRED");
}

export class RoverSessions {
  constructor(readonly deps: SessionDependencies) {}
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
    const job = await this.deps.fundedJob(access.jobId);
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
    return this.deps.store.update(access.jobId, async record => {
      const duplicate = record.requests[access.requestId];
      if (duplicate) {
        if (duplicate.hash !== roverHash(access)) throw Error("SESSION_REQUEST_CHANGED");
        const existing = record.sessions.find(s => s.context.sessionId === duplicate.sessionId);
        if (!existing) throw Error("SESSION_RECORD_INVALID");
        return existing;
      }
      if (record.sessions.some(s => s.phase === "AUTHORIZED" && s.context.expiresAt > now)) throw Error("SESSION_ALREADY_AUTHORIZED");
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
        expiresAt: Math.min(now + 900, Number(job.expiredAt)), options, camera, policyHash,
        conditionsHash: roverHash({options, camera, policyHash})};
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
      if (context.conditionsHash !== roverHash({options: context.options, camera: context.camera, policyHash: context.policyHash})) throw Error("SESSION_CONTEXT_CHANGED");
      session.authorizationSignature = signature as Hex;
      session.authorizedAt = new Date(this.deps.now() * 1000).toISOString();
      session.phase = "AUTHORIZED";
      return session;
    });
  }
  async status(raw: unknown, signature: unknown) {
    const {access} = await this.access(raw, signature, "status");
    const session = (await this.deps.store.read(access.jobId))?.sessions.at(-1) ?? null;
    if (session && session.context.expiresAt <= this.deps.now()) return {...session, phase: "EXPIRED" as const};
    return session;
  }
}
