import test from "node:test";
import assert from "node:assert/strict";
import {encodeEventTopics, encodeAbiParameters, type Hex, type AbiEvent} from "viem";
import type {Event as MBEvent, TransactionReceiptData} from "@curvegrid/multibaas-sdk";
import {ledgerAbi} from "../apps/web/lib/ledger/contracts.ts";
import {normalizeEvent, deduplicate, buildLedger, type LedgerEvent} from "../apps/web/lib/ledger/payment-ledger.ts";
import data from "../apps/web/lib/ledger/selection.json" with {type:"json"};
const contracts=data.contracts;
const provider="0x1111111111111111111111111111111111111111",client="0x2222222222222222222222222222222222222222";
const h=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as Hex;
function mbEvent(name:string,emitter:string,args:Record<string,unknown>,block:number,tx:number,index:number):MBEvent {
  const abi=ledgerAbi.find(event=>event.name===name)! as AbiEvent;
  const inputs=abi.inputs.filter(input=>!input.indexed);
  const topics=encodeEventTopics({abi:[abi],eventName:name,args} as never);
  const data=encodeAbiParameters(inputs,inputs.map(input=>args[input.name!]));
  return {triggeredAt:"2026-09-22T01:00:00Z",event:{name,rawFields:JSON.stringify({address:emitter,topics,data,blockNumber:`0x${block.toString(16)}`,transactionHash:h(tx),blockHash:h(block),logIndex:`0x${index.toString(16)}`,removed:false}),contract:{address:emitter},indexInLog:index},transaction:{txHash:h(tx),blockHash:h(block),blockNumber:block}} as MBEvent;
}
function fixture(){
  const entries=[
    mbEvent("JobCreated",contracts.core,{jobId:9n,client,provider,evaluator:contracts.evaluators[0],expiredAt:9999999999n,hook:contracts.hook},100,1,0),
    mbEvent("JobFunded",contracts.core,{jobId:9n,client,amount:100000000n},100,1,1),
    mbEvent("EvidenceCommitted",contracts.hook,{jobId:9n,evidenceCommitment:h(999)},101,2,0),
    mbEvent("Transfer",contracts.token,{from:contracts.core,to:provider,value:98000000n},102,3,0),
    mbEvent("PaymentReleased",contracts.core,{jobId:9n,provider,amount:98000000n},102,3,1),
    mbEvent("DemoWorkReceiptIssued",contracts.evaluators[0],{receiptId:h(888),jobId:9n,provider,evidenceCommitment:h(999),verdictDigest:h(777),verdictSigner:client},102,3,2)
  ];
  const events=entries.map(e=>({...normalizeEvent(e)!,canonical:true}));
  const receipt={status:"0x1",transactionHash:h(3),blockHash:h(102),blockNumber:"0x66",logs:events.filter(e=>e.txHash===h(3)).map(e=>e.raw)} as TransactionReceiptData;
  return {events,receipts:{[h(3)]:receipt},entries};
}
const ledger=(events:LedgerEvent[],receipts:Record<string,TransactionReceiptData>,head=120)=>buildLedger(events,receipts,contracts,head,12);
test("MultiBaasの表示値ではなくraw ABIから整数金額を復元",()=>{
  const f=fixture();const payment=f.events.find(e=>e.name==='PaymentReleased')!;assert.equal(payment.args.amount,'98000000');
  const result=ledger(f.events,f.receipts)[0];assert.equal(result.status,'matched');assert.equal(result.amountDisplay,'98.00');assert.equal(result.fundedMinor,'100000000');assert.ok(result.checks.every(c=>c.ok));
});
test("再取得したログで支払いが二重計上されない",()=>{const f=fixture();assert.equal(ledger([...f.events,...f.events],f.receipts).length,1);});
test("偽の発行元・メタデータを拒否",()=>{const f=fixture();const altered=structuredClone(f.entries[0]);altered.event.contract.address=provider;assert.throws(()=>normalizeEvent(altered));});
test("Evidence不一致は照合済みにならない",()=>{const f=fixture();f.events.find(e=>e.name==='EvidenceCommitted')!.args.evidenceCommitment=h(123);assert.equal(ledger(f.events,f.receipts)[0].status,'mismatch');});
test("別のEvaluator、別取引のReceiptを流用しない",()=>{const f=fixture();f.events.find(e=>e.name==='DemoWorkReceiptIssued')!.txHash=h(7);assert.equal(ledger(f.events,f.receipts)[0].status,'incomplete');});
test("Token送金と成功receiptの両方が必要",()=>{const f=fixture();assert.equal(ledger(f.events.filter(e=>e.name!=='Transfer'),f.receipts)[0].status,'incomplete');f.receipts[h(3)].status='0x0';assert.equal(ledger(f.events,f.receipts)[0].status,'mismatch');});
test("受取先不一致・同じJobへの複数支払いを検知",()=>{const f=fixture();f.events.find(e=>e.name==='JobCreated')!.args.provider=client;assert.equal(ledger(f.events,f.receipts)[0].status,'mismatch');
  const fresh=fixture(),payment=fresh.events.find(e=>e.name==='PaymentReleased')!;assert.ok(ledger([...fresh.events,{...payment,txHash:h(90)}],fresh.receipts).every(p=>p.status==='mismatch'));});
test("reorgと確認数不足を区別",()=>{const f=fixture();assert.equal(ledger(f.events,f.receipts,105)[0].status,'confirming');f.events.find(e=>e.name==='PaymentReleased')!.canonical=false;assert.equal(ledger(f.events,f.receipts)[0].status,'mismatch');});
test("同じtx/logの内容が変わった場合は再同期が必要",()=>{const f=fixture();assert.throws(()=>deduplicate([...f.events,{...f.events[0],blockHash:h(444)}],contracts.chainId));});
