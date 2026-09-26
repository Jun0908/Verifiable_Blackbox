"use client";
import {useEffect, useRef, useState} from "react";
import {SiteHeader} from "@/components/site-header";
import {MonthlyPanel} from "./monthly-panel";
import {useLanguage} from "@/components/language";
import {formatAmount} from "@/lib/ledger/monthly-demo";
import type {LedgerState} from "@/lib/server/curvegrid/state";
import "./ledger.css";

type View = ReturnType<LedgerState["publicState"]>;
const stateText = {
  not_configured:["Connection not configured","接続未設定"], ready:["Ready to fetch","取得待ち"],
  loading:["Fetching payments…","支払実績を取得中…"], live:["Fetch complete","取得成功"],
  empty:["No payments in selection","対象0件"], error:["Fetch failed","取得失敗"], cached:["Saved results","保存済み取得結果"],
} as const;
const paymentText = {matched:["Matched","照合済み"],confirming:["Confirming","確認待ち"],incomplete:["Missing evidence","根拠不足"],mismatch:["Mismatch","不一致"]} as const;
const checkText = ["Job, payee and evaluator match","Evidence commitment matches receipt","Token transfer matches payment","Successful transaction and canonical block","Creation, submission and payment order","Required block confirmations"];
const errorText: Record<string,readonly [string,string]> = {
  AUTH:["Check API key and read permissions.","APIキーと読取権限を確認してください。"],
  RATE_LIMIT:["Wait a few seconds before refreshing.","数秒待ってから更新してください。"],
  BUSY:["A refresh is already running.","取得処理を実行中です。"],
  CUTOFF:["A selected transaction is outside the date limit.","対象取引が日付の上限を超えています。"],
};
export function LedgerPage() {
  const {language,t} = useLanguage();
  const translate = (pair: readonly [string,string]) => t(pair[0],pair[1]);
  const [view,setView] = useState<View | null>(null);
  const [tab,setTab] = useState<"payments" | "monthly">("payments");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const refreshing = useRef(false);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/api/ledger",{cache:"no-store",signal:controller.signal}).then(async r=>{
      if (!r.ok) throw Error("FETCH_FAILED");
      setView(await r.json());
    }).catch(()=>{if (!controller.signal.aborted) setError("FETCH_FAILED");});
    return ()=>controller.abort();
  },[]);
  async function refresh() {
    if (refreshing.current) return;
    refreshing.current=true;setBusy(true);setError(null);
    try {
      const response=await fetch("/api/ledger/refresh",{method:"POST",cache:"no-store"});
      const data=await response.json();
      if (!response.ok) throw Error(data.error || "FETCH_FAILED");
      setView(data);
    } catch(e) {setError(e instanceof Error ? e.message : "FETCH_FAILED");}
    finally {refreshing.current=false;setBusy(false);}
  }
  const stamp = (value:string) => new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-GB",{dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Tokyo"}).format(new Date(value));
  const code = error || view?.error;
  const errorMessage: readonly [string,string] | null=code ? errorText[code] ?? ["Unable to fetch. Check connection settings and try again.","取得できません。接続設定を確認して再試行してください。"] : null;
  return <main className="shell ledger-shell"><SiteHeader/>
    <section className="ledger-heading"><p className="ledger-eyebrow">CURVEGRID MULTIBAAS · SEPOLIA</p>
      <h1>{t("Payment ledger","支払台帳")}</h1><p>{t("Trace each payment through its Job, evidence and receipt.","支払いをJob・Evidence・Receiptの根拠まで確認できます。")}</p>
    </section>
    <div className="ledger-tabs" role="group" aria-label={t("Ledger view","台帳の表示")}>
      <button className={tab === "payments" ? "" : "secondary"} aria-pressed={tab === "payments"} onClick={()=>setTab("payments")}>{t("Payment records","支払実績")}</button>
      <button className={tab === "monthly" ? "" : "secondary"} aria-pressed={tab === "monthly"} onClick={()=>setTab("monthly")}>{t("Monthly sample","月次集計デモ")}</button>
    </div>
    {tab === "monthly" ? <MonthlyPanel/> : <section className="panel ledger-panel" aria-busy={busy}>
      <div className="ledger-actions"><h2>{t("Payment records","支払実績")}</h2>
        <button disabled={busy || !view?.configured} onClick={()=>void refresh()}>{busy ? t("Fetching…","取得中…") : t("Refresh from MultiBaas","MultiBaasから更新")}</button></div>
      <p role="status">{busy ? translate(stateText.loading) : view ? translate(stateText[view.state]) : t("Loading ledger…","台帳を読み込み中…")}</p>
      {errorMessage && <p className="ledger-error" role="alert">{translate(errorMessage)}</p>}
      {view?.state === "not_configured" && <p>{t("Set MULTIBAAS_URL and MULTIBAAS_API_KEY on the server to fetch payments.","ServerにMULTIBAAS_URLとMULTIBAAS_API_KEYを設定すると取得できます。")}</p>}
      {view && <>
        <p className="ledger-muted">{t("Selected scope","取得対象")}: {view.selection.jobs.length} Job · {[...new Set(view.selection.jobs.flatMap(j=>j.transactions))].length} Tx · {t("Through Sep 26, 2026 (JST)","2026年9月26日まで（日本時間）")}<br/>
          {t("Required confirmations","必要確認数")}: {view.confirmationsRequired} · {view.fetchedAt ? `${t("Fetched","取得時刻")}: ${stamp(view.fetchedAt)} JST` : t("Not fetched yet","未取得")}
          {view.range?.startBlock != null && <><br/>{t("Block range","取得ブロック範囲")}: {view.range.startBlock}–{view.range.endBlock}</>}
        </p>
        <div className="ledger-totals"><div><span>{t("Payment total","支払い総額")}</span><strong>{formatAmount(view.totalMinor)} <small>mUSDC</small></strong></div>
          <div><span>{t("Matched total","照合済み金額")}</span><strong>{formatAmount(view.matchedMinor)} <small>mUSDC</small></strong></div></div>
        {view.saved && <p className="ledger-notice">{t("Showing saved results at the fetch time above. Refresh to check chain data.","表示した取得時刻の保存済み結果です。更新してChainのデータを確認できます。")}</p>}
        {!view.payments.length && <p>{t("No payment records to display.","表示する支払実績はありません。")}</p>}
        {view.payments.map(p=><article key={p.id} className="ledger-payment">
          <div className="ledger-actions"><h3>Job {p.jobId}</h3><span className={`ledger-badge ${p.status}`}>{translate(paymentText[p.status])}</span><strong>{p.amountDisplay} mUSDC</strong></div>
          <p className="ledger-muted">{stamp(p.timestamp)} JST · {p.confirmations} {t("confirmations","確認")}</p>
          <details><summary>{t("View evidence and receipt","根拠と領収書を見る")}</summary>
            <dl><dt>{t("Recipient","受取先")}</dt><dd>{p.provider}</dd><dt>Core</dt><dd>{view.contracts.core}</dd>
              <dt>Evidence commitment</dt><dd>{p.evidenceCommitment ?? "—"}</dd><dt>Receipt ID</dt><dd>{p.receiptId ?? "—"}</dd>
              <dt>{t("Payment transaction","支払取引")}</dt><dd><a href={`${view.contracts.explorerUrl}/tx/${p.txHash}`} target="_blank" rel="noreferrer">{p.txHash} ↗</a></dd></dl>
            <ul>{p.checks.map((c,i)=><li key={i}>{c.ok ? "✓" : "—"} {t(checkText[i],c.label)}</li>)}</ul>
            <h4>{t("Source events","根拠イベント")}</h4><ul>{p.eventRefs.map(e=><li key={`${e.txHash}:${e.logIndex}`}><a href={`${view.contracts.explorerUrl}/tx/${e.txHash}#eventlog`} target="_blank" rel="noreferrer">{e.name} · log {e.logIndex} ↗</a></li>)}</ul>
          </details>
        </article>)}
      </>}
    </section>}
  </main>;
}
