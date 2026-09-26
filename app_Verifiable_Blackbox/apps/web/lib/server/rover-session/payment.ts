import "server-only";
import {zeroHash, type Hex} from "viem";
import {demoEvidenceToWire, erc8183Abi, evaluatorAbi, evidenceCommitment, evidenceHookAbi, expectedChallenge, parseDemoEvidence} from "@/lib/contracts";
import {roverHash} from "@/lib/rover-session";
import {getDeployment, getPublicClient} from "../config";
import {submitDemoEvidence} from "../provider";
import {verifyEvidence} from "../verifier";
import {settleDemoVerdict} from "../settlement";
import {sessionStore} from "./guard";
import {ownedSession} from "./run";
import {analyzeRecordedSession, recordedBytes} from "./analysis";
import {roverPaymentBundle} from "./payment-gate";
import {issueRoverPaymentPermit} from "./payment-permit";

export async function completeRoverSession(jobId: unknown, sessionId: unknown, signature: unknown) {
  const owned = await ownedSession(jobId, sessionId, signature);
  const deployment = getDeployment(), client = getPublicClient(), id = BigInt(owned.context.jobId);
  return sessionStore().update(owned.context.jobId, async (stored, save) => {
    const record = stored.sessions.find(s => s.context.sessionId === owned.context.sessionId);
    if (!record || record !== stored.sessions.at(-1)) throw Error("SESSION_SUPERSEDED");
    const c = record.context;
    const job = await client.readContract({address: deployment.erc8183, abi: erc8183Abi, functionName: "getJob", args: [id]});
    if (job.id !== id || c.chainId !== deployment.chainId || c.core.toLowerCase() !== deployment.erc8183.toLowerCase()
      || c.evaluator.toLowerCase() !== deployment.evaluator.toLowerCase() || c.token.toLowerCase() !== deployment.mockUsdc.toLowerCase()
      || job.client.toLowerCase() !== c.client.toLowerCase() || job.provider.toLowerCase() !== c.provider.toLowerCase()
      || job.provider.toLowerCase() !== deployment.provider.toLowerCase() || job.evaluator.toLowerCase() !== c.evaluator.toLowerCase()
      || job.hook.toLowerCase() !== deployment.evidenceHook.toLowerCase() || job.budget.toString() !== c.budget
      || job.expiredAt.toString() !== c.jobExpiresAt) throw Error("SESSION_CONTEXT_CHANGED");
    const block = await client.getBlock();
    if (record.payment && job.status === 3) {
      const receipt = await client.readContract({address: deployment.evaluator, abi: evaluatorAbi, functionName: "receiptIdByJob", args: [id]});
      const commitment = await client.readContract({address: deployment.evidenceHook, abi: evidenceHookAbi, functionName: "evidenceCommitments", args: [id]});
      if (receipt === zeroHash || (record.payment.receiptId && receipt !== record.payment.receiptId)
        || commitment !== evidenceCommitment(parseDemoEvidence(record.payment.evidence))
        || record.payment.evidence.imageHash !== roverHash(record.payment.bundle)) throw Error("SETTLEMENT_RECEIPT_MISMATCH");
      record.payment.receiptId = receipt; record.payment.phase = "PAID";
      await save();
      return record;
    }
    if (!record.analysis && !record.buttonAuthorization) record.analysis = await analyzeRecordedSession(record);
    const bundle = await roverPaymentBundle(record, Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp)));
    if (!record.payment) {
      if (job.status !== 1) throw Error("JOB_NOT_FUNDED");
      if (!bundle.videoRecognitionSkipped && !record.buttonAuthorization) await recordedBytes(record);
      record.payment = {phase: "ELIGIBLE", bundle, evidence: demoEvidenceToWire({jobId: id, scenario: "success", robotId: "rover-demo-001",
        challenge: expectedChallenge(id, "success"), capturedAt: block.timestamp, imageHash: roverHash(bundle), checkpoint: "checkpoint-a", sequence: 1n})};
      await save();
    }
    const payment = record.payment;
    const evidence = parseDemoEvidence(payment.evidence);
    if (evidence.jobId !== id || evidence.imageHash !== roverHash(bundle) || roverHash(payment.bundle) !== roverHash(bundle)) throw Error("PAYMENT_RECORD_CHANGED");
    const commitment = evidenceCommitment(evidence), permit = issueRoverPaymentPermit(id, commitment);
    const received = async (hash: Hex, kind: "submit" | "complete") => {
      const receipt = await client.waitForTransactionReceipt({hash, timeout: 60000});
      if (receipt.status !== "success") throw Error(kind === "submit" ? "PROVIDER_TRANSACTION_REVERTED" : "SETTLEMENT_TRANSACTION_REVERTED");
    };
    try {
      delete payment.error;
      if (job.status === 1) {
        if (payment.submitTransactionHash) await received(payment.submitTransactionHash, "submit");
        else {
          if (payment.phase === "SUBMITTING") throw Error("TRANSACTION_RECONCILIATION_REQUIRED");
          payment.phase = "SUBMITTING"; await save();
          await submitDemoEvidence(evidence, async hash => {payment.submitTransactionHash = hash; await save();}, permit);
        }
      } else if (![2, 3].includes(job.status)) throw Error("JOB_NOT_PAYABLE");
      const onchain = await client.readContract({address: deployment.evidenceHook, abi: evidenceHookAbi, functionName: "evidenceCommitments", args: [id]});
      if (onchain !== commitment) throw Error("EVIDENCE_HASH_MISMATCH");
      if (job.status !== 3) {
        if (payment.completeTransactionHash) await received(payment.completeTransactionHash, "complete");
        else {
          if (payment.phase === "PAYING") throw Error("TRANSACTION_RECONCILIATION_REQUIRED");
          payment.phase = "VERIFYING"; await save();
          payment.verification = await verifyEvidence(evidence, permit);
          await save();
          await roverPaymentBundle(record, Math.floor(Date.now() / 1000));
          payment.phase = "PAYING"; await save();
          await settleDemoVerdict(payment.verification.verdict, payment.verification.signature,
            async hash => {payment.completeTransactionHash = hash; await save();}, permit);
        }
      }
      payment.receiptId = await client.readContract({address: deployment.evaluator, abi: evaluatorAbi, functionName: "receiptIdByJob", args: [id]});
      const completed = await client.readContract({address: deployment.erc8183, abi: erc8183Abi, functionName: "getJob", args: [id]});
      if (payment.receiptId === zeroHash || completed.status !== 3) throw Error("SETTLEMENT_RECEIPT_MISSING");
      payment.phase = "PAID"; await save();
      return record;
    } catch (error) {
      payment.error = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PAYMENT_PENDING_OR_FAILED";
      await save(); throw error;
    }
  });
}
