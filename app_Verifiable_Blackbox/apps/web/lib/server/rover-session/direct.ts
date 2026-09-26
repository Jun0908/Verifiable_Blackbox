import "server-only";
import {randomBytes, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {erc8183Abi} from "@/lib/contracts";
import {ROVER_JOB_DESCRIPTION, ROVER_BUTTON_JOB_DESCRIPTION, roverHash, type RoverSessionContext, type RoverSessionRecord} from "@/lib/rover-session";
import {getDeployment, getPublicClient} from "../config";
import {sessionStore} from "./guard";
import {assertJobId} from "./store";
import {videoPolicy} from "./index";
import {requireJobOwner} from "./owner";

export async function prepareButtonSession(request: Request, jobId: unknown, skipVideo: unknown) {
  assertJobId(jobId);
  if (typeof skipVideo !== "boolean") throw Error("INVALID_SESSION_REQUEST");
  const deployment = getDeployment(), client = getPublicClient();
  const job = await client.readContract({address: deployment.erc8183, abi: erc8183Abi, functionName: "getJob", args: [BigInt(jobId)]});
  if (job.id.toString() !== jobId || ![1,2,3].includes(job.status)) throw Error("JOB_NOT_AVAILABLE");
  await requireJobOwner(request, job.client);
  if (![ROVER_JOB_DESCRIPTION, ROVER_BUTTON_JOB_DESCRIPTION].includes(job.description)
    || job.provider.toLowerCase() !== deployment.provider.toLowerCase() || job.evaluator.toLowerCase() !== deployment.evaluator.toLowerCase()
    || job.hook.toLowerCase() !== deployment.evidenceHook.toLowerCase()) throw Error("JOB_CONTEXT_MISMATCH");
  const saved = (await sessionStore().read(jobId))?.sessions.at(-1);
  if (saved?.buttonAuthorization && (saved.run || saved.payment || (saved.context.expiresAt > Date.now()/1000
    && (saved.context.options.judgmentMode === "SKIP_VIDEO") === skipVideo))) return saved;
  if (job.status !== 1 || job.expiredAt <= BigInt(Math.floor(Date.now()/1000))) throw Error("JOB_NOT_FUNDED");
  const policy = skipVideo ? {version: "forward-button-v1", analysis: "SKIPPED"} : await videoPolicy().catch(async () => ({cameraUrl: "",
    motion: JSON.parse(await readFile(resolve(process.cwd(), "../../services/stegavar/config/rover_motion.json"), "utf8"))}));
  return sessionStore().update(jobId, async stored => {
    const previous = stored.sessions.at(-1);
    if (previous?.payment || previous?.run || previous?.buttonAuthorization?.pressedAt) throw Error("SESSION_ALREADY_STARTED");
    if (previous?.buttonAuthorization && previous.context.expiresAt > Date.now()/1000
      && (previous.context.options.judgmentMode === "SKIP_VIDEO") === skipVideo) return previous;
    if (previous) previous.phase = "SUPERSEDED";
    const now = Math.floor(Date.now()/1000), options = {judgmentMode: skipVideo ? "SKIP_VIDEO" as const : "VIDEO" as const, operation: "FORWARD" as const, durationMs: 3000, speed: 35};
    const camera = skipVideo ? null : "external-fixed" as const, cameraUrl = "cameraUrl" in policy ? policy.cameraUrl : null;
    const policyHash = roverHash(policy);
    const context: RoverSessionContext = {version: 1, paymentPolicy: "forward-button-v1", chainId: deployment.chainId, core: deployment.erc8183, evaluator: deployment.evaluator, token: deployment.mockUsdc,
      jobId, client: job.client, provider: job.provider, budget: job.budget.toString(), jobExpiresAt: job.expiredAt.toString(), sessionId: randomUUID(),
      nonce: `0x${randomBytes(32).toString("hex")}`, issuedAt: now, expiresAt: Number(job.expiredAt), options, camera, cameraUrl, policyHash,
      conditionsHash: roverHash({options, camera, cameraUrl, policyHash})};
    const record: RoverSessionRecord = {context, phase: "AUTHORIZED", controlToken: `0x${randomBytes(32).toString("hex")}`,
      buttonAuthorization: {policy: "forward-button-v1", contextHash: roverHash(context), owner: job.client, authenticatedAt: new Date().toISOString()}};
    stored.sessions.push(record);
    return record;
  });
}
