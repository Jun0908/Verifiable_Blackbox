"use client";

import {useEffect, useRef, useState} from "react";
import {useLanguage} from "./language";

type CameraStatus = {url: string; configured: boolean; enabled: boolean; receiving: boolean};
const endpoint = "/api/demo/rover/camera";

export function RoverCamera() {
  const {t} = useLanguage();
  const canvas = useRef<HTMLCanvasElement>(null);
  const initialized = useRef(false);
  const [info, setInfo] = useState<CameraStatus>();
  const [url, setUrl] = useState("");
  const [live, setLive] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (busy) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    let lastFrame = "", lastReceived = 0, nextStatus = 0;
    let current: CameraStatus | undefined;
    const abort = new AbortController();
    const clear = () => {
      lastReceived = 0; lastFrame = ""; setLive(false);
      canvas.current?.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
    };
    const hidden = () => {if (document.hidden) clear();};
    const stale = setInterval(() => {if (lastReceived && Date.now() - lastReceived > 2000) clear();}, 250);
    document.addEventListener("visibilitychange", hidden);
    async function read(path: string) {
      const response = await fetch(path, {cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3500)])});
      if (!response.ok) throw Error("Camera unavailable");
      return response;
    }
    async function poll() {
      try {
        if (document.hidden) return;
        if (Date.now() >= nextStatus) {
          const data: CameraStatus = await (await read(endpoint)).json();
          if (cancelled) return;
          current = data; setInfo(data); setUnavailable(false); nextStatus = Date.now() + 2000;
          if (!initialized.current) {setUrl(data.url); initialized.current = true;}
        }
        if (!current?.enabled || !current.configured) {clear(); return;}
        const response = await read(`${endpoint}?frame=1`);
        if (cancelled || document.hidden) return;
        if (response.status === 204) {clear(); return;}
        const stamp = response.headers.get("x-camera-frame") ?? "";
        if (stamp && stamp === lastFrame) return;
        const bitmap = await createImageBitmap(await response.blob());
        try {
          if (cancelled || document.hidden || !canvas.current) return;
          canvas.current.width = bitmap.width; canvas.current.height = bitmap.height;
          const context = canvas.current.getContext("2d");
          if (!context) throw Error("Canvas unavailable");
          context.drawImage(bitmap, 0, 0);
          lastFrame = stamp; lastReceived = Date.now(); setLive(true); setUnavailable(false);
        } finally {bitmap.close();}
      } catch {
        if (!cancelled) {clear(); setUnavailable(true);}
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), current?.enabled && !document.hidden ? 120 : 1000);
      }
    }
    void poll();
    return () => {cancelled = true; abort.abort(); clearTimeout(timer); clearInterval(stale); document.removeEventListener("visibilitychange", hidden);};
  }, [busy, revision]);

  async function configure(body: unknown) {
    setBusy(true); setError(false); setLive(false);
    try {
      const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw Error();
      const data: CameraStatus = await response.json();
      setInfo(data); setUrl(data.url); setUnavailable(false);
    } catch {setError(true);}
    finally {setBusy(false); setRevision(value => value + 1);}
  }

  const state = busy ? t("Saving…", "保存中…") : unavailable ? t("Camera unavailable · retrying", "カメラ未接続・再接続中") :
    info && !info.enabled ? t("Camera OFF", "カメラ OFF") : info && !info.configured ? t("Set the camera address below.", "下の設定でカメラのアドレスを入力してください。") : t("Connecting to camera…", "カメラへ接続中…");
  return <section className="rover-camera" aria-label={t("Camera", "カメラ")}>
    <div className="rover-camera-heading"><h3>{t("Camera", "カメラ")}</h3><span role="status">{live ? t("LIVE", "ライブ映像") : t("Waiting", "待機中")}</span></div>
    <div className="rover-camera-preview">
      <canvas ref={canvas} width={320} height={240} hidden={!live} role="img" aria-label={t("Live rover camera", "ロボットのカメラ映像")} />
      {!live && <p>{state}</p>}
    </div>
    <details className="control-details"><summary>{t("Camera settings", "カメラ設定")}</summary>
      <div className="rover-camera-switch"><span>{t("Camera", "カメラ")}</span>
        <button type="button" aria-pressed={info?.enabled === true} disabled={busy || !info || info.enabled} onClick={() => void configure({action: "power", enabled: true})}>ON</button>
        <button type="button" aria-pressed={info?.enabled === false} disabled={busy || !info || !info.enabled} onClick={() => void configure({action: "power", enabled: false})}>OFF</button></div>
      <form onSubmit={event => {event.preventDefault(); void configure({action: "configure", url});}}>
        <label>{t("Camera address", "カメラのアドレス")}<input value={url} onChange={event => {initialized.current = true; setUrl(event.target.value);}} maxLength={1024} disabled={busy} placeholder="http://192.168.1.10:81/stream" /></label>
        <button type="submit" disabled={busy}>{t("Connect & save", "接続・保存")}</button>
      </form>
      {error && <p role="alert">{t("Could not save. Check the camera address.", "保存できません。カメラのアドレスを確認してください。")}</p>}
    </details>
  </section>;
}
