"use client";

import {PrivyProvider} from "@privy-io/react-auth";
import {defineChain} from "viem";
import {useLanguage} from "@/components/language";
import {SiteHeader} from "@/components/site-header";
import type {ReactNode} from "react";
import {LocalWalletProvider, PrivyWalletBridge} from "@/components/wallet-context";
import {PreviewWalletProvider} from "@/components/preview-wallet";
import {publicPreview} from "@/lib/public-preview";

export function Providers({children}: {children: ReactNode}) {
  const {t} = useLanguage();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";

  if (publicPreview) return <PreviewWalletProvider>{children}</PreviewWalletProvider>;

  if (process.env.NEXT_PUBLIC_LOCAL_DEMO === "true" && chainId === 31337) {
    return <LocalWalletProvider>{children}</LocalWalletProvider>;
  }

  if (!appId) {
    return (
      <main className="configuration-page">
        <div className="configuration-card">
          <SiteHeader /><span className="eyebrow">{t("SETUP REQUIRED", "設定が必要です")}</span>
          <h1>{t("Set up your sign-in provider", "ログインの設定をしてください")}</h1>
          <p>{t("Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env.local to enable the dashboard.", "apps/web/.env.localにNEXT_PUBLIC_PRIVY_APP_IDを設定すると画面を利用できます。")}</p>
        </div>
      </main>
    );
  }

  const demoChain = defineChain({
    id: chainId,
    name:
      chainId === 31337
        ? "Anvil"
        : chainId === 11155111
          ? "Ethereum Sepolia"
          : "VBB Demo Chain",
    nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: [rpcUrl]}},
  });

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        loginMethods: ["email", "passkey", "wallet"],
        embeddedWallets: {
          ethereum: {createOnLogin: "users-without-wallets"},
        },
        defaultChain: demoChain,
        supportedChains: [demoChain],
        appearance: {
          theme: "dark",
          accentColor: "#86f7c5",
          logo: "https://auth.privy.io/logos/privy-logo-dark.png",
        },
      }}
    >
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}
