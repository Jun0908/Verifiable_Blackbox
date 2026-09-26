import "server-only";
import type {Hex} from "viem";
import {assertEvidencePayment, type RoverPaymentPermit} from "./rover-session/payment-permit";

import {
  JOB_BUDGET,
  erc8183Abi,
  evidenceCommitment,
  expectedChallenge,
  type DemoEvidenceV1,
} from "@/lib/contracts";
import {
  getDeployment,
  getPublicClient,
  getServerAccount,
  getWalletClient,
} from "@/lib/server/config";

export async function setDemoJobBudget(jobId: bigint) {
  const deployment = getDeployment();
  const publicClient = getPublicClient();
  const transactionHash = await getWalletClient("provider").writeContract({
    address: deployment.erc8183,
    abi: erc8183Abi,
    functionName: "setBudget",
    args: [jobId, JOB_BUDGET, "0x"],
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash: transactionHash});
  if (receipt.status !== "success") throw new Error("PROVIDER_TRANSACTION_REVERTED");
  return {transactionHash};
}

export async function getFundedDemoJob(jobId: bigint) {
  const deployment = getDeployment();
  const publicClient = getPublicClient();
  const job = await publicClient.readContract({
    address: deployment.erc8183,
    abi: erc8183Abi,
    functionName: "getJob",
    args: [jobId],
  });

  if (job.id === 0n || job.id !== jobId) throw new Error("JOB_NOT_FOUND");
  if (job.status !== 1) throw new Error("JOB_NOT_FUNDED");
  const providerAddress = getServerAccount("provider").address;
  if (
    job.provider.toLowerCase() !== providerAddress.toLowerCase()
    || job.provider.toLowerCase() !== deployment.provider.toLowerCase()
  ) {
    throw new Error("PROVIDER_MISMATCH");
  }
  if (job.evaluator.toLowerCase() !== deployment.evaluator.toLowerCase()) {
    throw new Error("EVALUATOR_MISMATCH");
  }
  if (job.hook.toLowerCase() !== deployment.evidenceHook.toLowerCase()) {
    throw new Error("HOOK_MISMATCH");
  }
  return job;
}

export async function submitDemoEvidence(evidence: DemoEvidenceV1, onBroadcast?: (hash: Hex) => Promise<void>, permit?: RoverPaymentPermit) {
  await assertEvidencePayment(evidence.jobId, evidenceCommitment(evidence), permit);
  const deployment = getDeployment();
  const publicClient = getPublicClient();
  const job = await getFundedDemoJob(evidence.jobId);
  if (evidence.challenge !== expectedChallenge(job.id, evidence.scenario)) {
    throw new Error("CHALLENGE_MISMATCH");
  }

  const commitment = evidenceCommitment(evidence);
  const transactionHash = await getWalletClient("provider").writeContract({
    address: deployment.erc8183,
    abi: erc8183Abi,
    functionName: "submit",
    args: [job.id, commitment, "0x"],
  });
  await onBroadcast?.(transactionHash);
  const receipt = await publicClient.waitForTransactionReceipt({hash: transactionHash});
  if (receipt.status !== "success") throw new Error("PROVIDER_TRANSACTION_REVERTED");

  return {transactionHash, evidenceCommitment: commitment};
}
