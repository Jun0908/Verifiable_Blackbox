import "server-only";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rmdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {zeroHash, type Hex} from "viem";
import {authorizationDocumentHash, checkReviewSignature, type DemoReviewRecord} from "@/lib/demo-review";
import {demoEvidenceToWire, erc8183Abi, evaluatorAbi, evidenceCommitment, evidenceHookAbi, expectedChallenge, parseDemoEvidence} from "@/lib/contracts";
import {assertDemoAutomationEnabled, getDeployment, getPublicClient} from "./config";
import {getFundedDemoJob, submitDemoEvidence} from "./provider";
import {verifyEvidence} from "./verifier";
import {settleDemoVerdict} from "./settlement";

function recordPath(jobId: string) {
  if (!/^[1-9][0-9]{0,77}$/.test(jobId)) throw new Error("INVALID_JOB_ID");
  const deployment = getDeployment();
  return resolve(process.env.DEMO_REVIEW_DIR || resolve(process.cwd(), ".demo-reviews"), `${deployment.chainId}-${deployment.erc8183.toLowerCase()}`, `${jobId}.json`);
}

export async function readDemoReview(jobId: string): Promise<DemoReviewRecord | null> {
  try {return JSON.parse(await readFile(recordPath(jobId), "utf8"));}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error;}
}

// An exclusive file lock also serializes different Next workers. A crash leaves a lock
// for explicit reconciliation, rather than risking an automatic second broadcast.
export async function updateDemoReview(jobId: string, action: string, signature?: unknown) {
  assertDemoAutomationEnabled();
  const path = recordPath(jobId);
  await mkdir(resolve(path, ".."), {recursive: true});
  const lock = `${path}.lock`;
  try {await mkdir(lock);} catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("APPROVAL_REQUEST_IN_PROGRESS");
    throw error;
  }
  try {
    const deployment = getDeployment();
    const client = getPublicClient();
    const id = BigInt(jobId);
    let record = await readDemoReview(jobId);
    const save = async () => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(record), {encoding: "utf8", flag: "wx"});
      await rename(temporary, path);
    };
    if (action === "prepare") {
      if (record) return record;
      const job = await getFundedDemoJob(id);
      const block = await client.getBlock();
      if (job.expiredAt <= block.timestamp) throw new Error("JOB_EXPIRED");
      record = {version: 1, source: "operator-demo", phase: "review", context: {
        chainId: deployment.chainId, core: deployment.erc8183, evaluator: deployment.evaluator,
        token: deployment.mockUsdc, jobId, client: job.client, provider: job.provider,
        budget: job.budget.toString(), expiresAt: job.expiredAt.toString(), nonce: randomUUID(),
      }};
      await save(); return record;
    }
    if (!record) throw new Error("AUTHORIZATION_REQUIRED");
    if (action !== "verify-and-pay") throw new Error("INVALID_REVIEW_ACTION");
    await checkReviewSignature(record.context, signature);
    const job = await client.readContract({address: deployment.erc8183, abi: erc8183Abi, functionName: "getJob", args: [id]});
    const context = record.context;
    if (context.chainId !== deployment.chainId || context.core.toLowerCase() !== deployment.erc8183.toLowerCase()
      || context.evaluator.toLowerCase() !== deployment.evaluator.toLowerCase()
      || context.token.toLowerCase() !== deployment.mockUsdc.toLowerCase()
      || job.id !== id || job.client.toLowerCase() !== context.client.toLowerCase()
      || job.provider.toLowerCase() !== context.provider.toLowerCase()
      || job.evaluator.toLowerCase() !== context.evaluator.toLowerCase()
      || job.hook.toLowerCase() !== deployment.evidenceHook.toLowerCase()
      || job.budget.toString() !== context.budget || job.expiredAt.toString() !== context.expiresAt) {
      throw new Error("APPROVAL_CONTEXT_CHANGED");
    }
    if (record.phase === "paid") return record;
    const block = await client.getBlock();
    if (job.status !== 3 && job.expiredAt <= block.timestamp) throw new Error("JOB_EXPIRED");
    if (!record.authorizationSignature) {
      if (job.status !== 1) throw new Error("JOB_NOT_FUNDED");
      record.authorizationSignature = signature as Hex;
      record.authorizedAt = new Date().toISOString();
      record.phase = "authorized";
      await save();
    }
    await checkReviewSignature(context, record.authorizationSignature);
    if (!record.evidence) {
      if (job.status !== 1) throw new Error("JOB_NOT_FUNDED");
      // DemoEvidenceV1's legacy imageHash slot commits to a signed demo authorization.
      // No camera image or physical sensor evidence is created or claimed here.
      record.evidence = demoEvidenceToWire({jobId: id, scenario: "success", robotId: "rover-demo-001",
        challenge: expectedChallenge(id, "success"), capturedAt: block.timestamp,
        imageHash: authorizationDocumentHash(record), checkpoint: "checkpoint-a", sequence: 1n});
      await save();
    }
    const evidence = parseDemoEvidence(record.evidence);
    if (evidence.imageHash !== authorizationDocumentHash(record)) throw new Error("AUTHORIZATION_DOCUMENT_MISMATCH");
    const commitment = evidenceCommitment(evidence);
    if (job.status === 1) {
      if (record.submitTransactionHash) {
        const receipt = await client.waitForTransactionReceipt({hash: record.submitTransactionHash});
        if (receipt.status !== "success") throw new Error("PROVIDER_TRANSACTION_REVERTED");
      } else {
        if (record.phase === "submitting") throw new Error("TRANSACTION_RECONCILIATION_REQUIRED");
        record.phase = "submitting"; await save();
        await submitDemoEvidence(evidence, async hash => {record!.submitTransactionHash = hash; await save();});
      }
    } else if (job.status !== 2 && job.status !== 3) throw new Error("JOB_NOT_PAYABLE");
    const onchainCommitment = await client.readContract({address: deployment.evidenceHook, abi: evidenceHookAbi, functionName: "evidenceCommitments", args: [id]});
    if (onchainCommitment !== commitment) throw new Error("EVIDENCE_HASH_MISMATCH");
    if (job.status !== 3) {
      if (record.completeTransactionHash) {
        const receipt = await client.waitForTransactionReceipt({hash: record.completeTransactionHash});
        if (receipt.status !== "success") throw new Error("SETTLEMENT_TRANSACTION_REVERTED");
      } else {
        if (record.phase === "paying") throw new Error("TRANSACTION_RECONCILIATION_REQUIRED");
        record.phase = "submitted"; await save();
        record.verification = await verifyEvidence(evidence);
        await save();
        record.phase = "paying"; await save();
        await settleDemoVerdict(record.verification.verdict, record.verification.signature,
          async hash => {record!.completeTransactionHash = hash; await save();});
      }
    }
    record.receiptId = await client.readContract({address: deployment.evaluator, abi: evaluatorAbi, functionName: "receiptIdByJob", args: [id]});
    if (record.receiptId === zeroHash) throw new Error("SETTLEMENT_RECEIPT_MISSING");
    record.phase = "paid"; await save(); return record;
  } finally {await rmdir(lock);}
}
