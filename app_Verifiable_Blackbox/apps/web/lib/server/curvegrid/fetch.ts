import "server-only";
import {ChainsApi, Configuration, type TransactionReceiptData} from "@curvegrid/multibaas-sdk";
import {contracts, settings} from "./config";
import {validateSelection, withinCutoff, type Selection} from "@/lib/ledger/types";
import {buildLedger, deduplicate, normalizeRawLog, type LedgerEvent, type Payment} from "@/lib/ledger/payment-ledger";
import {discoverSelection} from "./discovery";

export type Snapshot = {
  version: 1; source: "multibaas"; fingerprint: string; fetchedAt: string;
  range: {startBlock: number | null; endBlock: number | null; chainHead: number};
  events: LedgerEvent[]; receipts: Record<string, TransactionReceiptData>; payments: Payment[];
  selection?: Selection;
};
export function client(config = settings()) {
  if (!config.configured) throw Error("NOT_CONFIGURED");
  return new ChainsApi(new Configuration({basePath:config.baseUrl, accessToken:config.key,
    baseOptions:{timeout:15000, maxRedirects:0, signal:AbortSignal.timeout(300000)}}));
}
const unwrap = <T>(data: {status: number; result: T}) => {
  if (data.status < 200 || data.status >= 300 || data.result == null) throw Error("INVALID_RESPONSE");
  return data.result;
};
export function safeError(error: unknown): string {
  const e = error as {message?: string; response?: {status?: number}};
  if (e.response?.status === 401 || e.response?.status === 403) return "AUTH";
  if (e.response?.status === 429) return "RATE_LIMIT";
  const codes = ["NOT_CONFIGURED","WRONG_CHAIN","RECEIPT","REORG","CUTOFF","SELECTION","BUSY","RATE_LIMIT","INVALID_RESPONSE"];
  return codes.includes(e.message ?? "") ? e.message! : "FETCH_FAILED";
}
export async function fetchSnapshot(config = settings(), api = client(config), selected?: Selection): Promise<Snapshot> {
  const status = unwrap((await api.getChainStatus()).data);
  if (status.chainID !== contracts.chainId) throw Error("WRONG_CHAIN");
  if (!Number.isSafeInteger(status.blockNumber) || status.blockNumber < 0) throw Error("INVALID_RESPONSE");
  const anchorBlock = unwrap((await api.getBlock(String(status.blockNumber))).data);
  const anchor = anchorBlock.hash.toLowerCase();
  selected ??= await discoverSelection(contracts,config.discoveryFromBlock,status.blockNumber,anchor,
    new Date((anchorBlock.timestamp+1)*1000).toISOString());
  const hashes = validateSelection(contracts, selected);
  const receipts: Snapshot["receipts"] = {};
  const events: LedgerEvent[] = [];
  const targets = [contracts.core, contracts.hook, contracts.token, ...contracts.evaluators].map(a => a.toLowerCase());
  const blocks = new Map<number, {hash: string; timestamp: number}>();
  for (const tx of hashes) {
    const receipt = unwrap((await api.getTransactionReceipt(tx)).data).data;
    const n = Number(BigInt(receipt.blockNumber));
    if (receipt.transactionHash.toLowerCase() !== tx || BigInt(receipt.status) !== 1n
      || !Number.isSafeInteger(n) || n < 0 || n > status.blockNumber) throw Error("RECEIPT");
    if (!blocks.has(n)) blocks.set(n, unwrap((await api.getBlock(String(n))).data));
    const block = blocks.get(n)!;
    if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw Error("REORG");
    const timestamp = new Date(block.timestamp * 1000).toISOString();
    if (!withinCutoff(timestamp, selected)) throw Error("CUTOFF");
    receipts[tx] = receipt;
    for (const log of receipt.logs) {
      if (!targets.includes(log.address.toLowerCase())) continue;
      if (log.transactionHash.toLowerCase() !== tx || log.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()
        || Number(BigInt(log.blockNumber)) !== n || log.removed) throw Error("RECEIPT");
      const event = normalizeRawLog(log, timestamp);
      if (event) events.push({...event, canonical:true});
    }
  }
  const normalized = deduplicate(events, contracts.chainId);
  const payments = buildLedger(normalized, receipts, contracts, status.blockNumber, config.confirmations)
    .filter(p => selected.jobs.some(j => j.jobId === p.jobId));
  for (const job of selected.jobs) {
    if (!payments.some(p => p.jobId === job.jobId && job.transactions.some(tx => tx.toLowerCase() === p.txHash))) throw Error("SELECTION");
  }
  if (unwrap((await api.getBlock(String(status.blockNumber))).data).hash.toLowerCase() !== anchor) throw Error("REORG");
  return {version:1, source:"multibaas", fingerprint:config.fingerprint, fetchedAt:new Date().toISOString(),
    range:{startBlock:blocks.size ? Math.min(...blocks.keys()) : null, endBlock:blocks.size ? Math.max(...blocks.keys()) : null, chainHead:status.blockNumber},
    events:normalized, receipts, payments, selection:selected};
}
