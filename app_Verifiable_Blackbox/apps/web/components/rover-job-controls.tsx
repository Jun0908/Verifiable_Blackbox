"use client";
import {useCallback, useEffect, useRef, useState, type RefObject} from "react";
import {formatUnits} from "viem";
import type {ActiveRobotJob} from "@/lib/job-flow";
import type {RoverSessionRecord} from "@/lib/rover-session";
import {useDemoWallet} from "./wallet-context";
import {useLanguage} from "./language";
import {RoverControl} from "./rover-control";
import {RoverRecordingPanel} from "./rover-recording-panel";
import {WorldDisclosure} from "./world-disclosure";
import "./rover-session.css";

export function RoverJobControls({job, exitRef, onFinished}: {job: ActiveRobotJob; exitRef: RefObject<(() => Promise<void>) | null>; onFinished: (operated: boolean) => void}) {
  const {t} = useLanguage(), {getAccessToken, getIdentityToken, login} = useDemoWallet();
  const [record, setRecord] = useState<RoverSessionRecord>(), [error, setError] = useState("");
  const [preparing, setPreparing] = useState(true), [paying, setPaying] = useState(false), [settings, setSettings] = useState(false), [skip, setSkip] = useState(false);
  const current = useRef(record), mounted = useRef(true), paymentBusy = useRef(false), captureBusy = useRef(false), pressedLocally = useRef(false), preparePending = useRef<Promise<RoverSessionRecord> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), analyzed = useRef(false);
  const accept = useCallback((value: RoverSessionRecord) => {
    current.current = value;
    if (mounted.current) setRecord(value);
    return value;
  }, []);
  const post = useCallback(async (path: string, data: unknown, token?: string | null, identityToken?: string | null): Promise<RoverSessionRecord> => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`/api/demo/rover/${path}`, {method: "POST", headers: {"Content-Type": "application/json", ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(identityToken ? {"x-privy-identity-token": identityToken} : {})},
        body: JSON.stringify(data), signal: AbortSignal.timeout(path === "complete" ? 90000 : 35000)});
      const payload = await response.json();
      if (!response.ok) {if (payload.error === "SESSION_BUSY" && attempt < 120) {await new Promise(r=>setTimeout(r,500));continue;} throw Error(payload.error || "REQUEST_FAILED");}
      return payload.record;
    }
  }, []);
  const credentials = (r: RoverSessionRecord) => ({jobId: job.jobId, sessionId: r.context.sessionId, signature: r.controlToken});
  const prepare = useCallback((skipVideo = false): Promise<RoverSessionRecord> => {
    if (preparePending.current) return preparePending.current;
    setPreparing(true); setError("");
    const pending = (async () => {
      try {
        let next: RoverSessionRecord | undefined;
        for (let i=0; i<2; i++) {
          try {
            const token=await getAccessToken(), identityToken=await getIdentityToken();
            if(token && !identityToken) throw Error("LOGIN_IDENTITY_REQUIRED");
            next = await post("session/direct", {jobId: job.jobId, skipVideo}, token, identityToken);break;
          }
          catch (e) {if (i || !(e instanceof Error) || !e.message.startsWith("LOGIN_")) throw e;await new Promise(r=>setTimeout(r,500));}
        }
        setSkip(next!.context.options.judgmentMode === "SKIP_VIDEO"); return accept(next!);
      } finally {preparePending.current = null;if (mounted.current) setPreparing(false);}
    })();preparePending.current = pending;return pending;
  }, [getAccessToken, getIdentityToken, job.jobId, post, accept]);
  useEffect(() => {mounted.current=true;void prepare().catch(e=>setError(e.message));return()=>{mounted.current=false;clearTimeout(timer.current);};}, [prepare]);
  async function pay(r: RoverSessionRecord) {
    if (paymentBusy.current || r.payment?.phase === "PAID") return;
    paymentBusy.current=true;setPaying(true);
    try {accept(await post("complete",credentials(r)));} catch(e) {if(mounted.current)setError(e instanceof Error?e.message:"PAYMENT_PENDING");}
    finally {paymentBusy.current=false;if(mounted.current)setPaying(false);}
  }
  async function forward() {
    pressedLocally.current=true;
    setError("");
    try {
      const r=current.current ?? await prepare(skip);
      const pressed=r.buttonAuthorization?.pressedAt?r:accept(await post("session/start",{...credentials(r),action:"press"}));
      void pay(pressed);
    } catch(e) {setError(e instanceof Error?e.message:"PRESS_NOT_SAVED");}
  }
  async function capture() {
    if(captureBusy.current)return;captureBusy.current=true;
    try {
      const r=current.current ?? await prepare(skip);
      if(r.context.controlMode === "manual" && r.phase === "AUTHORIZED") accept(await post("session/start",{...credentials(r),action:"start"}));
    } catch(e) {if(mounted.current)setError(e instanceof Error?e.message:"RECORDING_UNAVAILABLE");}
    finally {captureBusy.current=false;}
  }
  useEffect(() => {
    let pending=false,disposed=false;
    const interval=setInterval(async()=>{
      const r=current.current;if(!r || pending || paymentBusy.current)return;
      pending=true;
      try {
        let next=r;
        if(r.context.controlMode === "manual" && r.buttonAuthorization?.pressedAt && Date.now()/1000-r.buttonAuthorization.pressedAt>2
          && ["STARTING","RECORDING","OPERATING","STOPPING"].includes(r.phase)) await post("session/start",{...credentials(r),action:"stop"});
        if(["STARTING","RECORDING","OPERATING","STOPPING"].includes(r.phase)) next=await post("session/status",credentials(r));
        if(!disposed)accept(next);
        if(["CAPTURED","ERROR"].includes(next.phase) && !next.analysis && !analyzed.current) {
          analyzed.current=true;try {const result=await post("session/analyze",credentials(next));if(!disposed)accept(result);}catch{analyzed.current=false;}
        }
      }catch{/* Status polling must not interrupt manual driving. */}finally{pending=false;}
    },750);return()=>{disposed=true;clearInterval(interval);};
  },[job.jobId,post,accept]);
  async function finish(operated: boolean) {
    const r=current.current;
    // RoverControl confirms the motor stop before invoking this callback.
    if(r && ["STARTING","RECORDING","OPERATING","STOPPING"].includes(r.phase)) {
      try {await post("session/start",{...credentials(r),action:"stop"});}catch{/* The capture service also has a bounded recording lifetime. */}
      try {
        for(let attempt=0;attempt<20;attempt++) {
          const next=await post("session/status",credentials(r));
          if(["CAPTURED","ERROR"].includes(next.phase)) {await post("session/analyze",credentials(next));break;}
          await new Promise(resolve=>setTimeout(resolve,100));
        }
      }catch{/* Analysis can be retried from the saved recording. */}
    }
    onFinished(operated || Boolean(r?.buttonAuthorization?.pressedAt));
  }
  return <>
    <section className="panel rover-session-panel">
      <div className="rover-session-heading"><h2>{t("Job status", "Jobの状況")}</h2><button aria-label={t("Settings","設定")}
        onPointerDown={()=>{timer.current=setTimeout(()=>setSettings(true),1200);}} onPointerUp={()=>clearTimeout(timer.current)} onPointerCancel={()=>clearTimeout(timer.current)}
        onKeyDown={e=>{if(!e.repeat && [" ","Enter"].includes(e.key))timer.current=setTimeout(()=>setSettings(true),1200);}} onKeyUp={()=>clearTimeout(timer.current)}>⚙</button></div>
      <p>{t("Tap Forward once to complete this Job. No minimum hold time. You can continue using all controls.","前ボタンを一瞬押すだけでJob完了です。長押しは不要です。完了後もすべての操作を続けられます。")}</p>
      <p role="status">{record?.buttonAuthorization?.pressedAt?t("Job complete · Forward press recorded","Job完了・前ボタンの押下を記録しました"):preparing?t("Preparing the Job record…","Jobの記録を準備しています…"):t("Waiting for a Forward press","前ボタンの押下待ち")}</p>
      {paying && <p role="status">{t("Processing payment…","支払い処理中です…")}</p>}
      {record?.payment?.phase === "PAID" && <p>{t("Payment completed","支払い完了")} · {formatUnits(BigInt(record.context.budget),6)} mUSDC</p>}
      {settings && <label><input type="checkbox" checked={skip} disabled={preparing || record?.phase !== "AUTHORIZED" || Boolean(record?.buttonAuthorization?.pressedAt)} onChange={e=>{setSkip(e.target.checked);void prepare(e.target.checked).catch(e=>setError(e.message));}} />{t("Skip video recognition","動画認識をスキップ")}</label>}
      {error && <div role="alert"><p>{t("The Job record or payment needs a retry. Robot controls remain available.","Jobの記録・支払いを再試行してください。ロボットの操作は続けられます。")}</p><small>{error}</small>
        {error === "LOGIN_IDENTITY_REQUIRED" && <p>{t("Enable 'Return user data in an identity token' in Privy Authentication > Advanced, then reload.", "Privy管理画面のAuthentication → Advancedで「Return user data in an identity token」をONにし、画面を再読み込みしてください。")}</p>}
        <button disabled={paying || preparing} onClick={()=>{setError("");if(current.current?.buttonAuthorization?.pressedAt)void pay(current.current);else if(pressedLocally.current)void forward();else void prepare(skip).catch(e=>setError(e.message));}}>{t("Retry","再試行")}</button>
        {error.startsWith("LOGIN_") && <button onClick={login}>{t("Sign in","ログイン")}</button>}</div>}
    </section>
    <RoverControl onFinished={operated=>void finish(operated)} exitRef={exitRef} onForwardPressed={()=>void forward()} onConnected={()=>void capture()} />
    {record && ["CAPTURED","ERROR"].includes(record.phase) && <RoverRecordingPanel record={record} />}
    {record?.payment?.phase === "PAID" && <WorldDisclosure jobId={job.jobId} sessionId={record.context.sessionId} />}
  </>;
}
