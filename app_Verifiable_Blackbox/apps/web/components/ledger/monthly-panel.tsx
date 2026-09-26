"use client";
import {useEffect, useState} from "react";
import {useLanguage} from "@/components/language";
import {formatAmount, type summarize} from "@/lib/ledger/monthly-demo";
type Monthly = ReturnType<typeof summarize>;
export function MonthlyPanel() {
  const {t} = useLanguage();
  const [period,setPeriod] = useState("2026-09");
  const [data,setData] = useState<Monthly | null>(null);
  const [error,setError] = useState(false);
  useEffect(()=>{
    const controller = new AbortController();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return ()=>controller.abort();
    void fetch(`/api/ledger/monthly?period=${period}`,{cache:"no-store",signal:controller.signal}).then(async r=>{
      if (!r.ok) throw Error();setData(await r.json());
    }).catch(()=>{if (!controller.signal.aborted) setError(true);});
    return ()=>controller.abort();
  },[period]);
  return <section className="panel ledger-panel"><div className="ledger-actions"><h2>{t("Monthly summary demo","月次集計デモ")}</h2><span className="ledger-badge">SAMPLE</span></div>
    <p className="ledger-muted">{t("Sample usage for accounting exports. These records do not represent unpaid Jobs.","経理向け出力のサンプル明細です。未払いJobを表すものではありません。")}</p>
    <label>{t("Month · Asia/Tokyo","対象月・日本時間")} <input type="month" value={period} onChange={e=>{setData(null);setError(false);setPeriod(e.target.value);}}/></label>
    {error && <p role="alert" className="ledger-error">{t("Unable to load the sample.","サンプルを取得できません。")}</p>}
    {!data && !error && <p role="status">{t("Select a month to view the summary.","対象月を選択して集計を表示してください。")}</p>}
    {data && <>
      <div className="ledger-totals"><div><span>{t("Sample total","サンプル合計")}</span><strong>{data.amountDisplay} <small>mUSDC</small></strong></div>
        <div><span>{t("Usage records / counterparties","明細数 / 取引先数")}</span><strong>{data.usageCount} / {data.counterpartyCount}</strong></div></div>
      <div className="ledger-actions ledger-downloads"><a href={`/api/ledger/export?period=${period}&kind=summary`}>{t("Download summary CSV","集計CSVをダウンロード")}</a><a href={`/api/ledger/export?period=${period}&kind=details`}>{t("Download details CSV","明細CSVをダウンロード")}</a></div>
      {!data.rows.length && <p>{t("No sample usage for this month.","この月のサンプル明細は0件です。")}</p>}
      {data.groups.map(g=><article className="ledger-payment" key={g.counterpartyId}><div className="ledger-actions"><h3>{g.counterpartyName}</h3><strong>{g.amountDisplay} mUSDC · {g.usageCount} {t("records","件")}</strong></div>
        <details><summary>{t("View usage details","明細を見る")}</summary><div className="ledger-table-wrap"><table><thead><tr><th>ID</th><th>{t("Description","内容")}</th><th>mUSDC</th><th>{t("Evidence reference","根拠参照")}</th></tr></thead><tbody>{data.rows.filter(r=>r.counterpartyId===g.counterpartyId).map(r=><tr key={r.usageId}><td>{r.usageId}</td><td>{r.description}</td><td>{formatAmount(r.amountMinor,r.decimals)}</td><td>{r.evidenceRef}</td></tr>)}</tbody></table></div></details>
      </article>)}
    </>}
  </section>;
}
