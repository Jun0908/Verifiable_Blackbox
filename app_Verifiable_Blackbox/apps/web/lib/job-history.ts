import type {Address, Hex} from "viem";
import type {DemoEvidenceWire, DemoStatus, DemoVerifierInfo} from "./contracts";

export type ScenarioResult = {
  jobId: bigint; scenario: "success" | "tampered"; source: "fixture" | "rover";
  evidence?: DemoEvidenceWire; evidenceCommitment?: Hex;
  createTransactionHash: Hex; fundTransactionHash: Hex;
};
export type StoredDemoStateV3 = {
  version: 3; walletAddress: string;
  job: Omit<ScenarioResult, "jobId"> & {jobId: string};
  verified: boolean; verifier?: DemoVerifierInfo;
  verdictSignature?: Hex; completeTransactionHash?: Hex;
};
export type JobHistoryEntry = StoredDemoStateV3 & {status?: DemoStatus};
export type JobHistoryScope = {wallet: string; chainId: number; core: Address};

function historyKey(scope: JobHistoryScope) {
  return `vbb-job-history-v1:${scope.chainId}:${scope.core.toLowerCase()}:${scope.wallet.toLowerCase()}`;
}
export function readJobHistory(scope: JobHistoryScope): JobHistoryEntry[] {
  const raw = localStorage.getItem(historyKey(scope));
  if (!raw) return [];
  const entries: unknown = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error("JOB_HISTORY_UNREADABLE");
  return entries.filter((entry): entry is JobHistoryEntry => entry?.version === 3
    && entry.walletAddress?.toLowerCase() === scope.wallet.toLowerCase()
    && /^[1-9][0-9]*$/.test(entry.job?.jobId ?? "")
    && /^0x[0-9a-f]{64}$/i.test(entry.job?.createTransactionHash ?? ""));
}
export function saveJobToHistory(scope: JobHistoryScope, entry: JobHistoryEntry) {
  if (entry.walletAddress.toLowerCase() !== scope.wallet.toLowerCase()) throw new Error("WALLET_MISMATCH");
  const existing = readJobHistory(scope);
  const others = existing.filter(item => item.job.jobId !== entry.job.jobId
    || item.job.createTransactionHash !== entry.job.createTransactionHash);
  // Save before switching jobs. Storage failures must never silently discard a job.
  const entries = [entry, ...others];
  localStorage.setItem(historyKey(scope), JSON.stringify(entries));
  return entries;
}
