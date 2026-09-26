"use client";
import {useEffect, useState} from "react";
import {useDemoWallet} from "./wallet-context";
import {useLanguage} from "./language";

export function WorldDisclosure({jobId, sessionId}: {jobId: string; sessionId?: string}) {
  const {getAccessToken, getIdentityToken} = useDemoWallet();
  const {t} = useLanguage();
  const [busy, setBusy] = useState(false), [url, setUrl] = useState(""), [error, setError] = useState("");
  const [connection, setConnection] = useState<{ready:boolean; error?:string} | null>(null);
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      const response = await fetch("/api/demo/world/status", {cache:"no-store", signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw Error();
      setConnection(await response.json());
    } catch {setConnection({ready:false,error:"WORLD_UNAVAILABLE"});}
    finally {setChecking(false);}
  }
  useEffect(()=>{void check();},[]);
  async function prepare() {
    setBusy(true); setError(""); setUrl("");
    try {
      const token = await getAccessToken();
      const identityToken = await getIdentityToken();
      const response = await fetch("/api/demo/world/disclosure", {method: "POST", headers: {"Content-Type": "application/json",
        ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(identityToken ? {"x-privy-identity-token": identityToken} : {})}, body: JSON.stringify({jobId, ...(sessionId ? {sessionId} : {})}), signal:AbortSignal.timeout(45000)});
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setUrl(result.invitationUrl);
    } catch (failure) {setError(failure instanceof Error ? failure.message : "WORLD_UNAVAILABLE");}
    finally {setBusy(false);}
  }
  const problem = error || connection?.error;
  return <section aria-label={t("World footage disclosure", "Worldによる映像開示")}>
    <h3>{t("Share recorded footage", "記録映像を開示する")}</h3>
    <p>{t("A viewer requests access. An authorized approver verifies with World to allow five minutes of viewing.", "閲覧者が開示を依頼し、承認者がWorldで認証すると5分間だけ閲覧できます。")}</p>
    {checking && <p role="status">{t("Checking World connection…", "Worldへの接続を確認しています…")}</p>}
    <button className="secondary" disabled={busy || !connection?.ready} onClick={() => void prepare()}>{busy ? t("Preparing…", "準備中…") : t("Create footage request link", "映像の開示リンクを作成")}</button>
    {connection && !connection.ready && <button className="secondary" disabled={checking} onClick={()=>void check()}>{t("Check connection again", "接続を再確認")}</button>}
    {url && <div><p><a href={url} target="_blank" rel="noreferrer">{t("Open request page", "開示依頼画面を開く")} ↗</a></p>
      <label>{t("Link to send to the viewer", "閲覧者へ渡すリンク")}<input aria-label={t("Viewer link", "閲覧者用リンク")} readOnly value={url} onFocus={event => event.target.select()} /></label></div>}
    {problem && <p role="alert">{problem === "RECORDING_UNAVAILABLE" ? t("No footage is available for this Job.", "このJobには開示できる映像がありません。")
      : problem === "WORLD_APPROVER_NOT_CONFIGURED" ? t("Configure this Job owner's wallet in the disclosure service.", "開示サービスに、このJob所有者のウォレットを設定してください。")
      : problem === "WORLD_UNAVAILABLE" ? t("The World disclosure service is offline. Start it and check the connection again.", "World開示サービスに接続できません。サービスを起動して接続を再確認してください。")
      : problem === "WORLD_PUBLIC_UNAVAILABLE" ? t("The public footage link is offline. Restore the World HTTPS tunnel.", "映像開示の公開URLに接続できません。World用HTTPSトンネルを起動してください。")
      : ["WORLD_CREDENTIAL_MISMATCH", "WORLD_CONFIGURATION_INVALID"].includes(problem) ? t("World service settings do not match. Check the service URL and shared credential.", "Worldの接続設定が一致しません。接続先URLと共有キーを確認してください。")
      : problem === "WORLD_NOT_CONFIGURED" ? t("World disclosure is not configured yet.", "World開示サービスの接続設定が必要です。")
      : ["LOGIN_REQUIRED", "LOGIN_IDENTITY_REQUIRED", "JOB_OWNER_REQUIRED"].includes(problem) ? t("Sign in as this Job's owner.", "このJobの所有者としてログインしてください。")
      : t("Could not prepare disclosure. Check the service and retry.", "開示の準備ができませんでした。サービスの接続を確認して再試行してください。")}</p>}
  </section>;
}
