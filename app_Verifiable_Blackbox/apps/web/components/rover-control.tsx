"use client";

import {useCallback, useEffect, useRef, useState, type RefObject} from "react";
import {useLanguage} from "./language";
import {canLeaveWithoutStop} from "@/lib/rover-exit";
import {RoverCamera} from "./rover-camera";

type BridgeStatus = {simulated?:boolean;state: string; message: string; session?: string; telemetryFresh: boolean; controlPaused?: boolean; motorsRunning: boolean | null; motors: number[] | null; rssi: number | null};
const endpoint = "/api/demo/rover/control";
const directions = [
  ["turn-left", "↶", "Turn left", "左回転"], ["forward", "↑", "Forward", "前進"], ["turn-right", "↷", "Turn right", "右回転"],
  ["left", "←", "Left", "左"], ["stop", "■", "Stop", "停止"], ["right", "→", "Right", "右"], ["back", "↓", "Reverse", "後退"],
] as const;

async function command(body: unknown, keepalive = false): Promise<BridgeStatus> {
  const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body), keepalive, signal:AbortSignal.timeout(15000)});
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Control bridge unavailable. Restart the web launcher.");
  return data;
}

export function RoverControl({onFinished, exitRef, onForwardPressed, onConnected, returnToStep3 = false}: {onFinished: (operated: boolean) => void; exitRef: RefObject<(() => Promise<void>) | null>; onForwardPressed?: () => void; onConnected?: () => void; returnToStep3?: boolean}) {
  const {t} = useLanguage();
  const [status, setStatus] = useState<BridgeStatus>();
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [exitUnconfirmed, setExitUnconfirmed] = useState(false);
  const operated = useRef(false);
  const [speed, setSpeed] = useState(35);
  const [direction, setDirection] = useState<string>();
  const session = useRef<string | undefined>(undefined);
  const held = useRef<string | undefined>(undefined);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const stopEpoch = useRef(0);

  const stop = useCallback(() => {
    stopEpoch.current++;
    held.current = undefined;
    if (mounted.current) setDirection(undefined);
    if (session.current) void command({action: "stop", session: session.current}, true).catch(() => {
      if (mounted.current) setError("Stop could not be confirmed. Check the robot.");
    });
  }, []);

  const release = useCallback(() => {
    if (!held.current) return;
    held.current = undefined;
    setDirection(undefined);
    if (session.current) void command({action: "release", session: session.current, sequence: ++sequence.current}, true).catch(() => stop());
  }, [stop]);

  useEffect(() => {
    mounted.current = true;
    const hidden = () => {if (document.hidden) release();};
    window.addEventListener("blur", release);
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false; stop();
      window.removeEventListener("blur", release);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [release, stop]);

  useEffect(() => {
    let cancelled = false, polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(endpoint, {cache: "no-store"});
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        if (cancelled) return;
        setStatus(data);
        if (data.controlPaused && held.current) release();
        if (!["ready", "commanding"].includes(data.state)) {held.current = undefined; setDirection(undefined);}
      } catch {
        if (!cancelled) {setError("Control bridge unavailable. Restart the web launcher."); stop();}
      } finally {polling = false;}
    };
    void poll();
    const timer = setInterval(() => void poll(), 300);
    return () => {cancelled = true; clearInterval(timer);};
  }, [release, stop]);

  const active = connecting || ["connecting", "ready", "commanding", "stopping"].includes(status?.state ?? "");
  const canDrive = !returning && Boolean(session.current) && Boolean(status?.telemetryFresh) && ["ready", "commanding"].includes(status?.state ?? "");
  const sendDrive = useCallback(() => {
    if (!held.current || !session.current || inFlight.current) return;
    inFlight.current = true;
    const requestSequence = ++sequence.current;
    const input = held.current;
    const body = input.startsWith("grip-")
      ? {action: "gripper", session: session.current, sequence: requestSequence, gripperAction: input.slice(5)}
      : {action: "drive", session: session.current, sequence: requestSequence, direction: input, speed};
    void command(body)
      .then(() => {
        if (!input.startsWith("grip-")) operated.current = true;
        // Opening is one click; the bridge waits for the device acknowledgement.
        if (input === "grip-open" && held.current === input && requestSequence === sequence.current) {
          held.current = undefined;
          if (mounted.current) setDirection(undefined);
        }
      })
      .catch(e => {if (held.current && requestSequence === sequence.current) {if (mounted.current) setError(e.message); release();}})
      .finally(() => {inFlight.current = false;});
  }, [speed, release]);
  useEffect(() => {const timer = setInterval(sendDrive, 120); return () => clearInterval(timer);}, [sendDrive]);

  async function connect() {
    setConnecting(true); setError(""); setExitUnconfirmed(false);
    const epoch = stopEpoch.current;
    try {
      const data = await command({action: "activate"});
      session.current = data.session; sequence.current = 0;
      if (!mounted.current || document.hidden || epoch !== stopEpoch.current) {stop(); return;}
      setStatus(data);
      onConnected?.();
    } catch (e) {if (mounted.current) setError(e instanceof Error ? e.message : "Cannot connect. Check the robot power and Wi-Fi.");}
    finally {if (mounted.current) setConnecting(false);}
  }
  const finish = useCallback(async () => {
    if (returning) return;
    if (connecting || canLeaveWithoutStop(session.current, status?.state)) {
      if (session.current) stop();
      stopEpoch.current++;
      held.current = undefined;
      session.current = undefined;
      onFinished(!connecting && status?.state === "idle" && operated.current);
      return;
    }
    setReturning(true); setError(""); stop();
    try {
      if (session.current) {
        await command({action:"stop", session:session.current}, true);
        let stopped = false;
        for (let attempt=0; attempt<30; attempt++) {
          const response = await fetch(endpoint, {cache:"no-store", signal:AbortSignal.timeout(1500)});
          if (!response.ok) throw Error("Stop could not be confirmed. Check the robot.");
          const next = await response.json();
          if (next.state === "idle") {stopped = true; break;}
          if (next.state === "error" || next.state === "offline") break;
          await new Promise(resolve => setTimeout(resolve,100));
        }
        if (!stopped) throw Error("Stop could not be confirmed. Check the robot.");
      }
      onFinished(operated.current);
    } catch {setError("Stop could not be confirmed. Check the robot."); setExitUnconfirmed(true);}
    finally {if (mounted.current) setReturning(false);}
  }, [connecting, returning, stop, onFinished, status?.state]);
  useEffect(() => {exitRef.current = finish; return () => {exitRef.current = null;};}, [exitRef, finish]);

  function begin(value: string) {
    if (!canDrive) return;
    if (held.current) release();
    setError(""); held.current = value; setDirection(value);
    if (value === "forward") onForwardPressed?.();
    sendDrive();
  }

  return <section className="rover-control" aria-label={t("Robot controls", "ロボット操作パネル")}>
    {status?.simulated && <p className="sample-notice">{t("SIMULATED BRIDGE · No robot is connected", "模擬Bridge · 実機には接続していません")}</p>}
    <div className="rover-control-heading"><div><span className="eyebrow">ROVER C PRO</span><h2>{t("Drive the robot", "ロボットを操作")}</h2></div><span className={`rover-connection ${canDrive ? "online" : ""}`}>{connecting ? t("Connecting", "接続中") : direction?.startsWith("grip-") ? t("Operating gripper", "アーム操作中") : direction ? t("Sending commands", "走行指令を送信中") : canDrive ? t("Controls active", "操作受付中") : t("Waiting for connection", "接続待ち")}</span></div>
    <p className="rover-hint">{t("Close the Windows control app before connecting. Keep the robot in view while operating.", "接続前にWindows版の操作アプリを閉じてください。ロボットを見ながら操作してください。")}</p>
    <div className="rover-control-layout"><RoverCamera /><div className="rover-inputs"><div className="rover-pad">
      {directions.map(([value, icon, en, ja]) => value === "stop" ?
        <button key={value} type="button" className="rover-stop" onClick={stop} disabled={!session.current || !active} aria-label={t("Stop and disconnect", "停止して切断")}><span>{icon}</span>{t(en, ja)}</button> :
        <button key={value} type="button" className={`rover-direction ${value === "back" ? "rover-back" : ""} ${direction === value ? "pressed" : ""}`} disabled={!canDrive} aria-label={t(en, ja)} aria-pressed={direction === value}
          onPointerDown={e => {if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); begin(value);}}
          onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => {if (held.current === value) release();}}
          onBlur={() => {if (held.current === value) release();}}
          onKeyDown={e => {if ((e.key === " " || e.key === "Enter") && !e.repeat) {e.preventDefault(); begin(value);}}}
          onKeyUp={e => {if (e.key === " " || e.key === "Enter") {e.preventDefault(); release();}}}
          onContextMenu={e => e.preventDefault()}><span>{icon}</span>{t(en, ja)}</button>)}
    </div><section className="rover-gripper" aria-label={t("Gripper", "アーム")}>
      <h3>{t("Gripper", "アーム")}</h3><div className="rover-gripper-buttons">
        <button type="button" disabled={!canDrive || Boolean(direction)} onClick={() => begin("grip-open")}>{t("Release", "はなす（開く）")}</button>
        <button type="button" disabled={!canDrive} aria-pressed={direction === "grip-close"} className={direction === "grip-close" ? "pressed" : ""}
          onPointerDown={event => {if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); begin("grip-close");}}
          onPointerUp={() => {if (held.current === "grip-close") release();}}
          onPointerCancel={() => {if (held.current === "grip-close") release();}}
          onLostPointerCapture={() => {if (held.current === "grip-close") release();}}
          onBlur={() => {if (held.current === "grip-close") release();}}
          onKeyDown={event => {if ((event.key === " " || event.key === "Enter") && !event.repeat) {event.preventDefault(); begin("grip-close");}}}
          onKeyUp={event => {if (event.key === " " || event.key === "Enter") {event.preventDefault(); if (held.current === "grip-close") release();}}}
          onContextMenu={event => event.preventDefault()}>{t("Hold to grab", "つかむ（長押し）")}</button>
      </div><p>{t("Hold to close gradually. Release the button at the position you want.", "押している間だけ少しずつ閉じます。つかんだらボタンを離してください。")}</p>
    </section></div><div className="rover-options"><span className="eyebrow">{t("SPEED", "速度")}</span><div className="rover-speed">{([[35,"Slow","ゆっくり"],[60,"Normal","ふつう"],[85,"Fast","速め"]] as const).map(([value,en,ja]) => <button type="button" key={value} disabled={Boolean(direction)} aria-pressed={speed === value} className={speed === value ? "selected" : ""} onClick={() => setSpeed(value)}>{t(en,ja)}</button>)}</div>
      <button type="button" onClick={() => void connect()} disabled={active}>{connecting ? t("Connecting…", "接続しています…") : t("Connect robot", "ロボットに接続")}</button>
      <small>{t("Release a direction to stop driving. The red Stop button disconnects. Leaving this page or losing the connection also stops the robot.", "方向ボタンを離すと走行を停止します。赤い停止ボタンは接続も解除します。ページ移動や通信切断時にも停止します。")}</small>
      <details className="control-details"><summary>{t("Connection details", "接続の詳細")}</summary><dl className="robot-readings"><div><dt>{t("Robot response", "ロボットの応答")}</dt><dd>{status?.telemetryFresh ? t("Receiving", "受信中") : t("Not received", "未受信")}</dd></div><div><dt>{t("Motor output", "モーター出力")}</dt><dd>{status?.telemetryFresh && status.motors ? status.motors.join(" / ") : "—"}</dd></div><div><dt>{t("Physical movement", "実際の移動")}</dt><dd>{t("Not verified", "未検証")}</dd></div></dl></details>
    </div></div>
    {(error || (session.current && status?.state === "error")) && <div className="rover-feedback error" role="alert">{error === "Stop could not be confirmed. Check the robot." ? t("Stop unconfirmed. Check the robot and retry.", "停止未確認です。ロボットを確認して再試行してください。") : error.includes("network access is blocked") ? t("The bridge cannot access the local network. Restart it with LAN access.", "中継のLAN通信が制限されています。LAN接続を許可して起動し直してください。") : error.includes("Windows") ? t("Close the Windows app, then reconnect.", "Windowsアプリを閉じて再接続してください。") : error.includes("Controls paused") || error.includes("Stale command") ? t("Press a direction again to continue.", "方向ボタンをもう一度押すと続けられます。") : t("Connection lost. Reconnect to continue.", "接続が切れました。再接続してください。")}</div>}
    {exitUnconfirmed && <button className="secondary return-overview" type="button" onClick={() => {stop(); onFinished(false);}}>{t("Return to overview · stop unconfirmed", "概要へ戻る（停止未確認）")} →</button>}
    <button className="return-overview" type="button" disabled={returning} onClick={() => void finish()}>{returning ? t("Confirming stop…", "停止を確認しています…") : connecting ? t("Cancel connection & return", "接続を中断して概要へ戻る") : returnToStep3 ? t("End controls & return to Step 3", "操作を終了してStep 3へ") : canLeaveWithoutStop(session.current, status?.state) ? t("Return to overview", "概要へ戻る") : t("End controls & return to overview", "操作を終了して概要へ戻る")} <span>→</span></button>
  </section>;
}
