import {decodeEventLog, toEventSelector, type Hex} from "viem";
import type {Event as MBEvent, Log, TransactionReceiptData} from "@curvegrid/multibaas-sdk";
import type {Contracts} from "./types";
import {ledgerAbi, names} from "./contracts";
import {formatAmount} from "./monthly-demo";

export type LedgerEvent = {
  name: string; address: string; txHash: string; blockHash: string; blockNumber: number;
  logIndex: number; timestamp: string; args: Record<string, string>; canonical: boolean;
  raw: {address: string; data: string; topics: string[]; transactionHash: string; blockHash: string; blockNumber: string; logIndex: string; removed: boolean};
};
export type Payment = {
  source: "multibaas"; id: string; jobId: string; provider: string; client: string | null; amountMinor: string; amountDisplay: string;
  fundedMinor: string | null; timestamp: string; txHash: string; blockNumber: number; confirmations: number;
  evidenceCommitment: string | null; receiptId: string | null; verdictDigest: string | null; verdictSigner: string | null;
  evaluator: string | null; status: "matched" | "confirming" | "incomplete" | "mismatch";
  checks: {label: string; ok: boolean}[]; eventRefs: {name: string; txHash: string; address: string; logIndex: number}[];
};
const lower = (value: string) => value.toLowerCase();
export const eventKey = (event: LedgerEvent, chainId: number) => `${chainId}:${event.txHash.toLowerCase()}:${event.logIndex}`;
const hash = /^0x[0-9a-f]{64}$/i;
const address = /^0x[0-9a-f]{40}$/i;

export function normalizeEvent(item: MBEvent): LedgerEvent | null {
  if (!names.includes(item?.event?.name)) return null;
  if (!item.event.rawFields) throw new Error("イベントのrawFieldsがありません。MultiBaasのイベント取得設定を確認してください。");
  const raw = JSON.parse(item.event.rawFields);
  const normalized = normalizeRawLog(raw, item.triggeredAt);
  if (!normalized) return null;
  if (normalized.address !== lower(item.event.contract.address)
    || normalized.txHash !== lower(item.transaction.txHash)
    || normalized.blockHash !== lower(item.transaction.blockHash)
    || normalized.blockNumber !== item.transaction.blockNumber || normalized.name !== item.event.name) throw new Error("MultiBaasイベントのメタデータが一致しません。");
  return normalized;
}

// Both the event index and the per-transaction receipt API provide Ethereum logs.
// Receipt logs are decoded locally; no indexed event response is fabricated.
export function normalizeRawLog(raw: Log, timestamp: string): LedgerEvent | null {
  if (raw.removed === true) return null;
  if (!address.test(raw.address) || !hash.test(raw.transactionHash) || !hash.test(raw.blockHash)
    || !Array.isArray(raw.topics) || raw.topics.some((topic: unknown) => typeof topic !== "string" || !hash.test(topic))
    || typeof raw.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(raw.data)) throw new Error("イベントの生ログ形式が不正です。");
  const blockNumber = Number(BigInt(raw.blockNumber));
  const logIndex = Number(BigInt(raw.logIndex));
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0 || !Number.isSafeInteger(logIndex) || logIndex < 0
    || !Number.isFinite(Date.parse(timestamp))) throw new Error("イベントのブロック・日時が不正です。");
  if (!ledgerAbi.some(event => toEventSelector(event).toLowerCase() === raw.topics[0]?.toLowerCase())) return null;
  const decoded = decodeEventLog({abi: ledgerAbi, data: raw.data as Hex, topics: raw.topics as [Hex, ...Hex[]], strict: true});
  const args = Object.fromEntries(Object.entries(decoded.args).map(([key, value]) => [key, typeof value === "string" && value.startsWith("0x") ? lower(value) : String(value)]));
  return {name: decoded.eventName, address: lower(raw.address), txHash: lower(raw.transactionHash), blockHash: lower(raw.blockHash), blockNumber, logIndex, timestamp: new Date(timestamp).toISOString(), args, canonical: false, raw};
}

export function deduplicate(events: LedgerEvent[], chainId: number): LedgerEvent[] {
  const unique = new Map<string, LedgerEvent>();
  for (const event of events) {
    const key = eventKey(event, chainId);
    const previous = unique.get(key);
    if (previous && (previous.blockHash !== event.blockHash || previous.address !== event.address || previous.raw.data !== event.raw.data || previous.raw.topics.join() !== event.raw.topics.join())) throw new Error("同じイベントに異なるログがあります。同期をやり直してください。");
    unique.set(key, event);
  }
  return [...unique.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export function receiptContains(receipt: TransactionReceiptData | undefined, event: LedgerEvent): boolean {
  if (!receipt || BigInt(receipt.status) !== 1n || lower(receipt.transactionHash) !== event.txHash || lower(receipt.blockHash) !== event.blockHash) return false;
  return receipt.logs.some(log => !log.removed && Number(BigInt(log.logIndex)) === event.logIndex && lower(log.address) === event.address
    && lower(log.data) === lower(event.raw.data) && log.topics.map(lower).join() === event.raw.topics.map(lower).join());
}

export function buildLedger(all: LedgerEvent[], receipts: Record<string, TransactionReceiptData>, config: Contracts, head: number, confirmationsRequired: number): Payment[] {
  const events = deduplicate(all, config.chainId);
  const core = lower(config.core), hook = lower(config.hook), token = lower(config.token);
  const approvedEvaluators = config.evaluators.map(lower);
  return events.filter(e => e.name === "PaymentReleased" && e.address === core).map(payment => {
    const jobId = payment.args.jobId;
    const matches = (name: string, emittingAddress: string) => events.filter(e => e.name === name && e.address === emittingAddress && e.args.jobId === jobId);
    const jobs = matches("JobCreated", core);
    const job = jobs.length === 1 ? jobs[0] : undefined;
    const evidenceList = matches("EvidenceCommitted", hook);
    const evidence = evidenceList.length === 1 ? evidenceList[0] : undefined;
    const evaluator = job?.args.evaluator;
    const receiptEvents = evaluator && approvedEvaluators.includes(evaluator) ? matches("DemoWorkReceiptIssued", evaluator).filter(e => e.txHash === payment.txHash && e.blockHash === payment.blockHash) : [];
    const receiptEvent = receiptEvents.length === 1 ? receiptEvents[0] : undefined;
    const transfers = events.filter(e => e.name === "Transfer" && e.address === token && e.txHash === payment.txHash && e.blockHash === payment.blockHash
      && e.args.from === core && e.args.to === payment.args.provider && e.args.value === payment.args.amount);
    const funded = matches("JobFunded", core);
    const receipt = receipts[payment.txHash];
    const sameJob = Boolean(job && job.args.provider === payment.args.provider && job.args.hook === hook && evaluator && approvedEvaluators.includes(evaluator));
    const sameEvidence = Boolean(evidence && receiptEvent && evidence.args.evidenceCommitment === receiptEvent.args.evidenceCommitment && receiptEvent.args.provider === payment.args.provider);
    const confirmations = Math.max(0, head - payment.blockNumber + 1);
    const validPayment = payment.canonical && receiptContains(receipt, payment);
    const chronology = Boolean(job && evidence && (job.blockNumber < evidence.blockNumber || job.blockNumber === evidence.blockNumber && job.logIndex < evidence.logIndex)
      && (evidence.blockNumber < payment.blockNumber || evidence.blockNumber === payment.blockNumber && evidence.logIndex < payment.logIndex));
    const checks = [
      {label: "Job・受取先・検証担当の一致", ok: sameJob},
      {label: "提出とReceiptのEvidence hashが一致", ok: sameEvidence},
      {label: "同じ取引のToken送金が一致", ok: transfers.length === 1 && receiptContains(receipt, transfers[0])},
      {label: "取引成功と正規ブロックを確認", ok: validPayment && Boolean(job?.canonical && evidence?.canonical && receiptEvent?.canonical) && Boolean(receiptEvent && receiptContains(receipt, receiptEvent))},
      {label: "発注→提出→支払いの順序", ok: chronology},
      {label: `${confirmationsRequired}ブロックの確認`, ok: confirmations >= confirmationsRequired}
    ];
    const wrongTransfer = events.some(e => e.name === "Transfer" && e.address === token && e.txHash === payment.txHash && e.args.from === core && e.args.to === payment.args.provider && e.args.value !== payment.args.amount);
    const contradiction = wrongTransfer || Boolean(job && evidence && !chronology) || Boolean(job && !job.canonical) || Boolean(evidence && !evidence.canonical) || !payment.canonical || (receipt !== undefined && !validPayment) || (job !== undefined && !sameJob)
      || (evidence !== undefined && receiptEvent !== undefined && !sameEvidence)
      || jobs.length > 1 || evidenceList.length > 1 || receiptEvents.length > 1 || transfers.length > 1
      || events.filter(e => e.name === "PaymentReleased" && e.address === core && e.args.jobId === jobId).length > 1;
    const status: Payment["status"] = contradiction ? "mismatch" : checks.every(c => c.ok) ? "matched" : checks.slice(0, -1).every(c => c.ok) ? "confirming" : "incomplete";
    return {source: "multibaas" as const, id: `${config.chainId}:${core}:${jobId}`, jobId, provider: payment.args.provider, client: job?.args.client ?? null,
      amountMinor: payment.args.amount, amountDisplay: formatAmount(payment.args.amount, config.tokenDecimals), fundedMinor: funded.length === 1 ? funded[0].args.amount : null,
      timestamp: payment.timestamp, txHash: payment.txHash, blockNumber: payment.blockNumber, confirmations,
      evidenceCommitment: evidence?.args.evidenceCommitment ?? null, receiptId: receiptEvent?.args.receiptId ?? null,
      verdictDigest: receiptEvent?.args.verdictDigest ?? null, verdictSigner: receiptEvent?.args.verdictSigner ?? null,
      evaluator: evaluator ?? null, status, checks,
      eventRefs: [job, funded.length === 1 ? funded[0] : undefined, evidence, receiptEvent, payment, transfers[0]].filter((e): e is LedgerEvent => Boolean(e)).map(e => ({name: e.name, txHash: e.txHash, address: e.address, logIndex: e.logIndex}))};
  }).sort((a, b) => b.blockNumber - a.blockNumber);
}
