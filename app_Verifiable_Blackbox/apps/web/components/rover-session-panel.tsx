"use client";

import {useEffect, useRef, useState} from "react";
import {createWalletClient, custom, formatUnits, type Address} from "viem";
import {useDemoWallet} from "./wallet-context";
import {useLanguage} from "./language";
import {roverAccessMessage, roverAuthorizationMessage, roverHash, type RoverAccess, type RoverOptions,
  type RoverSessionRecord} from "@/lib/rover-session";
import type {ActiveRobotJob} from "@/lib/job-flow";
import "./rover-session.css";

const defaults = (): RoverOptions => ({judgmentMode: "VIDEO", operation: "FORWARD", durationMs: 3000, speed: 35});

export function RoverSessionPanel({job}: {job: ActiveRobotJob}) {
  const {t} = useLanguage();
  const {wallets, authenticated} = useDemoWallet();
  const wallet = wallets.find(w => w.address.toLowerCase() === job.wallet.toLowerCase());
  const [options, setOptions] = useState<RoverOptions>(defaults);
  const [settings, setSettings] = useState(false);
  const [record, setRecord] = useState<RoverSessionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const accessRef = useRef<{access: RoverAccess; signature: string} | undefined>(undefined);
  const signatureRef = useRef<string | undefined>(undefined);
  const allowed = authenticated && Boolean(wallet);
  const locked = busy || Boolean(record);

  function cancelHold() {clearTimeout(hold.current); hold.current = undefined;}
  function startHold() {
    cancelHold();
    if (!allowed || locked) return;
    hold.current = setTimeout(() => {setSettings(true); hold.current = undefined;}, 1200);
  }
  useEffect(() => {
    mounted.current = true;
    window.addEventListener("blur", cancelHold);
    document.addEventListener("visibilitychange", cancelHold);
    return () => {mounted.current = false; cancelHold(); window.removeEventListener("blur", cancelHold); document.removeEventListener("visibilitychange", cancelHold);};
  }, []);

  async function post(body: unknown, path = "/api/demo/rover/session") {
    const response = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
    const payload = await response.json();
    if (!response.ok) throw Error(payload.error || "SESSION_REQUEST_FAILED");
    return payload.record as RoverSessionRecord | null;
  }
  function accept(next: RoverSessionRecord | null) {
    if (next && (next.context.jobId !== job.jobId || next.context.chainId !== job.chainId
      || next.context.core.toLowerCase() !== job.core.toLowerCase()
      || next.context.client.toLowerCase() !== job.wallet.toLowerCase()
      || next.context.conditionsHash !== roverHash({options: next.context.options, camera: next.context.camera, policyHash: next.context.policyHash}))) throw Error("SESSION_CONTEXT_CHANGED");
    if (mounted.current) {setRecord(next); if (next) setOptions(next.context.options);}
  }
  async function act(action: "prepare" | "authorize" | "status") {
    if (!allowed || !wallet || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const signer = createWalletClient({account: wallet.address as Address, transport: custom(await wallet.getEthereumProvider())});
      if (action === "authorize") {
        if (!record || record.phase !== "PREPARED") throw Error("SESSION_NOT_PREPARED");
        const signature = signatureRef.current ?? await signer.signMessage({message: roverAuthorizationMessage(record.context)});
        signatureRef.current = signature;
        if (!mounted.current) return;
        accept(await post({action, jobId: job.jobId, sessionId: record.context.sessionId, signature}));
        setSettings(false);
      } else {
        let request = action === "prepare" ? accessRef.current : undefined;
        if (!request || request.access.issuedAt < Math.floor(Date.now() / 1000) - 240) {
          const access: RoverAccess = {action, chainId: job.chainId, core: job.core as Address, jobId: job.jobId,
            requestId: crypto.randomUUID(), issuedAt: Math.floor(Date.now() / 1000), ...(action === "prepare" ? {options} : {})};
          const signature = await signer.signMessage({message: roverAccessMessage(access)});
          request = {access, signature};
          if (action === "prepare") accessRef.current = request;
        }
        if (!mounted.current) return;
        const next = await post(action === "prepare" ? {action, ...request} : request,
          action === "status" ? "/api/demo/rover/session/status" : undefined);
        if (action === "prepare" && next && roverHash(next.context.options) !== roverHash(request.access.options)) throw Error("SESSION_CONTEXT_CHANGED");
        accept(next);
      }
    } catch (cause) {if (mounted.current) setError(cause instanceof Error ? cause.message : "SESSION_REQUEST_FAILED");}
    finally {inFlight.current = false; if (mounted.current) setBusy(false);}
  }
  function reset() {
    setRecord(null); setOptions(defaults()); setSettings(false); setError(undefined);
    accessRef.current = undefined; signatureRef.current = undefined;
  }
  const authorized = record?.phase === "AUTHORIZED";
  return <section className="panel rover-session-panel" aria-label={t("Rover session", "Rover実行セッション")}>
    <div className="rover-session-heading"><h2>{t("Plan this run", "今回の実行条件")}</h2>
      <button type="button" className="rover-session-settings" aria-label={t("Settings", "設定")} disabled={!allowed || locked}
        onPointerDown={event => {if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); startHold();}}
        onPointerUp={cancelHold} onPointerCancel={cancelHold} onLostPointerCapture={cancelHold} onBlur={cancelHold}
        onKeyDown={event => {if ([" ", "Enter"].includes(event.key)) {event.preventDefault(); if (!event.repeat) startHold();}}}
        onKeyUp={cancelHold} onContextMenu={event => event.preventDefault()}>⚙</button></div>
    <div className="rover-session-options">
      <label>{t("Action", "操作")}<select value={options.operation} disabled={locked} onChange={e => {accessRef.current = undefined; setOptions({...options, operation: e.target.value as RoverOptions["operation"]});}}>
        <option value="FORWARD">{t("Forward", "前進")}</option><option value="STILL">{t("Stationary", "静止")}</option></select></label>
      <label>{t("Duration (seconds)", "実行時間（秒）")}<input type="number" min="0.5" max="5" step="0.5" value={options.durationMs / 1000} disabled={locked}
        onChange={e => {accessRef.current = undefined; setOptions({...options, durationMs: Math.round(Number(e.target.value) * 1000)});}} /></label>
      <label>{t("Speed", "速度")}<input type="number" min="1" max="50" value={options.speed} disabled={locked}
        onChange={e => {accessRef.current = undefined; setOptions({...options, speed: Number(e.target.value)});}} /></label>
    </div>
    {settings && <fieldset className="rover-presenter-settings"><legend>{t("Presenter settings", "発表者用設定")}</legend>
      <label><input type="checkbox" checked={options.judgmentMode === "SKIP_VIDEO"} disabled={locked} onChange={e => {
        accessRef.current = undefined; setOptions({...options, judgmentMode: e.target.checked ? "SKIP_VIDEO" : "VIDEO"});
      }} />{t("Skip video recognition", "動画認識をスキップ")}</label>
      <p>{t("Applies to this session only. Payment requires successful drive commands and confirmed stop.", "今回のセッションだけに適用します。走行指令の成功と停止確認を条件に支払います。")}</p></fieldset>}
    {!record && <div className="actions"><button disabled={!allowed || busy} onClick={() => void act("prepare")}>{t("Review execution conditions", "実行条件を確認")}</button>
      <button disabled={!allowed || busy} onClick={() => void act("status")}>{t("Load saved session", "保存したセッションを確認")}</button></div>}
    {record && <>
      <p>{record.context.options.judgmentMode === "SKIP_VIDEO"
        ? t("Video recognition is skipped. Payment uses successful drive commands and confirmed stop.", "動画認識をスキップします。走行指令の成功と停止確認で支払います。")
        : t("Payment requires this session's video to show movement, successful drive commands, and confirmed stop.", "今回の動画の動作判定と走行指令の成功・停止確認を条件に支払います。")}</p>
      <p>{t("Reward", "報酬")}: {formatUnits(BigInt(record.context.budget), 6)} mUSDC · {t("Recipient", "受取先")}: <span className="rover-session-address">{record.context.provider}</span></p>
      {record.phase === "PREPARED" && <div className="actions"><button disabled={busy} onClick={() => void act("authorize")}>{t("Sign these conditions", "この条件で署名")}</button>
        <button disabled={busy} onClick={reset}>{t("Change conditions", "条件を変更")}</button>
        <button disabled={busy} onClick={() => void act("status")}>{t("Check saved state", "保存状態を確認")}</button></div>}
      {authorized && <p role="status">{t("Authorization saved. Driving has not started.", "承認を保存しました。走行は開始していません。")}</p>}
      {["EXPIRED", "SUPERSEDED"].includes(record.phase) && <button disabled={busy} onClick={reset}>{t("Prepare a new session", "新しいセッションを準備")}</button>}
      <details><summary>{t("Execution details", "実行詳細")}</summary><dl>
        <dt>{t("Session", "セッション")}</dt><dd>{record.context.sessionId}</dd><dt>{t("Status", "状態")}</dt><dd>{record.phase}</dd>
        <dt>{t("Video recognition", "動画認識")}</dt><dd>{record.context.options.judgmentMode === "SKIP_VIDEO" ? t("Skipped", "スキップ") : t("Enabled", "使用")}</dd>
        <dt>{t("Authorization expires", "承認期限")}</dt><dd>{new Date(record.context.expiresAt * 1000).toLocaleString()}</dd>
      </dl></details>
    </>}
    {busy && <p role="status">{t("Confirm the request in your wallet…", "ウォレットで内容を確認してください…")}</p>}
    {error && <p role="alert">{t("Could not complete the request. Check the saved session before retrying.", "処理を完了できませんでした。保存したセッションを確認してから再試行してください。")}
      {/^\w+$/.test(error) && <span className="rover-session-error">{error}</span>}</p>}
  </section>;
}
