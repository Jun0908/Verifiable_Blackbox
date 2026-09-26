"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {createWalletClient, custom, formatEther, type Address} from "viem";
import type {ConnectedWallet} from "@privy-io/react-auth";
import type {DemoDeployment} from "@/lib/contracts";
import type {GasStatus} from "@/lib/gas-funding";
import {useLanguage} from "./language";

type Wallet = Pick<ConnectedWallet, "address" | "getEthereumProvider">;

async function fetchStatus(address: string): Promise<GasStatus> {
  const response = await fetch(`/api/demo/faucet?address=${encodeURIComponent(address)}`, {cache: "no-store"});
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "GAS_STATUS_UNAVAILABLE");
  return body;
}

export function useDemoGas(wallet: Wallet | undefined, deployment: DemoDeployment | undefined, authenticated: boolean) {
  const address = authenticated ? wallet?.address : undefined;
  const enabled = deployment?.chainId === 11155111 && Boolean(address);
  const [status, setStatus] = useState<GasStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const scope = `${deployment?.chainId}:${address}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !address) return;
    const next = await fetchStatus(address);
    if (currentScope.current === scope) {setStatus(next); setError(undefined);}
    return next;
  }, [enabled, address, scope]);

  useEffect(() => {
    setStatus(undefined); setError(undefined);
    if (!enabled) return;
    let cancelled = false;
    let fetching = false;
    const update = async () => {
      if (fetching || inFlight.current) return;
      fetching = true;
      try {await refresh();}
      catch {if (!cancelled) setError("GAS_STATUS_UNAVAILABLE");}
      finally {fetching = false;}
    };
    void update();
    const timer = window.setInterval(update, 15_000);
    window.addEventListener("focus", update);
    return () => {cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", update);};
  }, [enabled, refresh]);

  async function ensure() {
    if (!enabled) return;
    if (!wallet || !address || inFlight.current) throw Error("GAS_REQUEST_IN_PROGRESS");
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const fresh = await fetchStatus(address);
      if (currentScope.current !== scope) throw Error("GAS_WALLET_CHANGED");
      setStatus(fresh);
      if (fresh.ready) return;
      if (!fresh.available && fresh.reason !== "pending") throw Error(`GAS_${fresh.reason!.toUpperCase().replaceAll("-", "_")}`);
      const signer = createWalletClient({account: address as Address, transport: custom(await wallet.getEthereumProvider())});
      const signature = await signer.signMessage({message: fresh.message});
      if (currentScope.current !== scope) throw Error("GAS_WALLET_CHANGED");
      const response = await fetch("/api/demo/faucet", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({address, day: fresh.day, signature})});
      const next = await response.json();
      if (!response.ok) throw Error(next.error || "GAS_FUNDING_FAILED");
      if (currentScope.current !== scope) throw Error("GAS_WALLET_CHANGED");
      setStatus(next);
      if (!next.ready) throw Error("GAS_HIGH_FEES");
    } catch (cause) {
      const code = cause instanceof Error && /^GAS_[A-Z_]+$/.test(cause.message) ? cause.message : "GAS_FUNDING_FAILED";
      if (currentScope.current === scope) setError(code);
      throw Error(code);
    } finally {inFlight.current = false; setBusy(false);}
  }
  return {enabled, status: status?.address.toLowerCase() === address?.toLowerCase() ? status : undefined, error, busy, ensure, refresh};
}

export function DemoGasPanel({gas}: {gas: ReturnType<typeof useDemoGas>}) {
  const {t} = useLanguage();
  const {status, error, busy} = gas;
  if (!gas.enabled) return null;
  const reason = error || (status?.reason ? `GAS_${status.reason.toUpperCase().replaceAll("-", "_")}` : undefined);
  const explanation = reason === "GAS_POOL_EMPTY" ? t("The demo gas pool needs a refill. Send Sepolia ETH to the pool address below.", "配布用の残高が不足しています。下のプールアドレスへ Sepolia ETH を補充してください。")
    : reason === "GAS_DAILY_LIMIT" ? t("This wallet already received gas today (UTC). You can also send Sepolia ETH directly to your wallet.", "このウォレットは本日（UTC）補充済みです。自分のウォレットへ Sepolia ETH を直接送金することもできます。")
    : reason === "GAS_BUDGET_LIMIT" ? t("Today's demo gas budget has been reached. Send Sepolia ETH directly to your wallet or wait until tomorrow (UTC).", "本日分の配布上限に達しました。自分のウォレットへ直接送金するか、翌日（UTC）に再試行してください。")
    : reason === "GAS_PENDING" || reason === "GAS_TRANSACTION_PENDING" || reason === "GAS_REQUEST_IN_PROGRESS" ? t("A gas transfer is being confirmed. Retry to check the same transfer.", "Gas の送金を確認中です。再試行すると同じ送金の状態を確認します。")
    : reason === "GAS_DISABLED" || reason === "GAS_FAUCET_DISABLED" ? t("Demo gas funding is not configured. Send Sepolia ETH to your wallet below.", "Gas 補充が未設定です。下の自分のウォレットへ Sepolia ETH を送金してください。")
    : reason === "GAS_HIGH_FEES" ? t("Network fees exceed the demo allowance. Wait for lower fees or fund your wallet directly.", "現在の手数料がデモの補充上限を超えています。時間を置くか、自分のウォレットへ直接送金してください。")
    : reason ? t("Gas funding could not finish. Check the wallet signature and retry.", "Gas の確認・補充が完了しませんでした。ウォレットの署名を確認して再試行してください。") : undefined;
  return <section className="panel demo-gas" aria-label={t("Sepolia gas", "Sepolia の Gas")}>
    <div><span className="eyebrow">{t("JOB GAS · SEPOLIA ETH", "Job の Gas · Sepolia ETH")}</span>
      <strong>{status ? `${Number(formatEther(BigInt(status.balanceWei))).toFixed(6)} ETH` : t("Checking…", "確認中…")}</strong>
      <p>{status?.ready ? t("Gas is ready. You can create a job.", "Gas を確認しました。仕事を作成できます。") : t("Get demo gas before creating a job. Signing this request costs no gas.", "仕事を作成する前にデモ用 Gas を補充できます。補充の署名に Gas は不要です。")}</p>
      {!status?.ready && explanation && <p role="status">{explanation}</p>}
    </div>
    {!status?.ready && <button disabled={busy || !status || (!status.available && status.reason !== "pending")} onClick={() => void gas.ensure().catch(() => {})}>
      {busy ? t("Confirming gas…", "Gas の補充を確認中…") : status?.reason === "pending" ? t("Check gas transfer", "Gas 送金を再確認") : t("Get demo gas", "デモ用 Gas を補充")}
    </button>}
    <details><summary>{t("Wallet & gas pool", "ウォレットと Gas の補充先")}</summary>
      <p>{t("Your wallet (Sepolia ETH)", "自分のウォレット（Sepolia ETH）")}</p><code>{status?.address}</code>
      {status?.poolAddress && <><p>{t("Demo gas pool · refill address", "デモ用 Gas プール・補充先")}</p><code>{status.poolAddress}</code>
        <p>{t("Pool balance", "プール残高")}: {Number(formatEther(BigInt(status.poolBalanceWei || "0"))).toFixed(6)} ETH</p></>}
      <p>{t("Job rewards use 100 mUSDC test tokens, created with the job. Gas uses Sepolia ETH.", "報酬の 100 mUSDC は仕事作成時に発行されるテスト用トークンです。Gas は Sepolia ETH で支払います。")}</p>
      {status?.transactionHash && <a href={`https://sepolia.etherscan.io/tx/${status.transactionHash}`} target="_blank" rel="noreferrer">{t("Gas transfer ↗", "Gas の送金履歴 ↗")}</a>}
      <button className="secondary" disabled={busy} onClick={() => void gas.refresh().catch(() => {})}>{t("Refresh balance", "残高を再確認")}</button>
    </details>
  </section>;
}
