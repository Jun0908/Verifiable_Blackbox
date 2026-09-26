import "server-only";
import {mkdir, readFile, rename, writeFile, open, unlink} from "node:fs/promises";
import {resolve} from "node:path";
import {contracts, selection, settings} from "./config";
import {fetchSnapshot, safeError, type Snapshot} from "./fetch";
import {buildLedger, normalizeRawLog} from "@/lib/ledger/payment-ledger";
import {withinCutoff, validateSelection, type RetrievalState} from "@/lib/ledger/types";

export class LedgerState {
  snapshot: Snapshot | null = null;
  state: RetrievalState = "ready";
  error: string | null = null;
  busy = false;
  lastAttemptAt: string | null = null;
  constructor(readonly config = settings(), readonly directory = resolve(/* turbopackIgnore: true */ process.env.LEDGER_DIR || ".ledger"), readonly fetcher = fetchSnapshot) {}
  get path() {return resolve(this.directory, this.config.fingerprint + ".json");}
  async load() {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8")) as Snapshot;
      if (stored.version !== 1 || stored.source !== "multibaas" || stored.fingerprint !== this.config.fingerprint
        || !Number.isFinite(Date.parse(stored.fetchedAt)) || !Number.isSafeInteger(stored.range.chainHead)) throw Error("INVALID_SNAPSHOT");
      const selected = stored.selection ?? selection;
      const hashes = new Set(validateSelection(contracts,selected));
      const events = stored.events.map(e => {
        const parsed = normalizeRawLog(e.raw, e.timestamp);
        if (!parsed || !hashes.has(parsed.txHash) || !withinCutoff(parsed.timestamp, selected)) throw Error("INVALID_SNAPSHOT");
        return {...parsed, canonical:e.canonical === true};
      });
      stored.payments = buildLedger(events, stored.receipts, contracts, stored.range.chainHead, this.config.confirmations)
        .filter(p => selected.jobs.some(j => j.jobId === p.jobId));
      stored.events = events;
      this.snapshot = stored;
      this.state = "cached";
    } catch {this.snapshot = null; this.state = this.config.configured ? "ready" : "not_configured";}
  }
  publicState() {
    const payments = this.snapshot?.payments ?? [];
    return {state:this.busy ? "loading" as const : this.state, error:this.error, configured:this.config.configured,
      missing:this.config.missing, source:this.snapshot ? "multibaas" as const : null,
      saved:Boolean(this.snapshot && !["live","empty"].includes(this.state)), fetchedAt:this.snapshot?.fetchedAt ?? null,
      lastAttemptAt:this.lastAttemptAt, range:this.snapshot?.range ?? null, selection:this.snapshot?.selection ?? selection,
      contracts, confirmationsRequired:this.config.confirmations, payments,
      totalMinor:payments.reduce((n,p) => n + BigInt(p.amountMinor),0n).toString(),
      matchedMinor:payments.filter(p=>p.status === "matched").reduce((n,p)=>n+BigInt(p.amountMinor),0n).toString()};
  }
  async refresh() {
    if (!this.config.configured) {this.state = "not_configured"; return;}
    if (this.busy) throw Error("BUSY");
    this.busy = true;
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(this.directory,{recursive:true});
      try {lock = await open(this.path + ".lock","wx");} catch {throw Error("BUSY");}
      const attemptPath = this.path + ".attempt";
      let last = 0;
      try {last = Number(await readFile(attemptPath,"utf8"));} catch {}
      if (Date.now() - last < 4000) throw Error("RATE_LIMIT");
      await writeFile(attemptPath,String(Date.now()),{mode:0o600});
      this.lastAttemptAt = new Date().toISOString();
      const snapshot = await this.fetcher(this.config);
      await writeFile(this.path + ".tmp",JSON.stringify(snapshot),{mode:0o600});
      await rename(this.path + ".tmp",this.path);
      this.snapshot = snapshot;
      this.error = null;
      this.state = snapshot.payments.length ? "live" : "empty";
    } catch (error) {
      this.error = safeError(error);
      if (this.error === "BUSY" || this.error === "RATE_LIMIT") throw error;
      this.state = this.snapshot ? "cached" : "error";
    } finally {
      if (lock) {await lock.close(); await unlink(this.path + ".lock");}
      this.busy = false;
    }
  }
}
const holder = globalThis as typeof globalThis & {vbbLedger?: {key:string; promise:Promise<LedgerState>}};
export function ledgerState() {
  const config = settings();
  const key = config.fingerprint + ":" + config.configured;
  if (holder.vbbLedger?.key !== key) {
    const state = new LedgerState(config);
    holder.vbbLedger = {key,promise:state.load().then(()=>state)};
  }
  return holder.vbbLedger!.promise;
}
