import {keccak256, toBytes, verifyMessage, type Address, type Hex} from "viem";
import type {DemoEvidenceWire, DemoVerifyResponse} from "./contracts";

export type ApprovalContext = {
  chainId: number; core: Address; evaluator: Address; token: Address;
  jobId: string; client: Address; provider: Address; budget: string;
  expiresAt: string; nonce: string;
};

export type DemoReviewRecord = {
  version: 1; source: "operator-demo"; context: ApprovalContext;
  authorizationSignature?: Hex; authorizedAt?: string;
  phase: "review" | "authorized" | "submitting" | "submitted" | "paying" | "paid";
  evidence?: DemoEvidenceWire; submitTransactionHash?: Hex;
  verification?: DemoVerifyResponse; completeTransactionHash?: Hex; receiptId?: Hex;
};

export function reviewMessage(context: ApprovalContext) {
  return [
    "Verifiable Blackbox — Robot operation Demo v1",
    "I authorize verification of this demo record and release of the reserved demo tokens.",
    "The demo verifies a committed record, not physical movement by a TEE.",
    "Action: verify-and-pay", `Chain: ${context.chainId}`, `Core: ${context.core}`,
    `Evaluator: ${context.evaluator}`, `Token: ${context.token}`,
    `Job: ${context.jobId}`, `Client: ${context.client}`, `Provider: ${context.provider}`,
    `Amount (base units): ${context.budget}`, `Expires at (Unix): ${context.expiresAt}`,
    `Nonce: ${context.nonce}`,
  ].join("\n");
}

export async function checkReviewSignature(context: ApprovalContext, signature: unknown) {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)
    || !await verifyMessage({address: context.client, message: reviewMessage(context), signature: signature as Hex})) {
    throw new Error("OWNER_SIGNATURE_REQUIRED");
  }
}

export function authorizationDocumentHash(record: DemoReviewRecord) {
  if (!record.authorizationSignature) throw new Error("AUTHORIZATION_REQUIRED");
  return keccak256(toBytes(`${reviewMessage(record.context)}\nSignature: ${record.authorizationSignature}`));
}
