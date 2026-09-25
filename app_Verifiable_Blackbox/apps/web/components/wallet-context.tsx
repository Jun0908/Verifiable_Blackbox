"use client";
import {createContext, useContext, useMemo, useState, type ReactNode} from "react";
import {usePrivy, useWallets, useSendTransaction, type ConnectedWallet} from "@privy-io/react-auth";
import {createWalletClient, http, type Address, type Hex} from "viem";
import {useLanguage} from "./language";

type Wallet = Pick<ConnectedWallet, "address" | "walletClientType" | "switchChain" | "getEthereumProvider">;
type WalletState = {
  ready:boolean; authenticated:boolean; login():void; logout():void;
  wallets:Wallet[];
  sendTransaction(tx:{to:Address; data:Hex}, options?:unknown):Promise<{hash:Hex}>;
};
const WalletContext = createContext<WalletState | null>(null);
export function useDemoWallet() {
  const value=useContext(WalletContext);
  if(!value) throw Error('Wallet provider missing');
  return value;
}
export function PrivyWalletBridge({children}:{children:ReactNode}) {
  const {ready,authenticated,login,logout}=usePrivy();
  const {wallets,ready:walletsReady}=useWallets();
  const {sendTransaction}=useSendTransaction();
  return <WalletContext.Provider value={{ready:ready && walletsReady,authenticated,login,logout,wallets,sendTransaction:(tx,options)=>sendTransaction(tx,options as Parameters<typeof sendTransaction>[1])}}>{children}</WalletContext.Provider>;
}

export function LocalWalletProvider({children}:{children:ReactNode}) {
  const {t}=useLanguage();
  const [authenticated,setAuthenticated]=useState(false);
  const wallet=useMemo(()=>{
    const rpc=process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';
    const endpoint=new URL(rpc);
    if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname) || endpoint.protocol!=='http:') throw Error('Local wallet requires a loopback Anvil RPC');
    const address='0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
    const client=createWalletClient({account:address,transport:http(rpc)});
    async function ensureLocal() {if(await client.getChainId()!==31337)throw Error('Local test wallet requires chain 31337');}
    const provider={on:()=>{}, removeListener:()=>{}, request:async({method,params}:{method:string;params?:unknown})=>{
      await ensureLocal();
      return client.request({method,params} as Parameters<typeof client.request>[0]);
    }} as Awaited<ReturnType<Wallet["getEthereumProvider"]>>;
    return {address,walletClientType:'anvil-test',switchChain:async(id:number|Hex)=>{if(Number(id)!==31337)throw Error('Local chain only');await ensureLocal();},getEthereumProvider:async()=>provider,
      sendTransaction:async(tx:{to:Address;data:Hex})=>{await ensureLocal();return {hash:await client.sendTransaction({...tx,chain:null})};}};
  },[]);
  return <WalletContext.Provider value={{ready:true,authenticated,login:()=>setAuthenticated(true),logout:()=>setAuthenticated(false),wallets:authenticated?[wallet]:[],sendTransaction:wallet.sendTransaction}}>
    <aside className="sample-notice" role="status">{t('LOCAL DEMO · Public Anvil test wallet · Test tokens only · No personal wallet or physical work is verified.', 'ローカルデモ · 公開AnvilテストWallet · テストトークンのみ · 本人のWalletや物理作業は検証しません。')}</aside>
    {children}
  </WalletContext.Provider>;
}
