import "server-only";

import {isAddress, isHex, zeroHash, type Hex} from "viem";
import {evaluatorAbi, type DemoVerdictWire} from "@/lib/contracts";
import {getDeployment, getPublicClient, getWalletClient} from "@/lib/server/config";
import {assertApprovalOnlyJob} from "./rover-session/guard";

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

function parseDecimal(value: unknown, label: string, max: bigint) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be a decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > max) throw new Error(`${label} is out of range`);
  return parsed;
}

export function parseDemoVerdict(input: unknown): DemoVerdictWire {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("verdict must be an object");
  }
  const verdict = input as Record<string, unknown>;
  if (
    typeof verdict.jobId !== "string"
    || typeof verdict.provider !== "string"
    || !isAddress(verdict.provider)
    || typeof verdict.evidenceCommitment !== "string"
    || !isHex(verdict.evidenceCommitment, {strict: true})
    || verdict.evidenceCommitment.length !== 66
    || verdict.outcome !== 1
    || typeof verdict.issuedAt !== "string"
    || typeof verdict.validUntil !== "string"
    || typeof verdict.nonce !== "string"
    || !isHex(verdict.nonce, {strict: true})
    || verdict.nonce.length !== 66
  ) {
    throw new Error("VERDICT_SCHEMA_INVALID");
  }
  const jobId = parseDecimal(verdict.jobId, "verdict.jobId", UINT256_MAX);
  if (jobId === 0n) throw new Error("verdict.jobId is out of range");
  parseDecimal(verdict.issuedAt, "verdict.issuedAt", UINT64_MAX);
  parseDecimal(verdict.validUntil, "verdict.validUntil", UINT64_MAX);
  return verdict as DemoVerdictWire;
}

export async function settleDemoVerdict(input: unknown, signature: unknown, onBroadcast?: (hash: Hex) => Promise<void>) {
  const verdict = parseDemoVerdict(input);
  await assertApprovalOnlyJob(BigInt(verdict.jobId));
  if (
    typeof signature !== "string"
    || !isHex(signature, {strict: true})
    || signature.length !== 132
  ) {
    throw new Error("SIGNATURE_INVALID");
  }

  const deployment = getDeployment();
  const publicClient = getPublicClient();
  const canonicalVerdict = {
    jobId: BigInt(verdict.jobId),
    provider: verdict.provider,
    evidenceCommitment: verdict.evidenceCommitment,
    outcome: verdict.outcome,
    issuedAt: BigInt(verdict.issuedAt),
    validUntil: BigInt(verdict.validUntil),
    nonce: verdict.nonce,
  } as const;
  const transactionHash = await getWalletClient("relayer").writeContract({
    address: deployment.evaluator,
    abi: evaluatorAbi,
    functionName: "settle",
    args: [canonicalVerdict, signature as Hex],
  });
  await onBroadcast?.(transactionHash);
  const receipt = await publicClient.waitForTransactionReceipt({hash: transactionHash});
  if (receipt.status !== "success") throw new Error("SETTLEMENT_TRANSACTION_REVERTED");
  const receiptId = await publicClient.readContract({
    address: deployment.evaluator,
    abi: evaluatorAbi,
    functionName: "receiptIdByJob",
    args: [canonicalVerdict.jobId],
  });
  if (receiptId === zeroHash) throw new Error("SETTLEMENT_RECEIPT_MISSING");

  return {transactionHash, receiptId};
}
