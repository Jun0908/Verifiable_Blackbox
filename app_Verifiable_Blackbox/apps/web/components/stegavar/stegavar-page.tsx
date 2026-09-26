"use client";
import {useEffect,useState} from "react";
import {SiteHeader} from "@/components/site-header";
import {useLanguage} from "@/components/language";
import type {Catalog} from "@/lib/stegavar/types";
import {FramePlayer} from "./frame-player";
import {AnalysisPanel} from "./analysis-panel";
import "./stegavar.css";

export function StegavarPage() {
  const {t}=useLanguage();
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [failed,setFailed]=useState(false);
  const [caseId,setCaseId]=useState("rover-moving");
  const [sceneId,setSceneId]=useState("surf");
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/api/stegavar/assets/catalog.json",{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error();setCatalog(await response.json());
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return ()=>controller.abort();
  },[]);
  const selected=catalog?.cases.find(row=>row.id===caseId);
  const scene=selected?.scenes.find(row=>row.id===sceneId);
  return <main className="shell stg-shell"><SiteHeader/>
    <section className="stg-heading"><p className="eyebrow">STEGAVAR · OFF DUTY LAB</p><h1>{t("A rover on vacation?","Rover、休暇中？")}</h1><p>{t("A little work, hidden in a holiday. Compare the cover and reveal the rover inside.","バカンスの映像に、小さな仕事を。カバーを比較して、中のRoverをのぞいてみましょう。")}</p></section>
    {failed&&<p role="alert">{t("Video data is unavailable.","映像データを読み込めません。")}</p>}
    {!catalog&&!failed&&<p role="status">{t("Loading cases…","ケースを読み込み中…")}</p>}
    {catalog&&selected&&scene&&<>
      <section className="stg-selectors"><div><h2>{t("Rover footage","Roverの映像")}</h2><div className="stg-toolbar" role="group" aria-label={t("Rover case","Roverケース")}>{catalog.cases.map(row=><button key={row.id} className={caseId===row.id?"":"secondary"} aria-pressed={caseId===row.id} onClick={()=>setCaseId(row.id)}>{t(row.titleEn,row.titleJa)}</button>)}</div></div>
        <div><h2>{t("Holiday cover","バカンスのカバー")}</h2><div className="stg-toolbar" role="group" aria-label={t("Cover selection","カバー選択")}>{selected.scenes.map(row=><button key={row.id} className={sceneId===row.id?"":"secondary"} aria-pressed={sceneId===row.id} onClick={()=>setSceneId(row.id)}>{t(row.titleEn,row.titleJa)}</button>)}</div></div></section>
      <FramePlayer key={`${caseId}/${sceneId}`} scene={scene}/>
      <AnalysisPanel key={`${caseId}/${sceneId}`} scene={scene}/>
    </>}
  </main>;
}
