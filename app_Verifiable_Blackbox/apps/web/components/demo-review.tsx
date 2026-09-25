"use client";

import {useEffect, useRef, useState} from "react";
import {createWalletClient, custom, formatUnits, type Address} from "viem";
import type {ConnectedWallet} from "@privy-io/react-auth";
import {reviewMessage, type DemoReviewRecord} from "@/lib/demo-review";
import {useLanguage} from "./language";

type ReviewWallet = Pick<ConnectedWallet, "address" | "getEthereumProvider">;

export function DemoReview({jobId, wallet, available, closed, onRecord, onBusyChange}: {
  jobId: string; wallet: ReviewWallet; available: boolean; closed: boolean;
  onRecord(record: DemoReviewRecord): void;
  onBusyChange?(busy: boolean): void;
}) {
  const {t} = useLanguage();
  const [record, setRecord] = useState<DemoReviewRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const callback = useRef(onRecord);
  const previous = useRef("");
  useEffect(() => {callback.current = onRecord;}, [onRecord]);

  function accept(next: DemoReviewRecord | null) {
    if (!mounted.current) return;
    setRecord(next);
    const serialized = JSON.stringify(next);
    if (next && previous.current !== serialized) {previous.current = serialized; callback.current(next);}
  }

  useEffect(() => {
    mounted.current = true;
    let fetching = false;
    async function refresh() {
      if (fetching || inFlight.current) return;
      fetching = true;
      try {
        const response = await fetch(`/api/demo/rover/review?jobId=${jobId}`, {cache: "no-store"});
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        accept(payload.record);
        if (mounted.current) setError(previousError => previousError === "LOAD_FAILED" ? undefined : previousError);
      } catch {if (mounted.current) setError("LOAD_FAILED");}
      finally {fetching = false; if (mounted.current) setLoading(false);}
    }
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {mounted.current = false; window.clearInterval(timer);};
    // This component is keyed by wallet + creation transaction in the dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function post(action: string, signature?: string) {
    const response = await fetch("/api/demo/rover/review", {method: "POST",
      headers: {"Content-Type": "application/json"}, body: JSON.stringify({jobId, action, signature})});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    accept(payload.record);
    return payload.record as DemoReviewRecord;
  }

  async function act() {
    if (inFlight.current || closed || (!available && !record?.authorizationSignature)) return;
    inFlight.current = true; setBusy(true); onBusyChange?.(true); setError(undefined);
    try {
      const current = await post("prepare");
      if (current.context.client.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("OWNER_SIGNATURE_REQUIRED");
      const signer = createWalletClient({account: wallet.address as Address, transport: custom(await wallet.getEthereumProvider())});
      const signature = await signer.signMessage({message: reviewMessage(current.context)});
      if (!mounted.current) return;
      await post("verify-and-pay", signature);
    } catch (cause) {if (mounted.current) setError(cause instanceof Error ? cause.message : "APPROVAL_REQUEST_FAILED");}
    finally {inFlight.current = false; onBusyChange?.(false); if (mounted.current) setBusy(false);}
  }

  if ((!available && !record?.authorizationSignature) || (closed && !record?.authorizationSignature)) return null;
  const paid = record?.phase === "paid";
  const pending = record?.phase === "submitting" || record?.phase === "submitted" || record?.phase === "paying";
  const errorText = error === "OWNER_SIGNATURE_REQUIRED" ? t("Use the wallet that created this job.", "仕事を作成したウォレットで操作してください。")
    : error === "JOB_EXPIRED" ? t("This job has expired.", "この仕事は期限切れです。")
    : error === "TRANSACTION_RECONCILIATION_REQUIRED" ? t("The transaction needs checking before retrying. Contact the demo operator.", "再実行の前に取引の確認が必要です。デモの管理者に確認してください。")
    : error === "APPROVAL_REQUEST_IN_PROGRESS" ? t("This job is already being processed. Wait for its result.", "この仕事は処理中です。結果をお待ちください。")
    : error === "EVIDENCE_TOO_OLD" ? t("This demo record has expired. Ask the demo operator to check the job.", "デモ記録の検証期限が切れました。管理者に仕事の状態を確認してください。")
    : error === "LOAD_FAILED" ? t("Could not load the result. Retrying…", "結果を再読み込みしています…")
    : t("The request did not finish. Check your wallet and retry; recorded progress is saved.", "処理が完了しませんでした。ウォレットを確認して再試行してください。進捗は保存されています。");

  return <section className="verification-review demo-review" aria-label={t("Verification and payment", "検証と支払い")}>
    <h3>{paid ? t("Payment complete", "支払いが完了しました") : t("3. Verify & pay", "3. 検証して支払う")}</h3>
    {loading ? <p>{t("Loading…", "読み込み中…")}</p> : <>
      {!paid && <p>{t("Verify this job's demo record, then release the reserved reward.", "この仕事のデモ記録を検証し、預けた報酬を支払います。")}</p>}
      {record && <dl className="proof-list"><div><dt>{t("Reward", "報酬")}</dt><dd>{formatUnits(BigInt(record.context.budget), 6)} mUSDC</dd></div>
        <div><dt>{t("Recipient", "受取先")}</dt><dd title={record.context.provider}>{record.context.provider.slice(0, 8)}…{record.context.provider.slice(-6)}</dd></div></dl>}
      {!paid && !closed && <button disabled={busy} onClick={() => void act()}>{busy ? t("Verifying & confirming payment…", "検証・支払いを確認しています…") : pending ? t("Resume verification & payment", "検証と支払いを再開") : t("Verify & pay", "検証して支払う")}</button>}
      {paid && <p role="status">{t("The reward has been released. Your receipt is available alongside this job.", "報酬を支払いました。領収書で取引を確認できます。")}</p>}
    </>}
    {error && <p role="alert">{errorText}</p>}
  </section>;
}
