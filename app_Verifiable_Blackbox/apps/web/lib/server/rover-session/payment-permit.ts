import "server-only";
import type {Hex} from "viem";
import {assertApprovalOnlyJob} from "./guard";

const permits = new WeakMap<object, {jobId: bigint; commitment: Hex}>();
export type RoverPaymentPermit = Readonly<{kind: "rover-payment"}>;
export function issueRoverPaymentPermit(jobId: bigint, commitment: Hex): RoverPaymentPermit {
  const permit = Object.freeze({kind: "rover-payment" as const});
  permits.set(permit, {jobId, commitment});
  return permit;
}
export async function assertEvidencePayment(jobId: bigint, commitment: Hex, permit?: RoverPaymentPermit) {
  if (permit === undefined) return assertApprovalOnlyJob(jobId);
  const saved = permits.get(permit);
  if (!saved || saved.jobId !== jobId || saved.commitment !== commitment) throw Error("ROVER_PAYMENT_PERMIT_INVALID");
}
