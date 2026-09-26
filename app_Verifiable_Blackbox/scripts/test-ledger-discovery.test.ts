import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Log} from "viem";
import {fixture,h} from "./ledger-fixture.ts";
import {contracts} from "../apps/web/lib/server/curvegrid/config.ts";
import {discoverSelection,selectCompletedJobs} from "../apps/web/lib/server/curvegrid/discovery.ts";
const cutoff="2026-09-27T00:00:00Z";
const logs=fixture().events.map(event=>({...event.raw,blockNumber:BigInt(event.raw.blockNumber),logIndex:Number(BigInt(event.raw.logIndex))})) as Log[];
test("discovers a completed Job beyond the seed and deduplicates its transactions",()=>{
  const selected=selectCompletedJobs([...logs,...logs],contracts,cutoff);
  assert.deepEqual(selected.jobs,[{jobId:"9",source:"chain-discovery",transactions:[h(1),h(2),h(3)]}]);
  assert.deepEqual(selectCompletedJobs(logs.filter(log=>log.blockNumber!==102n),contracts,cutoff).jobs,[]);
  assert.deepEqual(selectCompletedJobs(logs.map(log=>({...log,address:"0x"+"ab".repeat(20)})),contracts,cutoff).jobs,[]);
  assert.deepEqual(selectCompletedJobs(logs.map(log=>({...log,removed:true})),contracts,cutoff).jobs,[]);
});
test("incremental discovery retains unpaid Job context, restores its cache and rebuilds on reorg",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"vbb-discovery-"));
  const ranges:[bigint,bigint][]=[];let reorg=false;
  const rpc={getChainId:async()=>11155111,getBlock:async({blockNumber}:{blockNumber:bigint})=>({hash:reorg?h(999):h(Number(blockNumber))}),
    getLogs:async({fromBlock,toBlock}:{fromBlock:bigint;toBlock:bigint})=>{
      ranges.push([fromBlock,toBlock]);assert.ok(toBlock-fromBlock<10n);
      return logs.filter(log=>log.blockNumber!>=fromBlock&&log.blockNumber!<=toBlock);
    }} as never;
  try {
    assert.equal((await discoverSelection(contracts,100,101,h(101),cutoff,rpc,directory)).jobs.length,0);
    ranges.length=0;
    const paid=await discoverSelection(contracts,100,102,h(102),cutoff,rpc,directory);
    assert.equal(paid.jobs[0].transactions.length,3);assert.deepEqual(ranges,[[102n,102n]]);
    ranges.length=0;
    assert.equal((await discoverSelection(contracts,100,102,h(102),cutoff,rpc,directory)).jobs.length,1);
    assert.deepEqual(ranges,[]);
    reorg=true;
    await discoverSelection(contracts,100,103,h(999),cutoff,rpc,directory);
    assert.deepEqual(ranges,[[100n,103n]]);
    await assert.rejects(()=>discoverSelection(contracts,100,103,h(103),cutoff,rpc,directory),/REORG/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
