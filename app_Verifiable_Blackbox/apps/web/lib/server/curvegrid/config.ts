import "server-only";
import {createHash} from "node:crypto";
import data from "../../ledger/selection.json" with {type: "json"};
import {validateSelection} from "@/lib/ledger/types";

export const contracts = data.contracts;
export const selection = data.selection;
validateSelection(contracts, selection);

export function settings(env: NodeJS.ProcessEnv = process.env) {
  const missing: string[] = [];
  const input = env.MULTIBAAS_URL?.trim();
  const key = env.MULTIBAAS_API_KEY?.trim() ?? "";
  let baseUrl = "";
  if (!input) missing.push("MULTIBAAS_URL");
  else {
    const url = new URL(input);
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.multibaas\.com$/i.test(url.hostname)
      || url.username || url.password || url.search || url.hash
      || !["/", "/api/v0", "/api/v0/"].includes(url.pathname)) throw Error("INVALID_MULTIBAAS_URL");
    baseUrl = url.origin + "/api/v0";
  }
  if (!key) missing.push("MULTIBAAS_API_KEY");
  const value = env.LEDGER_CONFIRMATIONS ?? "12";
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw Error("INVALID_LEDGER_CONFIRMATIONS");
  const confirmations = Number(value);
  const fromBlock = env.LEDGER_FROM_BLOCK ?? "11782739";
  if (!/^\d+$/.test(fromBlock) || !Number.isSafeInteger(Number(fromBlock))) throw Error("INVALID_LEDGER_FROM_BLOCK");
  const discoveryFromBlock = Number(fromBlock);
  const fingerprint = createHash("sha256").update(JSON.stringify({contracts, baseUrl, confirmations, discoveryFromBlock,discoveryVersion:1})).digest("hex");
  return {baseUrl, key, confirmations, discoveryFromBlock, missing, configured: missing.length === 0, fingerprint};
}
