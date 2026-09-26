"use client";
import type {ReactNode} from "react";
import {WalletContext} from "./wallet-context";
import {useLanguage} from "./language";

export function PreviewWalletProvider({children}:{children:ReactNode}) {
  const {t}=useLanguage();
  return <WalletContext.Provider value={{ready:true,authenticated:false,wallets:[],login:()=>{},logout:()=>{},
    getAccessToken:async()=>null,getIdentityToken:async()=>null,
    sendTransaction:async()=>{throw Error("PUBLIC_PREVIEW_READ_ONLY");}}}>
    <aside className="sample-notice" role="status">{t("PUBLIC PREVIEW · Explore monthly samples and saved videos. Robot control, reanalysis and payments run in the local demo.","公開プレビュー · 月次サンプルと保存済み映像を閲覧できます。実機操作・再解析・支払いはローカルデモで実行します。")}</aside>
    {children}
  </WalletContext.Provider>;
}
