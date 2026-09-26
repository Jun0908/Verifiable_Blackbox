"use client";
import {useEffect,useRef,useState} from "react";
import {useLanguage} from "@/components/language";
import {matchesAnalysis,type Analysis,type Scene} from "@/lib/stegavar/types";

const errors:Record<string,readonly [string,string]>={
  BUSY:["Another analysis is running. Check status before retrying.","解析を実行中です。状態を確認して再試行してください。"],
  TIMEOUT:["The response timed out. Processing may still be running; check status before retrying.","応答待ちがタイムアウトしました。処理が続いている場合があるため、状態を確認して再試行してください。"],
  UNAVAILABLE:["The analysis service is unavailable. Start it and check status.","解析サービスに接続できません。起動して状態を確認してください。"],
  RESULT_MISMATCH:["The result does not match this video's identity or hashes.","解析結果のケース・映像ハッシュが一致しません。"],
  INPUT_INTEGRITY:["The input data did not pass its integrity check.","入力データのハッシュ照合に失敗しました。"],
};
export function AnalysisPanel({scene}:{scene:Scene}) {
  const {t,language}=useLanguage();
  const [result,setResult]=useState<Analysis>(scene.savedAnalysis);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [service,setService]=useState("checking");
  const request=useRef<AbortController|null>(null);
  const healthRequest=useRef<AbortController|null>(null);
  async function checkStatus() {
    healthRequest.current?.abort();
    const controller=new AbortController();healthRequest.current=controller;
    setService("checking");
    try {
      const response=await fetch("/api/stegavar/health",{cache:"no-store",signal:controller.signal});
      const data=await response.json();
      if(!controller.signal.aborted)setService(response.ok&&["ready","busy"].includes(data.state)?data.state:"unavailable");
    }catch {if(!controller.signal.aborted)setService("unavailable");}
  }
  useEffect(()=>{
    void checkStatus();
    return ()=>{request.current?.abort();healthRequest.current?.abort();};
  },[]);
  async function analyze() {
    if(request.current)return;
    const controller=new AbortController();request.current=controller;
    setBusy(true);setError(null);setService("busy");
    try {
      const response=await fetch("/api/stegavar/analyze",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({case:scene.manifest.case,scene:scene.id}),signal:controller.signal,cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"ANALYSIS_FAILED");
      if(!matchesAnalysis(data,scene)||data.execution!=="live"||!Number.isFinite(Date.parse(data.analyzed_at||""))||!Number.isFinite(data.total_seconds))throw Error("RESULT_MISMATCH");
      if(!controller.signal.aborted)setResult(data);
    }catch(cause) {if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"ANALYSIS_FAILED");}
    finally {if(!controller.signal.aborted){request.current=null;setBusy(false);void checkStatus();}}
  }
  const measurement=result.results.recovered;
  const label=measurement.label==="ROVER_MOVING"?t("Motion detected","動作あり"):measurement.label==="ROVER_STILL"?t("Nearly stationary","ほぼ静止"):t("Inconclusive","判定保留");
  const status=({ready:t("Ready","解析可能"),busy:t("Processing","解析中"),unavailable:t("Service unavailable","サービス未接続"),checking:t("Checking service…","状態確認中…")} as Record<string,string>)[service];
  const message=error?(errors[error]||["Analysis failed. Check status and retry.","解析に失敗しました。状態を確認して再試行してください。"]):null;
  return <section className="panel stg-analysis" aria-busy={busy}>
    <div className="stg-toolbar"><button disabled={busy||service!=="ready"} onClick={()=>void analyze()}>{busy?t("Analyzing…","解析中…"):t("Reanalyze recovered video","復元映像を再解析")}</button>
      <button className="secondary" disabled={service==="checking"} onClick={()=>void checkStatus()}>{t("Check service status","サービス状態を確認")}</button><span role="status">{status}</span></div>
    {message&&<p role="alert" className="stg-error">{t(message[0],message[1])}</p>}
    <p className="eyebrow">{result.execution==="live"?t("ANALYSIS FROM THIS REQUEST","今回の解析結果"):t("SAVED ANALYSIS","保存済み解析結果")}</p>
    <h2>{label}</h2><p>{t("Changed area in the measurement region","測定範囲の変化面積")} <strong>{measurement.changed_area_percent.toFixed(2)}%</strong></p>
    {result.execution==="live"&&<p>{new Intl.DateTimeFormat(language==="ja"?"ja-JP":"en-GB",{dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Tokyo"}).format(new Date(result.analyzed_at!))} JST · {result.total_seconds!.toFixed(2)} s</p>}
    <p>{result.model} · {result.model_revision} · CPU</p>
    <p className="stg-muted">{t("Measured from differences between recovered frames. This value describes visible motion, not confidence or job completion.","復元フレームの差分から動きを計測しています。面積の割合であり、確信度や仕事完了の判定ではありません。")}</p>
    <details><summary>{t("Method, hashes and sources","解析方式・ハッシュ・出典")}</summary><dl>
      <dt>{t("Saved measurement","保存済み測定値")}</dt><dd>{scene.savedAnalysis.results.recovered.changed_area_percent.toFixed(2)}%</dd>
      {result.request_id&&<><dt>{t("Analysis ID","解析ID")}</dt><dd>{result.request_id}</dd></>}
      <dt>{t("Stego SHA-256","埋込み映像 SHA-256")}</dt><dd><code>{scene.manifest.stego_sha256}</code></dd>
      <dt>{t("Recovered RGB frames SHA-256","復元RGBフレーム SHA-256")}</dt><dd><code>{scene.manifest.recovered_frames_sha256}</code></dd>
      <dt>{t("Cover source","カバー出典")}</dt><dd><a href={scene.source} target="_blank" rel="noreferrer">{scene.creator} · Pexels</a></dd>
    </dl><a href="/api/stegavar/assets/SOURCES.md">{t("Code, models and footage credits","コード・モデル・映像の出典一覧")}</a></details>
  </section>;
}
