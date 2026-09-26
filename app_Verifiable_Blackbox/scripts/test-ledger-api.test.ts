import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {TransactionReceiptData} from "@curvegrid/multibaas-sdk";
import {fixture, h} from "./ledger-fixture.ts";
import {contracts, selection, settings} from "../apps/web/lib/server/curvegrid/config.ts";
import {fetchSnapshot, safeError, type client} from "../apps/web/lib/server/curvegrid/fetch.ts";
import {LedgerState} from "../apps/web/lib/server/curvegrid/state.ts";
import {requireLocal} from "../apps/web/lib/server/curvegrid/http.ts";
const config = settings({MULTIBAAS_URL:"https://unit-test.multibaas.com",MULTIBAAS_API_KEY:"secret"});
function setup() {
  const f=fixture();
  const chosen={...selection,jobs:[{jobId:"9",source:"fixture",transactions:[h(1),h(2),h(3)]}]};
  const receipts=Object.fromEntries([1,2,3].map(tx=>[h(tx),{status:"0x1",transactionHash:h(tx),blockHash:h(99+tx),blockNumber:`0x${(99+tx).toString(16)}`,logs:f.events.filter(e=>e.txHash===h(tx)).map(e=>e.raw)}])) as Record<string,TransactionReceiptData>;
  const response=(result:unknown)=>Promise.resolve({data:{status:200,result}});
  const api={getChainStatus:()=>response({chainID:contracts.chainId,blockNumber:120}),
    getBlock:(n:string)=>response({hash:h(Number(n)),timestamp:Date.parse("2026-09-26T01:00:00Z")/1000}),
    getTransactionReceipt:(tx:string)=>response({data:receipts[tx]})} as unknown as ReturnType<typeof client>;
  return {api,chosen,receipts};
}
test("selected receipt reads match payment; empty selection is empty",async()=>{
  const f=setup();const s=await fetchSnapshot(config,f.api,f.chosen);
  assert.equal(s.payments[0].status,"matched");assert.equal(s.payments.length,1);
  assert.equal((await fetchSnapshot(config,f.api,{...f.chosen,jobs:[]})).payments.length,0);
  assert.ok(!JSON.stringify(s).includes('secret'));
});
test("wrong chain, cutoff, receipt identity and reorg are rejected",async()=>{
  const a=setup();a.api.getChainStatus=(async()=>({data:{status:200,result:{chainID:1,blockNumber:120}}})) as never;
  await assert.rejects(()=>fetchSnapshot(config,a.api,a.chosen),/WRONG_CHAIN/);
  const b=setup();await assert.rejects(()=>fetchSnapshot(config,b.api,{...b.chosen,cutoffExclusive:"2026-09-26T00:00:00Z"}),/CUTOFF/);
  const c=setup();c.receipts[h(3)].logs[0].transactionHash=h(55);await assert.rejects(()=>fetchSnapshot(config,c.api,c.chosen),/RECEIPT/);
  const d=setup();d.receipts[h(3)].blockHash=h(99);await assert.rejects(()=>fetchSnapshot(config,d.api,d.chosen),/REORG/);
});
test("missing evidence and pending confirmations have distinct states",async()=>{
  const f=setup();f.chosen.jobs[0].transactions=[h(3)];
  assert.equal((await fetchSnapshot(config,f.api,f.chosen)).payments[0].status,"incomplete");
  const g=setup();g.api.getChainStatus=(async()=>({data:{status:200,result:{chainID:contracts.chainId,blockNumber:105}}})) as never;
  assert.equal((await fetchSnapshot(config,g.api,g.chosen)).payments[0].status,"confirming");
});
test("save, restore, fingerprint isolation, failure and cooldown",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"vbb-ledger-"));
  try {
    const f=setup();const snapshot=await fetchSnapshot(config,f.api,{...f.chosen,jobs:[]});
    const state=new LedgerState(config,dir,async()=>snapshot);
    await state.load();assert.equal(state.state,"ready");
    await state.refresh();assert.equal(state.state,"empty");
    const restored=new LedgerState(config,dir,async()=>{throw Error("secret-url")});
    await restored.load();assert.equal(restored.state,"cached");
    await assert.rejects(()=>restored.refresh(),/RATE_LIMIT/);
    await writeFile(restored.path+".attempt","0");await restored.refresh();
    assert.equal(restored.state,"cached");assert.equal(restored.error,"FETCH_FAILED");
    assert.ok(!JSON.stringify(restored.publicState()).includes("secret-url"));
    const data=JSON.parse(await readFile(restored.path,"utf8"));data.fingerprint="invalid";
    await writeFile(restored.path,JSON.stringify(data));
    await restored.load();assert.equal(restored.snapshot,null);
    const notConfigured=new LedgerState(settings({}),dir);await notConfigured.load();await notConfigured.refresh();
    assert.equal(notConfigured.state,"not_configured");
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("concurrent refresh and retained lock refuse duplicate reads",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"vbb-ledger-"));
  try {
    const f=setup();const snapshot=await fetchSnapshot(config,f.api,{...f.chosen,jobs:[]});
    let release!:()=>void;const gate=new Promise<void>(r=>{release=r});
    const state=new LedgerState(config,dir,async()=>{await gate;return snapshot});
    const first=state.refresh();await assert.rejects(()=>state.refresh(),/BUSY/);release();await first;
    await writeFile(state.path+".lock","");await assert.rejects(()=>state.refresh(),/BUSY/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("refresh requires loopback same origin; upstream messages are sanitized",()=>{
  const req=(origin:string,host="127.0.0.1:3000")=>new Request("http://localhost:3000/api/ledger/refresh",{headers:{host,origin}});
  assert.doesNotThrow(()=>requireLocal(req("http://127.0.0.1:3000"),true));
  assert.throws(()=>requireLocal(req("https://other.example"),true));
  assert.throws(()=>requireLocal(req("http://public.example","public.example"),true));
  assert.equal(safeError({response:{status:403},message:"secret"}),"AUTH");
});
