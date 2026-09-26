"use client";

import {useEffect, useRef, useState} from "react";
import {createWalletClient, custom, formatUnits, type Address} from "viem";
import {useDemoWallet} from "./wallet-context";
import {useLanguage} from "./language";
import {roverAccessMessage, roverAuthorizationMessage, roverHash, roverOperationRecordHash,
  roverSkipAuthorizationMessage, roverSkipUnavailableReason, type RoverAccess, type RoverOptions,
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
  const [skipAfterStop, setSkipAfterStop] = useState(false);
  const [record, setRecord] = useState<RoverSessionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const accessRef = useRef<{access: RoverAccess; signature: string} | undefined>(undefined);
  const signatureRef = useRef<string | undefined>(undefined);
  const inputSequence = useRef(0);
  const driveTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const driveHeld = useRef(false);
  const inputChain = useRef<Promise<void>>(Promise.resolve());
  const allowed = authenticated && Boolean(wallet);
  const locked = busy || Boolean(record);
  const stopped = Boolean(record?.run?.stop?.confirmed && ["CAPTURED", "ERROR"].includes(record.phase));
  const postRunSettings = stopped && record?.context.options.judgmentMode === "VIDEO";
  const settingsLocked = busy || (Boolean(record) && !postRunSettings);
  const skipUnavailable = record ? roverSkipUnavailableReason(record) : null;
  const skipSaved = Boolean(record?.skipApproval?.signature);

  function cancelHold() {clearTimeout(hold.current); hold.current = undefined;}
  function startHold() {
    cancelHold();
    if (!allowed || settingsLocked) return;
    hold.current = setTimeout(() => {setSkipAfterStop(skipSaved); setSettings(true); hold.current = undefined;}, 1200);
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
      || next.context.conditionsHash !== roverHash({options: next.context.options, camera: next.context.camera, cameraUrl: next.context.cameraUrl, policyHash: next.context.policyHash}))) throw Error("SESSION_CONTEXT_CHANGED");
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
    setRecord(null); setOptions(defaults()); setSettings(false); setSkipAfterStop(false); setError(undefined);
    accessRef.current = undefined; signatureRef.current = undefined;
  }
  async function approveSkip() {
    if (!allowed || !wallet || !record?.authorizationSignature || !skipAfterStop || skipUnavailable || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const prepared = await post({action: "prepare-skip", jobId: job.jobId, sessionId: record.context.sessionId,
        signature: record.authorizationSignature});
      accept(prepared);
      if (!mounted.current) return;
      const context = prepared?.skipApproval?.context;
      if (!context || context.sessionId !== record.context.sessionId || context.sessionContextHash !== roverHash(record.context)
        || context.operationRecordHash !== roverOperationRecordHash(record.run!) || context.jobId !== job.jobId
        || context.chainId !== job.chainId || context.core.toLowerCase() !== job.core.toLowerCase()
        || context.client.toLowerCase() !== job.wallet.toLowerCase() || context.provider !== record.context.provider
        || context.budget !== record.context.budget || context.purpose !== "SKIP_VIDEO_AFTER_STOP"
        || context.expiresAt <= Math.floor(Date.now() / 1000) || context.expiresAt > record.context.expiresAt) throw Error("SKIP_APPROVAL_CONTEXT_CHANGED");
      const signer = createWalletClient({account: wallet.address as Address, transport: custom(await wallet.getEthereumProvider())});
      const signature = await signer.signMessage({message: roverSkipAuthorizationMessage(context)});
      if (!mounted.current) return;
      accept(await post({action: "authorize-skip", jobId: job.jobId, sessionId: record.context.sessionId, signature}));
    } catch (cause) {if (mounted.current) setError(cause instanceof Error ? cause.message : "SKIP_APPROVAL_FAILED");}
    finally {inFlight.current = false; if (mounted.current) setBusy(false);}
  }
  function sendInput(action: "press" | "hold" | "release" | "finish") {
    if (!record?.authorizationSignature) return;
    const body = {action, sequence: ++inputSequence.current, jobId: job.jobId,
      sessionId: record.context.sessionId, signature: record.authorizationSignature};
    inputChain.current = inputChain.current.then(async () => {
      if (action === "hold" && !driveHeld.current) return;
      await post(body, "/api/demo/rover/session/input");
    }).catch(() => {
      driveHeld.current = false; clearInterval(driveTimer.current);
      if (mounted.current) setError("INPUT_NOT_ACCEPTED");
    });
  }
  function releaseForward() {
    if (!driveHeld.current) return;
    driveHeld.current = false; clearInterval(driveTimer.current); sendInput("release");
  }
  function pressForward() {
    if (!allowed || record?.phase !== "OPERATING" || driveHeld.current) return;
    driveHeld.current = true; sendInput("press");
    driveTimer.current = setInterval(() => sendInput("hold"), 150);
  }
  useEffect(() => {
    const release = () => releaseForward();
    const hidden = () => {if (document.hidden) release();};
    window.addEventListener("blur", release); document.addEventListener("visibilitychange", hidden);
    return () => {release(); clearInterval(driveTimer.current); window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", hidden);};
    // Each phase change releases held input; Bridge also enforces a heartbeat deadline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.context.sessionId, record?.phase]);
  async function runAction(action: "start" | "stop") {
    if (!record?.authorizationSignature || (inFlight.current && action !== "stop")) return;
    if (action === "start") inFlight.current = true;
    setBusy(true); setError(undefined);
    try {
      accept(await post({action, jobId: job.jobId, sessionId: record.context.sessionId,
        signature: record.authorizationSignature}, "/api/demo/rover/session/start"));
    } catch (cause) {if (mounted.current) setError(cause instanceof Error ? cause.message : "RUN_REQUEST_FAILED");}
    finally {if (action === "start") inFlight.current = false; if (mounted.current) setBusy(false);}
  }
  useEffect(() => {
    if (!record?.authorizationSignature || !["STARTING", "RECORDING", "OPERATING", "STOPPING"].includes(record.phase)) return;
    let cancelled = false, polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await post({jobId: job.jobId, sessionId: record.context.sessionId, signature: record.authorizationSignature}, "/api/demo/rover/session/status");
        if (!cancelled) accept(next);
      } catch {if (!cancelled) setError("RUN_STATUS_UNAVAILABLE");}
      finally {polling = false;}
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {cancelled = true; clearInterval(timer);};
    // The component is keyed by wallet and Job creation transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.context.sessionId, record?.phase, record?.authorizationSignature, job.jobId]);
  const authorized = record?.phase === "AUTHORIZED";
  const running = Boolean(record && ["STARTING", "RECORDING", "OPERATING", "STOPPING"].includes(record.phase));
  return <section className="panel rover-session-panel" aria-label={t("Rover session", "Rover実行セッション")}>
    <div className="rover-session-heading"><h2>{t("Plan this run", "今回の実行条件")}</h2>
      <button type="button" className="rover-session-settings" aria-label={t("Settings", "設定")} disabled={!allowed || settingsLocked}
        onPointerDown={event => {if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); startHold();}}
        onPointerUp={cancelHold} onPointerCancel={cancelHold} onLostPointerCapture={cancelHold} onBlur={cancelHold}
        onKeyDown={event => {if ([" ", "Enter"].includes(event.key)) {event.preventDefault(); if (!event.repeat) startHold();}}}
        onKeyUp={cancelHold} onContextMenu={event => event.preventDefault()}>⚙</button></div>
    <div className="rover-session-options">
      <label>{t("Maximum drive time (seconds)", "走行上限（秒）")}<input type="number" min="0.5" max="3" step="0.5" value={options.durationMs / 1000} disabled={locked}
        onChange={e => {accessRef.current = undefined; setOptions({...options, durationMs: Math.round(Number(e.target.value) * 1000)});}} /></label>
      <label>{t("Speed", "速度")}<input type="number" min="1" max="50" value={options.speed} disabled={locked}
        onChange={e => {accessRef.current = undefined; setOptions({...options, speed: Number(e.target.value)});}} /></label>
    </div>
    {settings && <fieldset className="rover-presenter-settings"><legend>{t("Presenter settings", "発表者用設定")}</legend>
      <label><input type="checkbox" checked={postRunSettings ? skipAfterStop || skipSaved : options.judgmentMode === "SKIP_VIDEO"}
        disabled={!allowed || settingsLocked || skipSaved || (postRunSettings && Boolean(skipUnavailable))} onChange={e => {
        if (postRunSettings) setSkipAfterStop(e.target.checked);
        else {accessRef.current = undefined; setOptions({...options, judgmentMode: e.target.checked ? "SKIP_VIDEO" : "VIDEO"});}
      }} />{t("Skip video recognition", "動画認識をスキップ")}</label>
      <p>{t("Applies to this session only. Payment requires a forward button record, successful drive commands and confirmed stop.", "今回のセッションだけに適用します。前ボタンの記録・前進送信成功・停止確認を条件に支払います。")}</p>
      {postRunSettings && <>
        <p>{t("Approve the saved operation record without driving again. The video result is preserved.", "保存済みの操作記録へ追加承認します。再走行せず、動画判定の結果を保持します。")}</p>
        {skipUnavailable && <p role="status">{t("The required forward button, drive or stop record is not confirmed.", "必要な前ボタン・前進送信・停止の記録が確認できていません。")}</p>}
        {!skipSaved && <button disabled={busy || !allowed || !skipAfterStop || Boolean(skipUnavailable)} onClick={() => void approveSkip()}>
          {t("Sign video skip approval", "動画認識スキップを追加署名")}</button>}
      </>}
    </fieldset>}
    {!record && <div className="actions"><button disabled={!allowed || busy} onClick={() => void act("prepare")}>{t("Review execution conditions", "実行条件を確認")}</button>
      <button disabled={!allowed || busy} onClick={() => void act("status")}>{t("Load saved session", "保存したセッションを確認")}</button></div>}
    {record && <>
      <p>{record.context.options.judgmentMode === "SKIP_VIDEO" || skipSaved
        ? t("Video recognition is skipped. Payment uses successful drive commands and confirmed stop.", "動画認識をスキップします。走行指令の成功と停止確認で支払います。")
        : t("Payment requires this session's video to show movement, successful drive commands, and confirmed stop.", "今回の動画の動作判定と走行指令の成功・停止確認を条件に支払います。")}</p>
      <p>{t("Reward", "報酬")}: {formatUnits(BigInt(record.context.budget), 6)} mUSDC · {t("Recipient", "受取先")}: <span className="rover-session-address">{record.context.provider}</span></p>
      {record.phase === "PREPARED" && <div className="actions"><button disabled={busy} onClick={() => void act("authorize")}>{t("Sign these conditions", "この条件で署名")}</button>
        <button disabled={busy} onClick={reset}>{t("Change conditions", "条件を変更")}</button>
        <button disabled={busy} onClick={() => void act("status")}>{t("Check saved state", "保存状態を確認")}</button></div>}
      {authorized && <p role="status">{t("Authorization saved. Driving has not started.", "承認を保存しました。走行は開始していません。")}</p>}
      {(authorized || record.phase === "STARTING") && <button disabled={busy} onClick={() => void runAction("start")}>{record.phase === "STARTING"
        ? t("Check start request", "開始要求を確認") : t("Start observation", "記録を開始")}</button>}
      {record.phase === "OPERATING" && <div className="actions">
        <p>{t("Hold Forward to drive. Release to stop, or finish without pressing.", "前ボタンを押している間だけ走行します。離すと停止します。押さずに記録を終了することもできます。")}</p>
        <button style={{touchAction: "none"}} onPointerDown={e => {if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); pressForward();}}
          onPointerUp={releaseForward} onPointerCancel={releaseForward} onLostPointerCapture={releaseForward} onBlur={releaseForward}
          onKeyDown={e => {if ([" ", "Enter"].includes(e.key)) {e.preventDefault(); if (!e.repeat) pressForward();}}}
          onKeyUp={e => {if ([" ", "Enter"].includes(e.key)) releaseForward();}}>{t("Hold Forward", "前（押している間）")}</button>
        <button onClick={() => {if (driveHeld.current) releaseForward(); else sendInput("finish");}}>{t("Finish observation", "記録を終了")}</button>
      </div>}
      {running && <><p role="status">{t("Run in progress", "実行中")}: {record.phase}</p><button onClick={() => void runAction("stop")}>{t("Emergency stop", "緊急停止")}</button></>}
      {record.phase === "CAPTURED" && <p role="status">{t("Operation records saved. Stop confirmed.", "操作記録を保存しました。停止を確認しました。")}</p>}
      {skipSaved && <p role="status">{t("Video skip approval saved for this operation record. Payment is not completed by this approval alone.", "この操作記録への動画認識スキップ承認を保存しました。この承認だけでは支払いは完了しません。")}</p>}
      {record.phase === "ERROR" && <p role="alert">{t("The run stopped. Check the robot before starting another session.", "実行を停止しました。次のセッションを始める前に機体を確認してください。")}</p>}
      {["EXPIRED", "SUPERSEDED", "ERROR"].includes(record.phase) && <button disabled={busy} onClick={reset}>{t("Prepare a new session", "新しいセッションを準備")}</button>}
      <details><summary>{t("Execution details", "実行詳細")}</summary><dl>
        <dt>{t("Session", "セッション")}</dt><dd>{record.context.sessionId}</dd><dt>{t("Status", "状態")}</dt><dd>{record.phase}</dd>
        <dt>{t("Video recognition", "動画認識")}</dt><dd>{record.context.options.judgmentMode === "SKIP_VIDEO" || skipSaved ? t("Skipped", "スキップ") : t("Enabled", "使用")}</dd>
        {skipSaved && <><dt>{t("Additional approval expires", "追加承認期限")}</dt><dd>{new Date(record.skipApproval!.context.expiresAt * 1000).toLocaleString()}</dd></>}
        <dt>{t("Authorization expires", "承認期限")}</dt><dd>{new Date(record.context.expiresAt * 1000).toLocaleString()}</dd>
        {record.run && <><dt>{t("Commands recorded", "指令の記録数")}</dt><dd>{record.run.commands.length}</dd>
          <dt>{t("Recording", "録画")}</dt><dd>{record.run.recording.state} · {record.run.recording.frames.length} frames</dd></>}
        {record.error && <><dt>{t("Run result", "実行結果")}</dt><dd>{record.error}</dd></>}
      </dl></details>
    </>}
    {busy && <p role="status">{t("Confirm the request in your wallet…", "ウォレットで内容を確認してください…")}</p>}
    {error && <p role="alert">{t("Could not complete the request. Check the saved session before retrying.", "処理を完了できませんでした。保存したセッションを確認してから再試行してください。")}
      {/^\w+$/.test(error) && <span className="rover-session-error">{error}</span>}</p>}
  </section>;
}
