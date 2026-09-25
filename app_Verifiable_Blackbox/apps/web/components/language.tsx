"use client";

import {createContext, useContext, useEffect, useState, type ReactNode} from "react";

type Language = "en" | "ja";
const LanguageContext = createContext({language: "en" as Language, setLanguage: (_value: Language) => {}, t: (en: string, ja?: string) => en});
const messages: Record<string, string> = {
  "Job ready. Continue to robot controls.": "仕事を作成しました。ロボットの操作に進んでください。",
  "Could not create job.": "仕事を作成できませんでした。",
  "Could not load the previous job. Please refresh.": "前回の仕事を読み込めません。再読み込みしてください。",
  "Created job could not be identified.": "作成した仕事の番号を取得できませんでした。",
  "Ready to review your jobs.": "仕事の状況を確認できます。",
  "Wallet not ready": "ウォレットの接続を待っています。",
  "Contract config unavailable": "支払い設定を読み込めません。",
  "Verification failed": "検証できませんでした。",
  "Fixture Job failed": "サンプルの仕事を作成できませんでした。",
  "Chain status refresh failed": "仕事の状態を更新できませんでした。",
  "Sign in to manage your jobs.": "ログインして仕事を管理してください。",
  "Previous job restored.": "前回の仕事を復元しました。",
  "Evidence submitted. Waiting for verification and payment.": "証拠を提出しました。検証と支払いを待っています。",
  "Payment recorded. See the receipt for details.": "支払いが記録されました。領収書で詳細を確認できます。",
  "Creating and funding a Rover Job…": "仕事を作成し、報酬を預けています…",
  "Creating, funding, and submitting a Fixture Job…": "サンプルの仕事と証拠を作成しています…",
  "Sample evidence submitted. Ready for verification.": "サンプル証拠を提出しました。検証できます。",
  "Verifying sample evidence…": "サンプル証拠を検証しています…",
  "Verified evidence released 100 Mock USDC to the Provider.": "検証が完了し、提供者へ100 Mock USDCが支払われました。",
  "Creating a separate tamper-test Job…": "改ざんテスト用の仕事を作成しています…",
  "Tampered evidence was rejected before settlement.": "改ざんされた証拠を拒否し、支払いを停止しました。",
  "Connect to test the robot. No payment is triggered.": "接続してロボットの操作を確認できます。支払いは発生しません。",
  "Connected. Hold a direction to send commands; release to stop.": "接続しました。方向ボタンを押している間だけ指令を送り、離すと停止します。",
  "Sending drive commands. Physical movement is not verified.": "走行指令を送信中です。実際の移動は未検証です。",
  "Controls released. No payment is triggered.": "操作を離しました。支払いは発生しません。",
  "Stopping the robot.": "ロボットを停止しています。",
  "Stopped. No payment was triggered.": "停止しました。支払いは発生していません。",
  "Robot response lost. Check that it has stopped. No payment was triggered.": "ロボットの応答が途切れました。停止状態を確認してください。支払いは発生していません。",
  "Cannot connect. Check the robot power and Wi-Fi.": "接続できません。電源とWi-Fiを確認してください。",
  "Close the Windows Rover app and stop the robot before connecting.": "Windows版の操作アプリを閉じ、ロボットを停止してから接続してください。",
  "A control session is already active. Stop it before reconnecting.": "別の操作が接続中です。停止してから再接続してください。",
  "Control session ended. Reconnect to continue.": "操作接続が終了しました。再接続してください。",
  "Control signal expired. Wait for the robot to stop.": "操作信号が途切れました。停止を待ってください。",
  "Waiting for robot telemetry. No movement command sent.": "ロボットからの応答を待っています。走行指令は送っていません。",
  "Control bridge unavailable. Restart the web launcher.": "中継に接続できません。Webを再起動してください。",
  "Stop could not be confirmed. Check the robot.": "停止を確認できません。ロボットを確認してください。",
  "Stale command rejected.": "古い操作指令を拒否しました。",
  "Control session does not match.": "操作接続が一致しません。",
  "Waiting": "待機中", "Open": "作成済み", "Funded": "報酬預かり済み", "Submitted": "提出済み", "Completed": "完了", "Rejected": "拒否", "Expired": "期限切れ",
};

export function LanguageProvider({children}: {children: ReactNode}) {
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {if (localStorage.getItem("vbb-language") === "ja") setLanguage("ja");}, []);
  useEffect(() => {document.documentElement.lang = language;}, [language]);
  function change(value: Language) {setLanguage(value); localStorage.setItem("vbb-language", value);}
  return <LanguageContext.Provider value={{language, setLanguage: change, t: (en, ja) => language === "ja" ? (ja ?? messages[en] ?? en) : en}}>{children}</LanguageContext.Provider>;
}
export const useLanguage = () => useContext(LanguageContext);
