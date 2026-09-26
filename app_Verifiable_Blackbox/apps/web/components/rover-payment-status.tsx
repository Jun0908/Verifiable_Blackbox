"use client";
import {useEffect, useRef, useState} from "react";
import Link from "next/link";
import type {RoverSessionRecord} from "@/lib/rover-session";
import {useDemoWallet} from "./wallet-context";
import {useLanguage} from "./language";

export function RoverPaymentStatus({jobId, closed, onRecord, onBusyChange}: {
  jobId: string; closed: boolean;
  onRecord(record: RoverSessionRecord): void;
  onBusyChange(busy: boolean): void;
}) {
  const {t} = useLanguage();
  const {getAccessToken, getIdentityToken} = useDemoWallet();
  const [record, setRecord] = useState<RoverSessionRecord>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = useRef<RoverSessionRecord | undefined>(undefined), pending = useRef(false), mounted = useRef(true);
  const paymentPending = useRef(false), analysisPending = useRef(false);
  const section = useRef<HTMLElement>(null), focused = useRef(false);
  const callback = useRef(onRecord), previous = useRef("");
  useEffect(() => {callback.current = onRecord;}, [onRecord]);
  useEffect(() => {
    if (!loading && !focused.current && window.location.hash === "#step-3") {
      focused.current = true;
      section.current?.scrollIntoView({block:"start"});
      section.current?.focus({preventScroll:true});
    }
  }, [loading]);

  function accept(next: RoverSessionRecord) {
    if (!mounted.current) return;
    current.current = next; setRecord(next);
    const serialized = JSON.stringify(next);
    if (previous.current !== serialized) {previous.current = serialized; callback.current(next);}
  }
  async function request(path: string, body: unknown, headers: Record<string,string> = {}) {
    const response = await fetch(`/api/demo/rover/${path}`, {method:"POST", headers:{"Content-Type":"application/json", ...headers},
      body:JSON.stringify(body), signal:AbortSignal.timeout(path === "complete" ? 90000 : 20000)});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "REQUEST_FAILED");
    return result.record as RoverSessionRecord;
  }
  const credentials = (r: RoverSessionRecord) => ({jobId, sessionId:r.context.sessionId, signature:r.controlToken ?? r.authorizationSignature});
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const refresh = async () => {
      if (pending.current || paymentPending.current) return;
      pending.current = true;
      try {
        let next: RoverSessionRecord;
        if (current.current) next = await request("session/status", credentials(current.current));
        else {
          const token = await getAccessToken(), identity = await getIdentityToken();
          if (token && !identity) throw Error("LOGIN_IDENTITY_REQUIRED");
          next = await request("session/direct", {jobId, skipVideo:false}, {
            ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(identity ? {"x-privy-identity-token":identity} : {}),
          });
        }
        if (!disposed && !paymentPending.current) {accept(next); setError("");}
        if (!disposed && next.payment?.phase === "PAID" && !next.analysis && ["CAPTURED", "ERROR"].includes(next.phase) && !analysisPending.current) {
          analysisPending.current = true;
          void request("session/analyze", credentials(next)).then(value => {if (!disposed) accept(value);})
            .catch(()=>{}).finally(()=>{analysisPending.current = false;});
        }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : "RECORD_UNAVAILABLE");
      } finally {pending.current = false; if (!disposed) setLoading(false);}
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {disposed = true; mounted.current = false; clearInterval(timer);};
    // The dashboard keys this component by wallet and Job creation transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, getAccessToken, getIdentityToken]);

  async function resume() {
    const saved = current.current;
    if (!saved?.buttonAuthorization?.pressedAt || paymentPending.current || closed || saved.payment?.phase === "PAID") return;
    paymentPending.current = true; setBusy(true); onBusyChange(true); setError("");
    try {accept(await request("complete", credentials(saved)));}
    catch (failure) {if (mounted.current) setError(failure instanceof Error ? failure.message : "PAYMENT_PENDING");}
    finally {paymentPending.current = false; if (mounted.current) {setBusy(false); onBusyChange(false);}}
  }
  const paid = record?.payment?.phase === "PAID";
  const pressed = Boolean(record?.buttonAuthorization?.pressedAt);
  if (closed && !record) return null;
  return <section ref={section} tabIndex={-1} className="verification-review" aria-label={t("Rover payment status", "Roverの支払い状況")}>
    <h3>{paid ? t("Step 4 · Payment completed", "Step 4 · 支払い完了") : t("Step 3 · Verify record", "Step 3 · 記録を検証")}</h3>
    <p role="status">{loading ? t("Loading the saved record…", "保存された記録を確認しています…")
      : paid ? t("Payment completed", "支払いが完了しました")
      : pressed ? t("Forward press recorded. You can now verify and pay.", "前ボタンの押下を記録済みです。検証して支払いに進めます。")
      : error ? t("The saved record could not be loaded. Open robot controls to check it.", "保存された記録を取得できませんでした。ロボットの操作画面で確認してください。")
      : t("No Forward press has been recorded for this Job. Open robot controls and tap Forward once.", "このJobには前ボタンの押下がまだ記録されていません。操作画面で前ボタンを一瞬押してください。")}</p>
    {pressed && !paid && !closed && <button disabled={busy} onClick={() => void resume()}>
      {busy ? t("Checking payment…", "支払いを確認しています…") : record?.payment ? t("Resume saved payment", "記録済みの支払いを再開") : t("Verify & pay", "検証して支払う")}
    </button>}
    {(error || record?.payment?.error) && !closed && <p role="alert">{error || record?.payment?.error}</p>}
    <Link className="primary-link" href={{pathname:"/rover",query:{job:jobId}}}>{t("Return to robot controls", "ロボットの操作画面へ戻る")} →</Link>
  </section>;
}
