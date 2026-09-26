import "server-only";
import {erc8183Abi} from "@/lib/contracts";
import {getDeployment, getPublicClient} from "./config";
import {requireJobOwner} from "./rover-session/owner";
import {sessionStore} from "./rover-session/guard";
import {assertJobId} from "./rover-session/store";
import {recordedBytes} from "./rover-session/analysis";

export async function registerWorldRecording(request: Request, body: Record<string, unknown>) {
  if (Object.keys(body).some(key => !["jobId", "sessionId"].includes(key))) throw Error("INVALID_DISCLOSURE_REQUEST");
  assertJobId(body.jobId);
  if (body.sessionId !== undefined && (typeof body.sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.sessionId))) throw Error("INVALID_SESSION_ID");
  const deployment = getDeployment();
  const job = await getPublicClient().readContract({address: deployment.erc8183, abi: erc8183Abi, functionName: "getJob", args: [BigInt(body.jobId)]});
  if (job.id.toString() !== body.jobId) throw Error("JOB_NOT_FOUND");
  await requireJobOwner(request, job.client);
  const records = (await sessionStore().read(body.jobId))?.sessions ?? [];
  const record = body.sessionId ? records.find(item => item.context.sessionId === body.sessionId) : records.at(-1);
  if (!record || !["CAPTURED", "ERROR"].includes(record.phase) || !record.run?.recording.sha256 || !record.run.recording.frames.length) throw Error("RECORDING_UNAVAILABLE");
  if (record.context.client.toLowerCase() !== job.client.toLowerCase() || record.context.chainId !== deployment.chainId
    || record.context.core.toLowerCase() !== deployment.erc8183.toLowerCase() || record.context.jobId !== body.jobId) throw Error("JOB_CONTEXT_MISMATCH");
  const token = process.env.WORLD_INTERNAL_TOKEN;
  if (!process.env.WORLD_SERVICE_URL || !process.env.WORLD_PUBLIC_URL || !token || token.length < 32) throw Error("WORLD_NOT_CONFIGURED");
  const base = new URL(process.env.WORLD_SERVICE_URL), publicBase = new URL(process.env.WORLD_PUBLIC_URL);
  for (const url of [base, publicBase]) {
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password
      || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw Error("WORLD_CONFIGURATION_INVALID");
  }
  // Fetch only from the authenticated Bridge and verify the saved recording hash.
  const bytes = await recordedBytes(record);
  let response: Response;
  try {response = await fetch(new URL("/internal/assets", base), {method: "POST", headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json", Host: publicBase.host},
    body: JSON.stringify({chainId: deployment.chainId, core: deployment.erc8183, jobId: body.jobId,
      sessionId: record.context.sessionId, owner: job.client, rawSha256: record.run.recording.sha256,
      rawBase64: bytes.toString("base64"), frames: record.run.recording.frames.map(frame => ({sha256: frame.sha256, capturedAt: frame.capturedAt})),
      receiptId: record.payment?.receiptId ?? null, transactionHash: record.payment?.completeTransactionHash ?? null}),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000)});} catch {throw Error("WORLD_UNAVAILABLE");}
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Error(data.error === "APPROVER_OWNER_NOT_CONFIGURED" ? "WORLD_APPROVER_NOT_CONFIGURED" : "WORLD_REGISTRATION_FAILED");
  }
  const result = await response.json();
  if (!/^[a-zA-Z0-9_-]{32}$/.test(result.assetId) || result.sha256 !== record.run.recording.sha256
    || result.invitationUrl !== `${publicBase.origin}/?asset=${result.assetId}`) throw Error("WORLD_RESPONSE_INVALID");
  return {assetId: result.assetId as string, invitationUrl: result.invitationUrl as string, sha256: result.sha256 as string};
}
