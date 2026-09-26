"use client";
import {useEffect, useRef, useState} from "react";
import {useLanguage} from "@/components/language";
import type {Scene} from "@/lib/stegavar/types";

export function FramePlayer({scene}: {scene: Scene}) {
  const {t} = useLanguage();
  const [mode,setMode] = useState("stego");
  const [reveal,setReveal] = useState(false);
  const [frame,setFrame] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [frames,setFrames] = useState<HTMLImageElement[][] | null>(null);
  const [failed,setFailed] = useState(false);
  const cover = useRef<HTMLCanvasElement>(null);
  const secret = useRef<HTMLCanvasElement>(null);
  const {width,height,fps} = scene.manifest;

  useEffect(()=>{
    let active = true;
    const images: HTMLImageElement[] = [];
    setFrames(null);setFailed(false);setPlaying(false);
    const load = async (kind: string) => {
      const result: HTMLImageElement[] = [];
      for (let start=0;start<scene.manifest.frames;start+=8) {
        if (!active) return [];
        await Promise.all(Array.from({length:Math.min(8,scene.manifest.frames-start)},(_,offset)=>{
          const index=start+offset;
          return new Promise<void>((resolve,reject)=>{
            const image=new Image();images.push(image);
            image.onload=()=>{result[index]=image;resolve();};image.onerror=()=>reject(Error("FRAME_LOAD"));
            image.src=`${scene.base}/${kind}/${String(index).padStart(4,"0")}.png`;
          });
        }));
      }
      return result;
    };
    void Promise.all([load(mode),load("recovered")]).then(result=>{if(active)setFrames(result);})
      .catch(()=>{if(active)setFailed(true);});
    return ()=>{active=false;for(const img of images){img.onload=null;img.onerror=null;}};
  },[scene,mode]);
  useEffect(()=>{
    if (!frames) return;
    cover.current?.getContext("2d")?.drawImage(frames[0][frame],0,0,width,height);
    if(reveal)secret.current?.getContext("2d")?.drawImage(frames[1][frame],0,0,width,height);
  },[frames,frame,reveal,width,height]);
  useEffect(()=>{
    if(!playing || !frames)return;
    const timer=setInterval(()=>setFrame(value=>(value+1)%scene.manifest.frames),1000/fps);
    const stop=()=>{if(document.hidden)setPlaying(false);};
    document.addEventListener("visibilitychange",stop);
    return ()=>{clearInterval(timer);document.removeEventListener("visibilitychange",stop);};
  },[playing,frames,fps,scene.manifest.frames]);
  return <section className="panel stg-player">
    <div className="stg-toolbar" role="group" aria-label={t("Display mode","表示モード")}>
      {[["stego","Stego","埋込み後"],["cover","Cover","カバー"],["difference","Difference ×12","差分 ×12"]].map(([id,en,ja])=>
        <button key={id} className={mode===id?"":"secondary"} aria-pressed={mode===id} onClick={()=>setMode(id)}>{t(en,ja)}</button>)}
      <button className="secondary stg-reveal" aria-pressed={reveal} onClick={()=>setReveal(value=>!value)}>{reveal?t("Hide recovered video","復元映像を閉じる"):t("Reveal video","復元映像を表示")}</button>
    </div>
    <div className={`stg-viewers ${reveal?"revealed":""}`}>
      <figure><figcaption>{t("Cover comparison","カバーの比較")}</figcaption><canvas ref={cover} width={width} height={height} aria-label={t("Cover or stego video","カバー・埋込み映像")} style={{visibility:frames?"visible":"hidden"}}/></figure>
      {reveal&&<figure><figcaption>{t("Recovered rover video","復元したRover映像")}</figcaption><canvas ref={secret} width={width} height={height} aria-label={t("Recovered rover video","復元したRover映像")} style={{visibility:frames?"visible":"hidden"}}/></figure>}
    </div>
    <div className="stg-toolbar"><button disabled={!frames} onClick={()=>setPlaying(value=>!value)}>{playing?t("Pause","停止"):t("Play","再生")}</button>
      <input aria-label={t("Video position","再生位置")} type="range" min={0} max={scene.manifest.frames-1} value={frame} disabled={!frames} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value));}}/>
      <output>{(frame/fps).toFixed(1)} / {(scene.manifest.frames/fps).toFixed(1)} s</output></div>
    <p className="stg-muted" role="status">{failed?t("Video could not be loaded. Select another cover or reload the page.","映像を読み込めません。別のカバーを選ぶか、ページを再読込してください。"):!frames?t("Loading frames…","フレームを読み込み中…"):t("Reveal displays video reconstructed in advance. Both views share the same playback position.","Revealは事前に復元した映像を表示します。2つの映像を同じ再生位置で比較できます。")}</p>
  </section>;
}
