"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {useDemoWallet} from "./wallet-context";
import Link from "next/link";
import {RoverControl} from "@/components/rover-control";
import {RoverSessionPanel} from "@/components/rover-session-panel";
import {SiteHeader} from "@/components/site-header";
import {useLanguage} from "@/components/language";
import {DEMO_STORAGE_KEY, readActiveRobotJob, recordControlEnded, type ActiveRobotJob} from "@/lib/job-flow";

export function RoverPage({requestedJob}: {requestedJob?: string}) {
  const {t} = useLanguage();
  const router = useRouter();
  const {authenticated, ready, wallets, login} = useDemoWallet();
  const walletsReady = ready;
  const wallet = (wallets.find(w => w.walletClientType === "privy") ?? wallets[0])?.address;
  const [job, setJob] = useState<ActiveRobotJob>();
  const [loading, setLoading] = useState(Boolean(requestedJob));
  const [problem, setProblem] = useState<"missing" | "unavailable" | "closed">("missing");
  const exitRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    setJob(undefined); setLoading(Boolean(requestedJob));
    if (!requestedJob) return;
    if (!ready || (!walletsReady && !wallet)) return;
    if (!authenticated || !wallet) {setLoading(false); setProblem("missing"); return;}
    let cancelled = false, checking = false;
    async function restore() {
      if (checking) return;
      checking = true;
      try {
        const configResponse = await fetch("/api/demo/config", {cache:"no-store"});
        if (!configResponse.ok) throw Error("Configuration unavailable");
        const config = await configResponse.json();
        const stored = readActiveRobotJob({wallet:wallet!, chainId:config.chainId, core:config.erc8183});
        if (!stored || stored.jobId !== requestedJob) {if (!cancelled) {setJob(undefined); setProblem("missing");} return;}
        const response = await fetch(`/api/demo/rover/complete?jobId=${stored.jobId}&createTx=${stored.createTransactionHash}`, {cache:"no-store", signal:AbortSignal.timeout(10000)});
        if (cancelled) return;
        if (!response.ok) {setJob(undefined); setProblem(response.status >= 500 ? "unavailable" : "closed"); return;}
        const data = await response.json();
        if (!cancelled && data.jobId === stored.jobId && ["Funded", "Submitted", "Completed"].includes(data.status) && data.client?.toLowerCase() === wallet?.toLowerCase()) setJob(stored);
      } catch {if (!cancelled) {setJob(undefined); setProblem("unavailable");}}
      finally {checking = false; if (!cancelled) setLoading(false);}
    }
    void restore();
    const timer = setInterval(() => void restore(), 5000);
    const changed = (event: StorageEvent) => {if (event.key?.startsWith(DEMO_STORAGE_KEY)) {setJob(undefined); void restore();}};
    window.addEventListener("storage", changed);
    return () => {cancelled = true; clearInterval(timer); window.removeEventListener("storage", changed);};
  }, [requestedJob, ready, walletsReady, authenticated, wallet]);

  const finish = useCallback((operated: boolean) => {
    if (requestedJob && job && operated) recordControlEnded(job);
    router.push("/");
  }, [requestedJob, job, router]);
  return <main className="shell operator-page"><SiteHeader onOverview={() => {if (exitRef.current) void exitRef.current(); else router.push("/");}} />
    <section className="operator-intro"><span className="eyebrow">{requestedJob ? t("STEP 2 · ROBOT CONTROL", "STEP 2 · ロボット操作") : t("FREE DRIVE", "自由に操作")}</span><h1>{job ? `Job #${job.jobId}` : t("Enjoy the drive.", "気軽に、自由に操作。")}</h1><p>{t("Connect, choose a speed, and hold a direction. Release to stop.", "接続し、速度を選んで方向ボタンを押してください。離すと停止します。")}</p></section>
    {!requestedJob ? <><p className="free-drive-note">{t("No job needed. Connect and enjoy driving.", "仕事の作成は不要です。接続して自由に操作できます。")}</p><RoverControl key="free-drive" onFinished={finish} exitRef={exitRef} /></> : loading ? <div className="empty-job"><p role="status">{t("Loading your job…", "仕事を読み込んでいます…")}</p><Link className="primary-link" href="/">{t("Return to overview", "概要へ戻る")} →</Link></div> : job ? <>
      <RoverSessionPanel key={`session:${wallet}:${job.createTransactionHash}`} job={job} />
      <Link className="primary-link" href="/">{t("Return to overview", "概要へ戻る")} →</Link>
    </> : <section className="panel empty-job">{!authenticated && <button onClick={login}>{t("Sign in", "ログイン")}</button>}<h2>{t(problem === "missing" ? "Create a job to begin" : problem === "closed" ? "This job is no longer open" : "Unable to load your job", problem === "missing" ? "仕事を作成して始めましょう" : problem === "closed" ? "この仕事の操作は終了しています" : "仕事を読み込めませんでした")}</h2><Link className="primary-link" href="/">{t("Return to overview", "概要へ戻る")} →</Link><Link className="free-drive-link" href="/rover">{t("Or drive freely without a job", "仕事なしで自由に操作する")} →</Link></section>}
  </main>;
}
