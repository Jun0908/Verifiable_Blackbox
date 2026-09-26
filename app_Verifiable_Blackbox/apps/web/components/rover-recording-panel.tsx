"use client";
import Image from "next/image";
import {useEffect, useState} from "react";
import type {RoverSessionRecord} from "@/lib/rover-session";
import {useLanguage} from "./language";

export function RoverRecordingPanel({record}: {record: RoverSessionRecord}) {
  const {t} = useLanguage();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState<{url: string; index: number} | null>(null);
  const [failed, setFailed] = useState(false);
  const count = record.run?.recording.frames.length ?? 0;
  const ready = ["CAPTURED", "ERROR"].includes(record.phase);
  const credential = record.controlToken ?? record.authorizationSignature;
  useEffect(() => {
    if (!ready || !count || !credential) return;
    const controller = new AbortController();
    let url: string | undefined;
    setFailed(false);
    void fetch("/api/demo/rover/session/frame", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({jobId: record.context.jobId, sessionId: record.context.sessionId, signature: credential, index}),
      signal: controller.signal}).then(async response => {
      if (!response.ok) throw Error("FRAME_UNAVAILABLE");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setFrame({url, index});
    }).catch(() => {if (!controller.signal.aborted) {setFailed(true); setPlaying(false);}});
    return () => {controller.abort(); if (url) URL.revokeObjectURL(url);};
  }, [ready, count, index, credential, record.context.jobId, record.context.sessionId]);
  useEffect(() => {
    if (!playing || failed || frame?.index !== index) return;
    const timer = setTimeout(() => {if (index + 1 < count) setIndex(index + 1); else setPlaying(false);}, 100);
    return () => clearTimeout(timer);
  }, [playing, failed, frame, index, count]);
  const pressed = record.buttonAuthorization ? Boolean(record.buttonAuthorization.pressedAt) : record.run?.forwardPressed;
  const video = record.analysis;
  return <section className="rover-recording" aria-label={t("Operation and video result", "操作と動画判定")}>
    <h3>{t("Operation and video result", "操作と動画判定")}</h3>
    <dl>
      <dt>{t("Forward button", "前ボタン")}</dt><dd>{pressed === true ? t("Pressed", "押した") : pressed === false ? t("Not pressed", "押していない") : t("Not confirmed", "未確定")}</dd>
      <dt>{t("Video result", "動画判定")}</dt><dd>{!video ? t("Awaiting analysis", "判定待ち") : video.judgment === "MOVING" ? t("Moved", "動いた")
        : video.judgment === "STILL" ? t("Did not move", "動いていない") : t("Unable to determine", "判定できていない")}</dd>
      {video && <><dt>{t("Analysis", "解析")}</dt><dd>{video.execution === "SKIPPED" ? t("Skipped", "スキップ・未実行") : video.execution === "UNAVAILABLE"
        ? t("No analysis response", "解析結果を取得できていません") : t("Raw recording analyzed by StegaVAR", "今回のRaw動画をStegaVARで解析")}</dd></>}
    </dl>
    {ready && count > 0 ? <>
      {frame && !failed && <Image src={frame.url} width={384} height={216} unoptimized alt={t("This session's Raw recording", "今回のRaw録画")} style={{width: "100%", height: "auto"}} />}
      {failed && <p role="status">{t("Recording frame unavailable", "録画のフレームを取得できません")}</p>}
      <label>{t("Recording frame", "録画フレーム")} {index + 1} / {count}<input type="range" min={0} max={count - 1} value={index}
        onChange={event => {setPlaying(false); setIndex(Number(event.target.value));}} style={{width: "100%"}} /></label>
      <button type="button" disabled={failed} onClick={() => {if (index === count - 1) setIndex(0); setPlaying(!playing);}}>{playing ? t("Pause recording", "録画を一時停止") : t("Play recording", "録画を再生")}</button>
    </> : <p>{ready ? t("No recording available for this session", "今回の録画はありません") : t("Recording in progress", "記録中")}</p>}
    {video?.reason && <details><summary>{t("Analysis details", "解析の詳細")}</summary><p>{video.reason}</p></details>}
  </section>;
}
