"use client";
import {useEffect, useRef, useState} from "react";
import {formatUnits} from "viem";
import type {ActiveRobotJob} from "@/lib/job-flow";
import type {RoverSessionRecord} from "@/lib/rover-session";
import {useDemoWallet} from "./wallet-context";
import {useLanguage} from "./language";
import {WorldDisclosure} from "./world-disclosure";
import {JobProgress} from "./job-progress";
import {RoverRecordingPanel} from "./rover-recording-panel";
import "./rover-session.css";

export function RoverButtonPanel({job}: {job: ActiveRobotJob}) {
  const {t} = useLanguage();
  const {getAccessToken} = useDemoWallet();
  const [record, setRecord] = useState<RoverSessionRecord | null>(null);
  const [preparing, setPreparing] = useState(true), [starting, setStarting] = useState(false);
  const [paying, setPaying] = useState(false), [analyzing, setAnalyzing] = useState(false);
  const [settings, setSettings] = useState(false), [skip, setSkip] = useState(false);
  const [error, setError] = useState<string>();
  const current = useRef(record), mounted = useRef(false), held = useRef(false), sent = useRef(false), startingRef = useRef(false);
  const sequence = useRef(0), queue = useRef(Promise.resolve()), heartbeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const settingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), finalized = useRef<string | undefined>(undefined);
  function accept(value: RoverSessionRecord) {
    if (value.context.jobId !== job.jobId || value.context.client.toLowerCase() !== job.wallet.toLowerCase()) throw Error("JOB_CONTEXT_MISMATCH");
    current.current = value;
    if (mounted.current) {setRecord(value); setSkip(value.context.options.judgmentMode === "SKIP_VIDEO");}
  }
  const body = (value = current.current) => ({jobId: job.jobId, sessionId: value?.context.sessionId, signature: value?.controlToken});
  async function post(path: string, data: unknown, headers: Record<string,string> = {}) {
    const response = await fetch(`/api/demo/rover/${path}`, {method: "POST", headers: {"Content-Type": "application/json", ...headers},
      body: JSON.stringify(data), signal: AbortSignal.timeout(path === "complete" ? 90000 : path === "session/analyze" ? 35000 : 15000)});
    const payload = await response.json();
    if (!response.ok) throw Error(payload.error || "REQUEST_FAILED");
    return payload.record as RoverSessionRecord;
  }
  async function prepare(skipVideo = skip) {
    setPreparing(true); setError(undefined);
    try {
      const token = await getAccessToken();
      const next = await post("session/direct", {jobId: job.jobId, skipVideo}, token ? {Authorization: `Bearer ${token}`} : {});
      if (mounted.current) accept(next);
    } catch (cause) {if (mounted.current) setError(cause instanceof Error ? cause.message : "LOGIN_CHECK_UNAVAILABLE");}
    finally {if (mounted.current) setPreparing(false);}
  }
  function input(action: "press" | "hold" | "release" | "finish") {
    const request = {...body(), action, sequence: ++sequence.current};
    queue.current = queue.current.then(async () => {
      if (action === "hold" && !held.current) return;
      await post("session/input", request);
    }).catch(() => {held.current = false; clearInterval(heartbeat.current); if (mounted.current) setError("INPUT_NOT_ACCEPTED");});
  }
  function release() {
    if (!held.current) return;
    held.current = false; clearInterval(heartbeat.current);
    if (sent.current) input("release");
  }
  function control(next: RoverSessionRecord) {
    accept(next);
    if (next.phase === "OPERATING" && startingRef.current && !sent.current) {
      sent.current = true;
      // A release during connection must never cause delayed movement.
      input(held.current ? "press" : "finish");
      if (held.current) heartbeat.current = setInterval(() => input("hold"), 150);
    }
    if (["CAPTURED", "ERROR"].includes(next.phase)) {
      held.current = false; startingRef.current = false; clearInterval(heartbeat.current); setStarting(false);
    }
  }
  async function press() {
    if (!current.current || current.current.phase !== "AUTHORIZED" || preparing || startingRef.current) return;
    held.current = true; sent.current = false; startingRef.current = true; setStarting(true); setError(undefined);
    try {control(await post("session/start", {...body(), action: "start"}));}
    catch (cause) {
      held.current = false; startingRef.current = false; setStarting(false);
      setError(cause instanceof Error ? cause.message : "START_FAILED");
      try {accept(await post("session/status", body()));} catch { /* Retry restores the same session. */ }
    }
  }
  async function stop() {
    held.current = false; clearInterval(heartbeat.current);
    try {control(await post("session/start", {...body(), action: "stop"}));} catch {setError("STOP_REQUEST_FAILED");}
  }
  useEffect(() => {
    mounted.current = true; void prepare(false);
    const blur = () => release();
    const visibility = () => {if (document.hidden) release();};
    window.addEventListener("blur", blur); document.addEventListener("visibilitychange", visibility);
    return () => {
      release(); mounted.current = false; clearInterval(heartbeat.current); clearTimeout(settingTimer.current);
      window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", visibility);
    };
    // The parent keys this component by the wallet and Job creation transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const running = Boolean(record && ["STARTING", "RECORDING", "OPERATING", "STOPPING"].includes(record.phase));
  const terminal = Boolean(record && ["CAPTURED", "ERROR"].includes(record.phase));
  useEffect(() => {
    if (!running) return;
    let cancelled = false, polling = false;
    const timer = setInterval(async () => {
      if (polling) return; polling = true;
      try {const next = await post("session/status", body()); if (!cancelled) control(next);}
      catch {if (!cancelled) setError("STATUS_UNAVAILABLE");}
      finally {polling = false;}
    }, 150);
    return () => {cancelled = true; clearInterval(timer);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, record?.context.sessionId]);
  async function finish() {
    const value = current.current;
    if (!value) return;
    const input = body(value);
    const submit = async (path: string) => {
      for (let attempt = 0; ; attempt++) {
        try {return await post(path, input);}
        catch (cause) {
          if (!(cause instanceof Error) || cause.message !== "SESSION_BUSY" || attempt >= 7) throw cause;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    };
    const tasks: Promise<unknown>[] = [];
    if (value.buttonAuthorization?.pressedAt && value.payment?.phase !== "PAID") {
      setPaying(true);
      tasks.push(submit("complete").then(next => {if (mounted.current) accept({...next, analysis: current.current?.analysis ?? next.analysis});})
        .catch(cause => {if (mounted.current) setError(cause.message);}).finally(() => {if (mounted.current) setPaying(false);}));
    }
    if (!value.analysis) {setAnalyzing(true); tasks.push(post("session/analyze", input)
      .then(next => {if (mounted.current && current.current) accept({...current.current, analysis: next.analysis});}).catch(() => undefined));}
    await Promise.allSettled(tasks);
    try {
      let next = await post("session/status", input);
      if (!next.analysis) {await post("session/analyze", input); next = await post("session/status", input);}
      if (mounted.current) accept(next);
    } catch {if (mounted.current) setError("RESULT_CHECK_REQUIRED");}
    finally {if (mounted.current) setAnalyzing(false);}
  }
  useEffect(() => {
    if (!terminal || !record || finalized.current === record.context.sessionId) return;
    finalized.current = record.context.sessionId; void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal, record?.context.sessionId]);
  const pressed = Boolean(record?.buttonAuthorization?.pressedAt);
  function openSettings() {clearTimeout(settingTimer.current); settingTimer.current = setTimeout(() => setSettings(true), 1200);}
  function cancelSettings() {clearTimeout(settingTimer.current);}
  return <section className="panel rover-session-panel">
    <JobProgress created operated={pressed} verified={Boolean(record?.payment?.verification)} paid={record?.payment?.phase === "PAID"} operating={running} />
    <div className="rover-session-heading"><h2>{t("Drive the Rover", "Roverを動かす")}</h2>
      <button aria-label={t("Settings", "設定")} disabled={starting || running || terminal || preparing}
        onPointerDown={openSettings} onPointerUp={cancelSettings} onPointerCancel={cancelSettings} onPointerLeave={cancelSettings} onBlur={cancelSettings}
        onKeyDown={event => {if ([" ", "Enter"].includes(event.key)) {event.preventDefault(); if (!event.repeat) openSettings();}}} onKeyUp={cancelSettings}>⚙</button></div>
    <p>{t("Hold to move forward. Release to stop. A short press is enough.", "押している間だけ前進します。離すと停止します。短く押すだけで大丈夫です。")}</p>
    <button className="rover-forward-button" aria-label={t("Forward", "前へ")} disabled={preparing || terminal || !record || (record.phase !== "AUTHORIZED" && !starting)}
      onPointerDown={event => {if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); void press();}}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
      onKeyDown={event => {if ([" ", "Enter"].includes(event.key)) {event.preventDefault(); if (!event.repeat) void press();}}}
      onKeyUp={event => {if ([" ", "Enter"].includes(event.key)) release();}}>▲ {t("Forward", "前へ")}</button>
    <p role="status">{preparing ? t("Preparing controls…", "操作を準備しています…") : running || starting ? record?.phase === "OPERATING"
      ? t("Release to stop", "離すと停止します") : t("Connecting… Release to cancel movement.", "接続中です。離すと前進を取り消します。")
      : terminal ? t("Operation recorded", "操作を記録しました") : t("Ready to drive", "前ボタンで操作できます")}</p>
    <p>{t("Pressing Forward releases this Job's reward once. Video recognition is for reference and does not block payment.", "前ボタンを押した記録で、このJobの報酬を1回支払います。動画判定は参考結果として表示します。")}</p>
    {(running || starting) && <button onClick={() => void stop()}>{t("Emergency stop", "緊急停止")}</button>}
    {settings && !terminal && <label className="rover-presenter-settings"><input type="checkbox" checked={skip} disabled={preparing || starting || running}
      onChange={event => {setSkip(event.target.checked); void prepare(event.target.checked);}} />{t("Skip video recognition", "動画認識をスキップ")}</label>}
    {record && terminal && <RoverRecordingPanel record={record} />}
    {record && terminal && <WorldDisclosure key={record.context.sessionId} jobId={record.context.jobId} sessionId={record.context.sessionId} />}
    {record?.error && <p role="status">{t("The robot connection or control reported an error. The button record is saved.", "機体の接続・操作でエラーが発生しました。ボタンの記録は保存しています。")}: {record.error}</p>}
    {paying && <p role="status">{t("Processing payment…", "支払い処理中です…")}</p>}
    {analyzing && <p role="status">{t("Analyzing the Raw recording…", "Raw動画を解析しています…")}</p>}
    {record?.payment?.phase === "PAID" && <section aria-label={t("Payment receipt", "支払い領収書")}><h3>{t("Payment completed", "支払い完了")}</h3>
      <p>{formatUnits(BigInt(record.context.budget),6)} mUSDC</p><p className="rover-session-address">Receipt: {record.payment.receiptId}</p>
      {job.chainId === 11155111 && record.payment.completeTransactionHash && <a href={`https://sepolia.etherscan.io/tx/${record.payment.completeTransactionHash}`} target="_blank" rel="noreferrer">{t("View transaction", "取引を確認")}</a>}</section>}
    {error && <div role="alert" className="rover-session-alert"><p>{["LOGIN_REQUIRED", "JOB_OWNER_REQUIRED"].includes(error)
      ? t("Sign in with the wallet that created this Job.", "このJobを作成したウォレットでログインしてください。")
      : t("Could not complete the request. You can check the saved result or retry.", "処理を完了できませんでした。保存した結果を確認・再試行できます。")}</p><small>{error}</small>
      <button disabled={preparing || paying || analyzing || running} onClick={() => {setError(undefined); void (terminal ? finish() : prepare());}}>{t("Retry", "再試行")}</button></div>}
  </section>;
}
