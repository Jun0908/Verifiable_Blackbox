export type Contracts = {
  chainId: number; core: string; hook: string; evaluators: string[];
  token: string; tokenSymbol: string; tokenDecimals: number; explorerUrl: string;
};
export type Selection = {
  chainId: number; cutoffExclusive: string;
  jobs: {jobId: string; source: string; transactions: string[]}[];
};
export type RetrievalState = "not_configured" | "ready" | "loading" | "live" | "empty" | "error" | "cached";

export function validateSelection(contracts: Contracts, selection: Selection) {
  const addresses = [contracts.core, contracts.hook, contracts.token, ...contracts.evaluators];
  if (contracts.chainId !== 11155111 || selection.chainId !== contracts.chainId
    || !addresses.every(a => /^0x[0-9a-f]{40}$/i.test(a)) || !contracts.evaluators.length
    || contracts.tokenDecimals !== 6 || contracts.tokenSymbol !== "mUSDC"
    || !Number.isFinite(Date.parse(selection.cutoffExclusive))
    || !Array.isArray(selection.jobs) || selection.jobs.length > 10
    || new Set(selection.jobs.map(j => j.jobId)).size !== selection.jobs.length
    || selection.jobs.some(j => !/^(0|[1-9]\d*)$/.test(j.jobId) || !j.source
      || !Array.isArray(j.transactions) || !j.transactions.length
      || j.transactions.some(tx => !/^0x[0-9a-f]{64}$/i.test(tx)))) throw Error("INVALID_LEDGER_SELECTION");
  const hashes = [...new Set(selection.jobs.flatMap(j => j.transactions.map(tx => tx.toLowerCase())))];
  if (hashes.length > 40) throw Error("LEDGER_TRANSACTION_LIMIT");
  return hashes;
}

export const jobKey = (chainId: number, core: string, jobId: string) => `${chainId}:${core.toLowerCase()}:${BigInt(jobId)}`;
export const withinCutoff = (timestamp: string, selection: Selection) => Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) < Date.parse(selection.cutoffExclusive);
