"use client";
import {useState} from "react";
import {useDemoWallet} from "./wallet-context";
import {useLanguage} from "./language";

export function WorldDisclosure({jobId, sessionId}: {jobId: string; sessionId?: string}) {
  const {getAccessToken} = useDemoWallet();
  const {t} = useLanguage();
  const [busy, setBusy] = useState(false), [url, setUrl] = useState(""), [error, setError] = useState("");
  async function prepare() {
    setBusy(true); setError(""); setUrl("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/demo/world/disclosure", {method: "POST", headers: {"Content-Type": "application/json",
        ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: JSON.stringify({jobId, ...(sessionId ? {sessionId} : {})})});
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setUrl(result.invitationUrl);
    } catch (failure) {setError(failure instanceof Error ? failure.message : "WORLD_UNAVAILABLE");}
    finally {setBusy(false);}
  }
  return <section aria-label={t("World footage disclosure", "Worldによる映像開示")}>
    <h3>{t("Share recorded footage", "記録映像を開示する")}</h3>
    <p>{t("A viewer requests access. An authorized approver verifies with World to allow five minutes of viewing.", "閲覧者が開示を依頼し、承認者がWorldで認証すると5分間だけ閲覧できます。")}</p>
    <button className="secondary" disabled={busy} onClick={() => void prepare()}>{busy ? t("Preparing…", "準備中…") : t("Create footage request link", "映像の開示リンクを作成")}</button>
    {url && <div><p><a href={url} target="_blank" rel="noreferrer">{t("Open request page", "開示依頼画面を開く")} ↗</a></p>
      <label>{t("Link to send to the viewer", "閲覧者へ渡すリンク")}<input aria-label={t("Viewer link", "閲覧者用リンク")} readOnly value={url} onFocus={event => event.target.select()} /></label></div>}
    {error && <p role="alert">{error === "RECORDING_UNAVAILABLE" ? t("No footage is available for this Job.", "このJobには開示できる映像がありません。")
      : error === "WORLD_APPROVER_NOT_CONFIGURED" ? t("Configure this Job owner's wallet in the disclosure service.", "開示サービスに、このJob所有者のウォレットを設定してください。")
      : error === "WORLD_NOT_CONFIGURED" ? t("World disclosure is not configured yet.", "World開示サービスの接続設定が必要です。")
      : ["LOGIN_REQUIRED", "JOB_OWNER_REQUIRED"].includes(error) ? t("Sign in as this Job's owner.", "このJobの所有者としてログインしてください。")
      : t("Could not prepare disclosure. Check the service and retry.", "開示の準備ができませんでした。サービスの接続を確認して再試行してください。")}</p>}
  </section>;
}
