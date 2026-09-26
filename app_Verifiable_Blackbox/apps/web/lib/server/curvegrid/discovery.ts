import "server-only";
import {decodeEventLog, type Address, type Log} from "viem";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, writeFile, rename} from "node:fs/promises";
import {resolve} from "node:path";
import {getPublicClient} from "../config";
import {ledgerAbi} from "@/lib/ledger/contracts";
import {validateSelection, type Contracts, type Selection} from "@/lib/ledger/types";

export function selectCompletedJobs(logs: Log[], contracts: Contracts, cutoffExclusive: string): Selection {
  const jobs = new Map<string,{paid:boolean; transactions:Set<string>}>();
  for (const log of logs) {
    if (log.removed || !log.transactionHash) continue;
    let event;
    try {event = decodeEventLog({abi:ledgerAbi,topics:log.topics,data:log.data,strict:true});} catch {continue;}
    const expected = event.eventName === "EvidenceCommitted" ? contracts.hook : contracts.core;
    if (log.address.toLowerCase() !== expected.toLowerCase() || !["JobCreated","JobFunded","EvidenceCommitted","PaymentReleased"].includes(event.eventName)) continue;
    const id = (event.args as {jobId:bigint}).jobId.toString();
    const job = jobs.get(id) ?? {paid:false,transactions:new Set<string>()};
    job.transactions.add(log.transactionHash.toLowerCase());
    if (event.eventName === "PaymentReleased") job.paid = true;
    jobs.set(id,job);
  }
  const selection = {chainId:contracts.chainId,cutoffExclusive,jobs:[...jobs].filter(([,job])=>job.paid)
    .map(([jobId,job])=>({jobId,source:"chain-discovery",transactions:[...job.transactions]}))};
  validateSelection(contracts,selection);
  return selection;
}

export async function discoverSelection(contracts: Contracts, fromBlock: number, head: number, anchorHash: string, cutoffExclusive: string,
  rpc = getPublicClient(), directory = resolve(/* turbopackIgnore: true */ process.env.LEDGER_DIR || ".ledger")) {
  if (await rpc.getChainId() !== contracts.chainId) throw Error("WRONG_CHAIN");
  if ((await rpc.getBlock({blockNumber:BigInt(head)})).hash.toLowerCase() !== anchorHash) throw Error("REORG");
  const key = createHash("sha256").update(JSON.stringify({contracts,fromBlock,version:1})).digest("hex");
  const path = resolve(directory,`discovery-${key}.json`);
  let logs: Log[] = [], startBlock = fromBlock;
  try {
    const saved = JSON.parse(await readFile(path,"utf8"), (key,value) => key === "blockNumber" && typeof value === "string" ? BigInt(value) : value);
    if (saved.key === key && Number.isSafeInteger(saved.head) && saved.head >= fromBlock && saved.head <= head
      && Array.isArray(saved.logs) && saved.logs.every((log:Log)=>log.blockNumber !== null && log.blockNumber >= BigInt(fromBlock) && log.blockNumber <= BigInt(saved.head))
      && (await rpc.getBlock({blockNumber:BigInt(saved.head)})).hash.toLowerCase() === saved.hash) {
      logs = saved.logs; startBlock = saved.head+1;
    }
  } catch { /* A missing or invalid cache is rebuilt from chain data. */ }
  // RPC discovers transaction hashes; every displayed event is then fetched and
  // checked through MultiBaas receipts and canonical block responses.
  // Ten-block pages also work with RPC plans that limit eth_getLogs ranges.
  // Two reads per second accommodate RPC rate limits; refresh reads only new blocks.
  for (let batch = startBlock; batch <= head; batch += 20) {
    const began = Date.now();
    const pages = await Promise.all(Array.from({length:Math.min(2,Math.ceil((head-batch+1)/10))},async(_,index)=> {
      const start = batch+index*10;
      for (let attempt=0;;attempt++) try {return await rpc.getLogs({address:[contracts.core,contracts.hook] as Address[],
      events:ledgerAbi.filter(event=>["JobCreated","JobFunded","EvidenceCommitted","PaymentReleased"].includes(event.name)),
      fromBlock:BigInt(start),toBlock:BigInt(Math.min(head,start+9))});}
      catch (error) {
        if (attempt>=3 || !/429|Too Many Requests|rate limit/i.test(String(error))) throw error;
        await new Promise(resolve=>setTimeout(resolve,2000*(attempt+1)));
      }
    }));
    logs.push(...pages.flat());
    if (batch+20<=head) await new Promise(resolve=>setTimeout(resolve,Math.max(0,1000-(Date.now()-began))));
  }
  if ((await rpc.getBlock({blockNumber:BigInt(head)})).hash.toLowerCase() !== anchorHash) throw Error("REORG");
  const selected = selectCompletedJobs(logs,contracts,cutoffExclusive);
  await mkdir(directory,{recursive:true});
  const temporary = path+`.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify({key,head,hash:anchorHash,logs},(_,value)=>typeof value === "bigint" ? value.toString() : value),{mode:0o600});
  await rename(temporary,path);
  return selected;
}
