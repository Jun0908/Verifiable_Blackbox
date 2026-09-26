"use client";
import {useEffect,useState} from "react";
import {SiteHeader} from "@/components/site-header";
import {useLanguage} from "@/components/language";
import type {Catalog} from "@/lib/stegavar/types";
import {FramePlayer} from "./frame-player";
import "./stegavar.css";

export function StegavarPage() {
  const {t}=useLanguage();
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [failed,setFailed]=useState(false);
  const [caseId,setCaseId]=useState("rover-moving");
  const [sceneId,setSceneId]=useState("surf");
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/stegavar/catalog.json",{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error();setCatalog(await response.json());
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return ()=>controller.abort();
  },[]);
  const selected=catalog?.cases.find(row=>row.id===caseId);
  const scene=selected?.scenes.find(row=>row.id===sceneId);
  const result=scene?.savedAnalysis.results.recovered;
  const label=result?.label==="ROVER_MOVING"?t("Motion detected","動作あり"):result?.label==="ROVER_STILL"?t("Nearly stationary","ほぼ静止"):t("Inconclusive","判定保留");
  return <main className="shell stg-shell"><SiteHeader/>
    <section className="stg-heading"><p className="eyebrow">STEGAVAR · OFF DUTY LAB</p><h1>{t("A rover on vacation?","Rover、休暇中？")}</h1><p>{t("A little work, hidden in a holiday. Compare the cover and reveal the rover inside.","バカンスの映像に、小さな仕事を。カバーを比較して、中のRoverをのぞいてみましょう。")}</p></section>
    {failed&&<p role="alert">{t("Video data is unavailable.","映像データを読み込めません。")}</p>}
    {!catalog&&!failed&&<p role="status">{t("Loading cases…","ケースを読み込み中…")}</p>}
    {catalog&&selected&&scene&&<>
      <section className="stg-selectors"><div><h2>{t("Rover footage","Roverの映像")}</h2><div className="stg-toolbar" role="group" aria-label={t("Rover case","Roverケース")}>{catalog.cases.map(row=><button key={row.id} className={caseId===row.id?"":"secondary"} aria-pressed={caseId===row.id} onClick={()=>setCaseId(row.id)}>{t(row.titleEn,row.titleJa)}</button>)}</div></div>
        <div><h2>{t("Holiday cover","バカンスのカバー")}</h2><div className="stg-toolbar" role="group" aria-label={t("Cover selection","カバー選択")}>{selected.scenes.map(row=><button key={row.id} className={sceneId===row.id?"":"secondary"} aria-pressed={sceneId===row.id} onClick={()=>setSceneId(row.id)}>{t(row.titleEn,row.titleJa)}</button>)}</div></div></section>
      <FramePlayer key={`${caseId}/${sceneId}`} scene={scene}/>
      <section className="panel stg-analysis"><p className="eyebrow">{t("SAVED ANALYSIS","保存済み解析結果")}</p><h2>{label}</h2><p>{t("Changed area in the measurement region","測定範囲の変化面積")} <strong>{result?.changed_area_percent.toFixed(2)}%</strong></p><p className="stg-muted">{t("Measured from differences between recovered frames. This value describes visible motion, not confidence or job completion.","復元フレームの差分から動きを計測しています。面積の割合であり、確信度や仕事完了の判定ではありません。")}</p>
        <details><summary>{t("Method, hashes and sources","解析方式・ハッシュ・出典")}</summary><dl><dt>{t("Method","解析方式")}</dt><dd>{scene.savedAnalysis.model} · {scene.savedAnalysis.model_revision} · CPU</dd><dt>{t("Stego SHA-256","埋込み映像 SHA-256")}</dt><dd><code>{scene.manifest.stego_sha256}</code></dd><dt>{t("Recovered RGB frames SHA-256","復元RGBフレーム SHA-256")}</dt><dd><code>{scene.manifest.recovered_frames_sha256}</code></dd><dt>{t("Cover source","カバー出典")}</dt><dd><a href={scene.source} target="_blank" rel="noreferrer">{scene.creator} · Pexels</a></dd></dl><a href="/stegavar/SOURCES.md">{t("Code, models and footage credits","コード・モデル・映像の出典一覧")}</a></details>
      </section>
    </>}
  </main>;
}
