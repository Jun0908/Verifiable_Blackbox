"use client";
import {loadDemoState, storeDemoState} from "@/lib/active-job";


import {useCallback, useEffect, useMemo, useState} from "react";
import {useDemoWallet} from "./wallet-context";
import Link from "next/link";
import {JobProgress} from "./job-progress";
import {DemoReview} from "./demo-review";
import type {DemoReviewRecord} from "@/lib/demo-review";
import {readJobHistory, saveJobToHistory, type JobHistoryEntry, type ScenarioResult, type StoredDemoStateV3} from "@/lib/job-history";
import {controlHasEnded} from "@/lib/job-flow";
import {SiteHeader} from "./site-header";
import {useLanguage} from "./language";
import {registeredRobot} from "@/lib/registered-robot";
import {
  createPublicClient,
  encodeFunctionData,
  parseEventLogs,
  parseAbi,
  http,
  type Address,
  type Hex,
} from "viem";
import {
  erc8183Abi,
  evaluatorAbi,
  evidenceHookAbi,
  expectedChallenge,
  jobStatusNames,
  mockUsdcAbi,
  type DemoDeployment,
  type DemoEvidenceWire,
  type DemoStatus,
  type DemoVerifierConfig,
  type DemoVerifierInfo,
  type DemoVerifyResponse,
} from "@/lib/contracts";

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;
const TAMPERED_IMAGE_HASH = `0x${"0".repeat(60)}beef` as Hex;


async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & {error?: string};
  if (!response.ok) throw new Error(payload.error ?? `Request failed: ${response.status}`);
  return payload;
}

function short(value?: string, size = 7) {
  if (!value) return "—";
  return `${value.slice(0, size + 2)}…${value.slice(-size)}`;
}

function formatToken(value?: string) {
  if (!value) return "0";
  return (Number(value) / 1_000_000).toLocaleString("en-US", {maximumFractionDigits: 2});
}

export function DemoDashboard() {
  const {t} = useLanguage();
  const {ready, authenticated, login, logout, wallets, sendTransaction} = useDemoWallet();
  const walletsReady = ready;
  const [deployment, setDeployment] = useState<DemoDeployment>();
  const [verifierConfig, setVerifierConfig] = useState<DemoVerifierConfig>();
  const [job, setJob] = useState<ScenarioResult>();
  const [status, setStatus] = useState<DemoStatus>();
  const [verified, setVerified] = useState(false);
  const [verifier, setVerifier] = useState<DemoVerifierInfo>();
  const [verdictSignature, setVerdictSignature] = useState<Hex>();
  const [completeTransactionHash, setCompleteTransactionHash] = useState<Hex>();
  const [failureJobId, setFailureJobId] = useState<string>();
  const [failureMessage, setFailureMessage] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [demoReview, setDemoReview] = useState<DemoReviewRecord>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);
  const [operationEnded, setOperationEnded] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [message, setMessage] = useState("Sign in to manage your jobs.");

  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy") ?? wallets[0],
    [wallets],
  );
  const selectedWalletAddress = selectedWallet?.address;
  const historyScope = useMemo(() => selectedWalletAddress && deployment ? {
    wallet: selectedWalletAddress, chainId: deployment.chainId, core: deployment.erc8183,
  } : undefined, [selectedWalletAddress, deployment]);
  useEffect(() => {
    setHistory([]);
    if (!historyScope) return;
    try {setHistory(readJobHistory(historyScope));}
    catch {setMessage(t("Saved jobs could not be loaded. Your current job is unchanged.", "履歴を読み込めませんでした。現在の仕事は保持しています。"));}
  }, [historyScope, t]);

  const publicClient = useMemo(() => {
    if (!deployment) return undefined;
    return createPublicClient({transport: http(deployment.rpcUrl)});
  }, [deployment]);

  const readStatus = useCallback(async (jobId: bigint): Promise<DemoStatus> => {
    if (!deployment || !publicClient || !selectedWallet) throw new Error("Wallet not ready");
    const [chainJob, clientBalance, escrowBalance, providerBalance, commitment, receiptId] =
      await Promise.all([
        publicClient.readContract({
          address: deployment.erc8183,
          abi: erc8183Abi,
          functionName: "getJob",
          args: [jobId],
        }),
        publicClient.readContract({
          address: deployment.mockUsdc,
          abi: mockUsdcAbi,
          functionName: "balanceOf",
          args: [selectedWallet.address as Address],
        }),
        publicClient.readContract({
          address: deployment.mockUsdc,
          abi: mockUsdcAbi,
          functionName: "balanceOf",
          args: [deployment.erc8183],
        }),
        publicClient.readContract({
          address: deployment.mockUsdc,
          abi: mockUsdcAbi,
          functionName: "balanceOf",
          args: [deployment.provider],
        }),
        publicClient.readContract({
          address: deployment.evidenceHook,
          abi: evidenceHookAbi,
          functionName: "evidenceCommitments",
          args: [jobId],
        }),
        publicClient.readContract({
          address: deployment.evaluator,
          abi: evaluatorAbi,
          functionName: "receiptIdByJob",
          args: [jobId],
        }),
      ]);

    if (chainJob.id !== jobId || chainJob.client.toLowerCase() !== selectedWallet.address.toLowerCase()) {
      throw Error("JOB_OWNER_OR_CHAIN_MISMATCH");
    }
    return {
      jobId: jobId.toString(),
      status: chainJob.status,
      clientBalance: clientBalance.toString(),
      escrowBalance: escrowBalance.toString(),
      providerBalance: providerBalance.toString(),
      evidenceCommitment: commitment,
      receiptId,
    };
  }, [deployment, publicClient, selectedWallet]);

  const validateCreation = useCallback(async (saved:ScenarioResult) => {
    if(!publicClient || !deployment || !selectedWalletAddress) throw Error("WALLET_SCOPE_REQUIRED");
    const tx=await publicClient.getTransactionReceipt({hash:saved.createTransactionHash});
    const events=parseEventLogs({abi:erc8183Abi,eventName:"JobCreated",logs:tx.logs.filter(log=>log.address.toLowerCase()===deployment.erc8183.toLowerCase())});
    if(tx.status!=="success" || !events.some(event=>event.args.jobId===saved.jobId && event.args.client.toLowerCase()===selectedWalletAddress.toLowerCase())) throw Error("JOB_CREATION_NOT_FOUND");
  },[publicClient,deployment,selectedWalletAddress]);

  useEffect(() => {
    fetch("/api/demo/config", {cache: "no-store"})
      .then(async (response) => {
        const payload = (await response.json()) as DemoDeployment & {
          verifier: DemoVerifierConfig;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Contract config unavailable");
        setDeployment(payload);
        setVerifierConfig(payload.verifier);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Contract config unavailable");
      });
  }, []);

  useEffect(() => {
    setJob(undefined); setStatus(undefined); setVerified(false); setOperationEnded(false);
    setDemoReview(undefined);
    setReviewBusy(false);
    setVerifier(undefined); setVerdictSignature(undefined); setCompleteTransactionHash(undefined);
    if (!ready || (!walletsReady && !selectedWalletAddress)) return;
    if (!authenticated) {setRestoring(false); return;}
    if (!deployment || !publicClient || !selectedWalletAddress) return;
    setRestoring(true);
    const stored = loadDemoState(historyScope);
    if (!stored) {setRestoring(false); return;}

    let cancelled = false;
    const restoredJob: ScenarioResult = {
      ...stored.job,
      jobId: BigInt(stored.job.jobId),
    };
    void Promise.all([readStatus(restoredJob.jobId), validateCreation(restoredJob)])
      .then(([restoredStatus]) => {
        if (cancelled) return;
        setJob(restoredJob);
        setStatus(restoredStatus);
        setVerified(restoredStatus.status === 3);
        setVerifier(stored.verifier);
        setVerdictSignature(stored.verdictSignature);
        setCompleteTransactionHash(stored.completeTransactionHash);
        setMessage("Previous job restored.");
      })
      .catch(() => {
        if (cancelled) return;
        setJob(restoredJob);
        setMessage("Could not load the previous job. Please refresh.");
      }).finally(() => {if (!cancelled) setRestoring(false);});

    return () => {
      cancelled = true;
    };
  }, [ready, walletsReady, authenticated, deployment, publicClient, readStatus, selectedWalletAddress, historyScope, validateCreation]);

  useEffect(() => {
    if (
      job?.source !== "rover"
      || !selectedWalletAddress
      || status?.status === 3
      || (status?.status !== undefined && status.status >= 4)
    ) {
      return;
    }

    let cancelled = false;
    let syncing = false;
    const syncRoverStatus = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const nextStatus = await readStatus(job.jobId);
        if (cancelled) return;
        setStatus(nextStatus);
        if (nextStatus.status === 2) {
          setMessage("Evidence submitted. Waiting for verification and payment.");
        } else if (nextStatus.status === 3) {
          setVerified(true);
          setMessage("Payment recorded. See the receipt for details.");
          storeDemoState(historyScope, job, {verified: true});
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Chain status refresh failed");
        }
      } finally {
        syncing = false;
      }
    };

    void syncRoverStatus();
    const timer = window.setInterval(syncRoverStatus, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job, readStatus, selectedWalletAddress, status?.status]);

  useEffect(() => {
    const sync = () => setOperationEnded(Boolean(historyScope && job?.source === "rover" && controlHasEnded({...historyScope, jobId: job.jobId.toString(), createTransactionHash:job.createTransactionHash})));
    sync(); window.addEventListener("storage", sync); window.addEventListener("focus", sync);
    return () => {window.removeEventListener("storage", sync); window.removeEventListener("focus", sync);};
  }, [job]);

  async function sendContract(
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
  ) {
    if (!deployment || !publicClient || !selectedWallet) throw new Error("Wallet not ready");
    await selectedWallet.switchChain(deployment.chainId);
    const data = encodeFunctionData({abi, functionName, args});
    const {hash} = await sendTransaction(
      {to: address, data},
      {address: selectedWallet.address, uiOptions: {showWalletUIs: true}},
    );
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    if (receipt.status !== "success") throw Error("Transaction failed. Please try again.");
    return hash;
  }

  async function createFundedJob(
    scenario: ScenarioResult["scenario"],
    source: ScenarioResult["source"],
  ): Promise<ScenarioResult> {
    if (!deployment || !publicClient || !selectedWallet) throw new Error("Wallet not ready");

    const startTransactionHash = await sendContract(
      deployment.erc8183,
      erc8183Abi,
      "createAndFundDemo",
      [
        deployment.provider,
        deployment.evaluator,
        BigInt(Math.floor(Date.now() / 1000) + 86_400),
        `vbb://demo/${scenario}`,
        deployment.evidenceHook,
      ],
    );
    const receipt = await publicClient.getTransactionReceipt({hash:startTransactionHash});
    const events = parseEventLogs({abi:parseAbi(["event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)"]), logs:receipt.logs.filter(log => log.address.toLowerCase() === deployment.erc8183.toLowerCase()), eventName:"JobCreated"});
    const created = events.find(event => event.args.client.toLowerCase() === selectedWallet.address.toLowerCase());
    if (!created) throw Error("Created job could not be identified.");
    const jobId = created.args.jobId;
    return {
      jobId,
      scenario,
      source,
      createTransactionHash: startTransactionHash,
      fundTransactionHash: startTransactionHash,
    };
  }

  async function createSubmittedFixtureJob(scenario: ScenarioResult["scenario"]) {
    const funded = await createFundedJob(scenario, "fixture");
    const submitted = await postJson<{
      evidence: DemoEvidenceWire;
      evidenceCommitment: Hex;
    }>("/api/demo/provider", {
      action: "submit",
      jobId: funded.jobId.toString(),
      scenario,
    });
    return {...funded, ...submitted};
  }

  const saveCurrentJob = useCallback(() => {
    if (!historyScope || !job) return;
    const saved = loadDemoState(historyScope);
    const sameJob = saved?.job.jobId === job.jobId.toString() && saved.job.createTransactionHash === job.createTransactionHash;
    if (!sameJob || (status && status.jobId !== job.jobId.toString())) return;
    setHistory(saveJobToHistory(historyScope, {
      ...(sameJob ? saved : {}), version: 3, walletAddress: historyScope.wallet,
      job: {...job, jobId: job.jobId.toString()}, verified, verifier, verdictSignature,
      completeTransactionHash, status,
    }));
  }, [historyScope, job, verified, verifier, verdictSignature, completeTransactionHash, status]);

  useEffect(() => {
    if (restoring || !job || !status) return;
    try {saveCurrentJob();}
    catch {setMessage(t("Could not save job history. Keep this page open and free up browser storage.", "仕事の履歴を保存できません。この画面を残してブラウザの保存容量を確認してください。"));}
  }, [restoring, job, status, saveCurrentJob, t]);

  async function handleSelectJob(saved: JobHistoryEntry) {
    if (busy || reviewBusy || restoring || !selectedWalletAddress) return;
    setRestoring(true);
    try {
      saveCurrentJob();
      const restored = {...saved.job, jobId: BigInt(saved.job.jobId)};
      const [latestStatus] = await Promise.all([readStatus(restored.jobId), validateCreation(restored)]);
      storeDemoState(historyScope, restored, {verified:latestStatus.status === 3, verifier:saved.verifier,
        verdictSignature:saved.verdictSignature, completeTransactionHash:saved.completeTransactionHash});
      setJob(restored); setStatus(latestStatus); setVerified(latestStatus.status === 3);
      setVerifier(saved.verifier); setVerdictSignature(saved.verdictSignature);
      setCompleteTransactionHash(saved.completeTransactionHash); setDemoReview(undefined);
      setFailureMessage(undefined);
      setMessage(t("Saved job opened. Its latest payment status is shown.", "保存した仕事を開きました。最新の支払い状態を表示しています。"));
    } catch {setMessage(t("Could not open that job. Your current job is unchanged.", "仕事を開けませんでした。現在の仕事は保持しています。"));}
    finally {setRestoring(false);}
  }

  async function handleStartRover(replaceCurrent = false) {
    if (busy || reviewBusy || restoring || (!replaceCurrent && job && (!status || status.status < 3))) return;
    try {
      saveCurrentJob();
      setBusy("Creating and funding a Rover Job…");
      const created = await createFundedJob("success", "rover");
      if (selectedWallet) storeDemoState(historyScope, created, {verified:false});
      if (historyScope) setHistory(saveJobToHistory(historyScope, {version:3, walletAddress:historyScope.wallet,
        job:{...created, jobId:created.jobId.toString()}, verified:false}));
      setJob(created); setStatus(undefined); setVerified(false); setVerifier(undefined);
      setVerdictSignature(undefined); setCompleteTransactionHash(undefined); setOperationEnded(false);
      setFailureMessage(undefined); setDemoReview(undefined);
      setStatus(await readStatus(created.jobId));
      setMessage("Job ready. Continue to robot controls.");
    } catch (error) {setMessage(error instanceof Error ? error.message : "Could not create job.");}
    finally {setBusy(undefined);}
  }

  async function handleStartFixture() {
    if (busy || restoring || (job && (!status || status.status < 3))) return;
    try {
      saveCurrentJob();
      setBusy("Creating, funding, and submitting a Fixture Job…");
      setFailureMessage(undefined);
      setDemoReview(undefined);
      setVerified(false);
      setVerifier(undefined);
      setVerdictSignature(undefined);
      setCompleteTransactionHash(undefined);
      const created = await createSubmittedFixtureJob("success");
      setJob(created);
      if (selectedWallet) storeDemoState(historyScope, created, {verified: false});
      setStatus(await readStatus(created.jobId));
      setMessage(
        "Sample evidence submitted. Ready for verification.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fixture Job failed");
    } finally {
      setBusy(undefined);
    }
  }

  async function handleValidEvidence() {
    if (!job?.evidence) return;
    try {
      setBusy("Verifying sample evidence…");
      const verification = await postJson<DemoVerifyResponse>("/api/demo/verify", {
        evidence: job.evidence,
      });
      setVerified(true);
      setVerifier(verification.verifier);
      setVerdictSignature(verification.signature);
      const settlement = await postJson<{transactionHash: Hex; receiptId: Hex}>(
        "/api/demo/settle",
        {verdict: verification.verdict, signature: verification.signature},
      );
      setCompleteTransactionHash(settlement.transactionHash);
      setStatus(await readStatus(job.jobId));
      if (selectedWallet) {
        storeDemoState(historyScope, job, {
          verified: true,
          verifier: verification.verifier,
          verdictSignature: verification.signature,
          completeTransactionHash: settlement.transactionHash,
        });
      }
      setMessage("Verified evidence released 100 Mock USDC to the Provider.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setBusy(undefined);
    }
  }

  async function handleTamperedEvidence() {
    if (busy || restoring || (job && (!status || status.status < 3))) return;
    try {
      setBusy("Creating a separate tamper-test Job…");
      const failureJob = await createSubmittedFixtureJob("tampered");
      if (!failureJob.evidence) throw new Error("Fixture evidence was not created");
      const tamperedEvidence = {...failureJob.evidence, imageHash: TAMPERED_IMAGE_HASH};
      const response = await fetch("/api/demo/verify", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({evidence: tamperedEvidence}),
      });
      const payload = (await response.json()) as {error?: string};
      if (response.ok) throw new Error("Tampered evidence unexpectedly passed");
      setFailureJobId(failureJob.jobId.toString());
      setFailureMessage(payload.error ?? "EVIDENCE_HASH_MISMATCH");
      setMessage("Tampered evidence was rejected before settlement.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tamper demo failed");
    } finally {
      setBusy(undefined);
    }
  }

  const openJob = Boolean(job && (!status || status.status < 3));
  const canSwitchJob = ready && (walletsReady || Boolean(selectedWallet)) && authenticated && Boolean(selectedWallet && deployment) && !restoring && !busy && !reviewBusy;
  const canCreate = canSwitchJob && !openJob;
  const canOperate = authenticated && job?.source === "rover" && status?.status === 1 && !restoring && !busy;

  const receiveReview = useCallback((record: DemoReviewRecord) => {
    setDemoReview(record);
    if (!job || !selectedWalletAddress) return;
    const verifiedRecord = Boolean(record.verification);
    setVerified(verifiedRecord);
    setVerifier(record.verification?.verifier);
    setVerdictSignature(record.verification?.signature);
    setCompleteTransactionHash(record.completeTransactionHash);
    storeDemoState(historyScope, job, {verified: verifiedRecord, verifier: record.verification?.verifier,
      verdictSignature: record.verification?.signature, completeTransactionHash: record.completeTransactionHash});
    void readStatus(job.jobId).then(next => setStatus(current => current?.jobId === next.jobId ? next : current)).catch(() => {});
  }, [job, selectedWalletAddress, readStatus]);

  const explorerLink = (hash?: Hex) =>
    hash && deployment?.explorerUrl ? `${deployment.explorerUrl}/tx/${hash}` : undefined;

  const robotId = (demoReview?.context.jobId === job?.jobId.toString() ? demoReview?.evidence?.robotId : undefined)
    ?? job?.evidence?.robotId;
  const showRegisteredRobot = job?.source === "rover" && robotId === registeredRobot.robotId
    && deployment?.chainId === registeredRobot.chainId;

  const roverSettled = job?.source === "rover" && status?.status === 3;
  const verifierLabel = verifier?.attested ? t("TEE quote reported · not independently verified", "TEE quote取得・独立検証は未実施")
    : verifier?.simulated ? t("Simulation", "シミュレーション")
    : roverSettled ? t("Signed verdict recorded", "署名付き判定を記録") : t("Awaiting verification", "検証待ち");

  const challenge = job
    ? job.evidence?.challenge ?? expectedChallenge(job.jobId, job.scenario)
    : undefined;
  const attestationPath = verifier?.attestationPath
    ?? (verifierConfig?.attestationAvailable ? "/api/demo/attestation" : null);
  const signerAddress = verifier?.signerAddress ?? (roverSettled ? deployment?.mockTeeSigner : undefined);

  return <main className="shell">
    <SiteHeader />
    <section className="hero"><div>
      <h1>{t("Verified work.", "確かめた仕事に。 ")}<br />{t("Approved payment.", "承認して、支払いを。")}</h1>
      <p>{t("Create a job, operate the robot, then verify and pay.", "仕事を作成し、ロボットを操作。検証して支払いへ進みます。")}</p>
    </div><div className="login-card"><span>{t("YOUR ACCOUNT", "アカウント")}</span><strong>{selectedWallet ? short(selectedWallet.address, 8) : t("Not connected", "未接続")}</strong>
      {!ready || (!walletsReady && !selectedWallet) ? <button disabled>{t("Loading…", "読み込み中…")}</button> : authenticated ? <button className="secondary" onClick={() => logout()}>{t("Sign out", "ログアウト")}</button> : <button onClick={() => login()}>{t("Sign in", "ログイン")}</button>}
    </div></section>

    <section className="metric-grid">
      <article className="metric-card"><span>{t("YOUR BALANCE", "残高")}</span><strong>{status ? formatToken(status.clientBalance) : "—"} <small>mUSDC</small></strong><p>{short(selectedWallet?.address)}</p></article>
      <article className="metric-card accent"><span>{t("RESERVED REWARDS", "預かり報酬")}</span><strong>{status ? formatToken(status.escrowBalance) : "—"} <small>mUSDC</small></strong><p>{t("Held until verification", "検証が終わるまで保管")}</p></article>
      <article className="metric-card"><span>{t("PROVIDER BALANCE", "提供者の残高")}</span><strong>{status ? formatToken(status.providerBalance) : "—"} <small>mUSDC</small></strong><p>{short(deployment?.provider)}</p></article>
    </section>

    <section className="workspace-grid"><article className="panel flow-panel">
      <div className="panel-heading"><div><span className="eyebrow">{t("YOUR JOB", "仕事の状況")}</span><h2>{t("From work to payment", "仕事から支払いまで")}</h2></div><span className="job-pill">{job ? `#${job.jobId}` : t("NO JOB", "仕事なし")}</span></div>
      <JobProgress created={Boolean(job && status && status.status >= 1)} sample={job?.source === "fixture"} operated={job?.source === "rover" ? operationEnded || Boolean(demoReview?.authorizationSignature) : Boolean(status && status.status >= 2)} verified={verified || status?.status === 3} paid={status?.status === 3} />
      <div className="next-action">
        {restoring ? <p>{t("Loading your job…", "仕事を読み込んでいます…")}</p> : !authenticated ? <><p>{t("Sign in to create your first job.", "ログインして仕事を作成してください。")}</p><button onClick={() => login()} disabled={!ready}>{t("Sign in to begin", "ログインして開始")}</button></> : !openJob ? <><h3>{t(status?.status === 3 ? "Ready for the next job?" : "Start a robot job", status?.status === 3 ? "次の仕事を始めますか？" : "ロボットの仕事を始める")}</h3><p>{t("Reserve 100 mUSDC, then continue to robot controls.", "100 mUSDCを預けて、ロボットの操作に進みます。")}</p><button onClick={() => void handleStartRover()} disabled={!canCreate}>{t(job ? "Create new job" : "1. Create job", job ? "新しい仕事を作成" : "1. 仕事を作成")}</button></> : canOperate ? <>
          <h3>{t(operationEnded ? "Control session ended" : "Your robot is next", operationEnded ? "操作セッションが終了しました" : "次はロボットを操作")}</h3>
          <p>{operationEnded ? t("Continue with verification and payment below.", "下の「検証して支払う」へ進んでください。") : t("Your job number is carried over automatically.", "仕事番号は自動で引き継がれます。")}</p>
          {!operationEnded && !demoReview?.authorizationSignature && <Link className="primary-link" href={{pathname:"/rover", query:{job:job!.jobId.toString()}}}>{t("2. Operate robot", "2. ロボットを操作")} <span>→</span></Link>}
        </> : <p>{t(job?.source === "fixture" ? "Continue with the payment simulation below." : "Waiting for the job status to update.", job?.source === "fixture" ? "下の支払いシミュレーションを続けてください。" : "仕事の状態の更新を待っています。")}</p>}
      </div>
      {job?.source === "rover" && selectedWallet && <DemoReview key={`${selectedWallet.address}:${job.createTransactionHash}`} jobId={job.jobId.toString()} wallet={selectedWallet} available={operationEnded || status?.status === 2} closed={Boolean(status && status.status >= 3)} onRecord={receiveReview} onBusyChange={setReviewBusy} />}
      <details className="optional-tools"><summary>{t("Other options", "その他の操作")}</summary>
      <section className="sample-tools"><h3>{t("Start another job", "新しい仕事を始める")}</h3>
        <p>{t("Keep this job in history and reserve 100 mUSDC for a new one. Switching does not refund the previous job.", "現在の仕事を履歴に残し、新しい仕事に100 mUSDCを預けます。前の仕事の報酬は自動返金されません。")}</p>
        <button className="secondary" disabled={!canSwitchJob} onClick={() => void handleStartRover(true)}>{t("Create new job", "新しい仕事を作成")}</button>
        {history.length > 0 && <><h3 className="job-history-heading">{t("Saved jobs", "保存した仕事")}</h3><ul className="job-history">{history.map(saved => <li key={`${saved.job.createTransactionHash}:${saved.job.jobId}`}>
          <span>#{saved.job.jobId} · {t(saved.status ? jobStatusNames[saved.status.status] : "Waiting")}{saved.status && saved.status.status < 3 ? " · 100 mUSDC" : ""}</span>
          <button className="secondary" disabled={!canSwitchJob || saved.job.createTransactionHash === job?.createTransactionHash} onClick={() => void handleSelectJob(saved)}>{t(saved.job.createTransactionHash === job?.createTransactionHash ? "Current job" : "Open job", saved.job.createTransactionHash === job?.createTransactionHash ? "表示中" : "仕事を開く")}</button>
        </li>)}</ul></>}
      </section>
      <div className="free-drive-card"><div><strong>{t("Just want to drive?", "操作だけ楽しみたい方へ")}</strong><p>{t("No job or deposit needed.", "仕事の作成・入金は不要です。")}</p></div><Link className="free-drive-link" href="/rover">{t("Free drive", "自由に操作")} →</Link></div>
      <section className="sample-tools"><h3>{t("Payment simulation", "支払いシミュレーション")}</h3><p>{t("Sample evidence only · separate from robot jobs", "サンプル証拠を使う、ロボットの仕事とは別のデモ")}</p><div className="actions">
        <button className="secondary" onClick={handleStartFixture} disabled={!canCreate}>{t("Create sample job", "サンプルの仕事を作成")}</button>
        <button className="verify" onClick={handleValidEvidence} disabled={!authenticated || job?.source !== "fixture" || !job?.evidence || status?.status !== 2 || Boolean(busy) || restoring}>{t("Verify sample & pay", "サンプルを検証して支払う")}</button>
        <button className="danger" onClick={handleTamperedEvidence} disabled={!canCreate}>{t("Test invalid evidence", "不正な証拠を試す")}</button>
      </div></section>
      </details>
      <div className="message-bar"><span className={busy ? "pulse" : "status-dot"} />{t(busy ?? (authenticated && message === "Sign in to manage your jobs." ? "Ready to review your jobs." : message))}</div>
    </article>
    <article className="panel proof-panel"><div className="panel-heading"><div><span className="eyebrow">{t("RECEIPT", "領収書")}</span><h2>{t("Payment & evidence", "支払いと証拠")}</h2></div><span className={`status ${status?.status === 3 ? "success" : ""}`}>{t(status ? jobStatusNames[status.status] : "Waiting")}</span></div>
      <dl className="proof-list">
        <div><dt>{t("Job", "仕事")}</dt><dd>{job ? `#${job.jobId}` : "—"}</dd></div>
        <div><dt>{t("Evidence source", "証拠の種類")}</dt><dd>{demoReview?.authorizationSignature ? t("Signed approval document", "署名付き承認文書") : job?.source === "fixture" ? t("Sample", "サンプル") : job ? t("Robot adapter", "ロボット中継") : "—"}</dd></div>
        <div><dt>{t("Receipt ID", "領収書ID")}</dt><dd>{status?.receiptId !== ZERO_BYTES32 ? short(status?.receiptId,10) : "—"}</dd></div>
        <div><dt>{t("Payment transaction", "支払い取引")}</dt><dd>{explorerLink(completeTransactionHash) ? <a href={explorerLink(completeTransactionHash)} target="_blank" rel="noreferrer">{short(completeTransactionHash)} ↗</a> : <span title={completeTransactionHash}>{short(completeTransactionHash,10)}</span>}</dd></div>
        <div><dt>{t("Attestation", "実行環境の証明")}</dt><dd>{attestationPath ? <a href={attestationPath} target="_blank" rel="noreferrer">{t("View report", "レポートを見る")} ↗</a> : "—"}</dd></div>
        <div><dt>{t("Job transaction", "仕事の作成取引")}</dt><dd>{explorerLink(job?.createTransactionHash) ? <a href={explorerLink(job?.createTransactionHash)} target="_blank" rel="noreferrer">{short(job?.createTransactionHash)} ↗</a> : <span title={job?.createTransactionHash}>{short(job?.createTransactionHash,10)}</span>}</dd></div>
      </dl>
      <details className="sample-tools"><summary>{t("Verification details", "検証の詳細")}</summary><dl className="proof-list">
        <div><dt>{t("Robot ID in evidence", "証拠内のロボットID")}</dt><dd title={robotId}>{robotId ?? "—"}</dd></div>
        {showRegisteredRobot && <>
          <div><dt>{t("Registered robot · ENS", "登録機体・ENS")}</dt><dd><a href={registeredRobot.recordUrl} target="_blank" rel="noreferrer">{registeredRobot.ensName} ↗</a></dd></div>
          <div><dt>{t("Registered key ID · SHA-256", "登録機体鍵ID・SHA-256")}</dt><dd><a href={registeredRobot.recordUrl} target="_blank" rel="noreferrer" title={registeredRobot.keyId}>{short(registeredRobot.keyId, 10)} ↗</a></dd></div>
          <div><dt>{t("Device signature verifier", "機体署名の検証Contract")}</dt><dd><a href={registeredRobot.verifierUrl} target="_blank" rel="noreferrer">ERC-7913 · Sepolia ↗</a></dd></div>
          <div><dt>{t("Device signature · this job", "このJobの機体署名")}</dt><dd>{t("Not checked", "未照合")}</dd></div>
        </>}
        {demoReview?.authorizationSignature && <div><dt>{t("Verification scope", "検証の対象")}</dt><dd>{t("Signed approval document", "署名付き承認文書")}</dd></div>}
        {demoReview?.authorizationSignature && <div><dt>{t("Physical movement proof", "実移動の証明")}</dt><dd>{t("Not included in this demo", "このデモの検証対象外")}</dd></div>}
        <div><dt>{t("Evidence", "証拠")}</dt><dd>{short(status?.evidenceCommitment,10)}</dd></div>
        <div><dt>{t("Signature", "署名")}</dt><dd>{short(verdictSignature,10)}</dd></div>
        <div><dt>{t("Verifier", "検証者")}</dt><dd>{verifierLabel}</dd></div>
        <div><dt>{t("Signer", "署名者")}</dt><dd>{short(signerAddress,10)}</dd></div>
        <div><dt>{t("Challenge", "チャレンジ")}</dt><dd>{challenge ?? "—"}</dd></div>
      </dl></details>
      {failureMessage && <div className="tamper-result visible"><span>{t("PAYMENT BLOCKED", "支払い停止")}</span><strong>{t("Evidence rejected", "証拠を拒否")}: {failureMessage}</strong><small>{t("No receipt was issued for job", "領収書は未発行です。仕事")} #{failureJobId}</small></div>}
    </article></section>
  </main>;
}
