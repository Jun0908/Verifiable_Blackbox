"use client";

import {useState} from "react";
import Link from "next/link";
import {SiteHeader} from "./site-header";
import {useLanguage} from "./language";

const states = ["Not created", "Funded", "Verifying", "Paid", "Failed"] as const;
const translations = ["未作成", "報酬預かり済み", "検証中", "支払済み", "失敗"];

export function SampleDashboard({rover = false}: {rover?: boolean}) {
  const {t} = useLanguage();
  const [state, setState] = useState<(typeof states)[number]>("Not created");
  return <main className="shell sample-page">
    <SiteHeader />
    <section className="sample-intro">
      <span className="eyebrow">{t("SAMPLE · NO EXTERNAL SERVICES", "サンプル · 外部サービス不要")}</span>
      <h1>{rover ? t("Robot controls", "ロボット操作") : t("A clear record. An accountable payment.", "記録を確かめて、報酬を支払う。")}</h1>
      <p>{t("Create a job, operate the Rover, sign your approval, then verify and pay.", "仕事を作成し、Roverを操作。承認に署名して、検証と支払いへ進みます。")}</p>
      <p className="sample-notice">{t("This is a sample preview. No wallet, robot, TEE or payment is connected.", "サンプル表示です。Wallet・実機・TEE・決済は接続されていません。")}</p>
    </section>
    {rover ? <section className="panel sample-panel">
      <h2>{t("Free drive / Job operation", "自由操作 / 仕事の操作")}</h2>
      <p>{t("Connect before driving. Hold to move; release to stop.", "接続してから操作します。長押しで走行し、離すと停止します。")}</p>
      <div className="sample-actions"><button disabled>{t("Connect robot", "ロボットに接続")}</button><button disabled>{t("Forward", "前進")}</button><button disabled>{t("Stop", "停止")}</button></div>
      <p>{t("Camera and gripper are disconnected.", "カメラとグリッパーは未接続です。")}</p>
      <Link href="/">{t("Return to dashboard", "Dashboardに戻る")} →</Link>
    </section> : <>
      <section className="panel sample-panel">
        <h2>{t("Explore sample states", "サンプル状態を確認")}</h2>
        <div className="sample-actions">{states.map((value, index) => <button key={value} aria-pressed={state === value} onClick={() => setState(value)}>{t(value, translations[index])}</button>)}</div>
        <p role={state === "Failed" ? "alert" : "status"}>{t("Sample status", "サンプル状態")}: <strong>{t(state, translations[states.indexOf(state)])}</strong>{state === "Failed" ? t(" — altered evidence rejected; no payment.", " — 改ざんされた証拠を拒否。支払いなし。") : ""}</p>
      </section>
      <div className="sample-grid">
        <section className="panel sample-panel"><h2>01 · {t("Create job", "仕事を作成")}</h2><p>100 mUSDC · {t("Test tokens", "テスト用トークン")}</p><button disabled>{t("Sign in and create", "ログインして作成")}</button><p><Link href="/rover">{t("Preview Rover controls", "Rover操作画面を見る")} →</Link></p></section>
        <section className="panel sample-panel"><h2>02 · {t("Progress", "進捗")}</h2><ol><li>{t("Create and fund", "作成・報酬預かり")}</li><li>{t("Operate and stop", "操作・停止")}</li><li>{t("Sign approval", "承認署名")}</li><li>{t("Verify and pay", "検証・支払い")}</li></ol></section>
        <section className="panel sample-panel"><h2>03 · {t("History", "履歴")}</h2><p>{state === "Not created" ? t("No sample job selected.", "サンプルの仕事は未選択です。") : `Sample Job #1 · ${t(state, translations[states.indexOf(state)])}`}</p><p>{t("Real history is separated by wallet, chain and contract.", "実際の履歴はWallet・Chain・Contractごとに保存されます。")}</p></section>
        <section className="panel sample-panel"><h2>04 · {t("Receipt", "領収書")}</h2><p>{state === "Paid" ? t("Sample receipt · 100 mUSDC · simulated verifier", "サンプル領収書 · 100 mUSDC · 模擬検証") : t("Available after confirmed payment.", "支払い確定後に表示されます。")}</p><p>{t("Device signature: not checked", "機体署名：未照合")}</p></section>
      </div>
    </>}
  </main>;
}
