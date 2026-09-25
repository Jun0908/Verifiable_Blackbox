import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,defineChain,http,toHex,parseEventLogs,zeroHash} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {erc8183Abi,mockUsdcAbi,evaluatorAbi} from '../apps/web/lib/contracts.ts';

const base=process.env.DEMO_WEB_URL||'http://127.0.0.1:3000';
async function request(path,body,headers={}) {
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const payload=await response.json(); return {response,payload};
}
async function ok(path,body) {const {response,payload}=await request(path,body);assert.ok(response.ok,`${path}: ${JSON.stringify(payload)}`);return payload;}
const deployment=await ok('/api/demo/config');
assert.equal(deployment.chainId,31337,'Never run fixture signing on an external chain');
const chain=defineChain({id:31337,name:'Local API test',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[deployment.rpcUrl]}}});
const client=createPublicClient({chain,transport:http(deployment.rpcUrl),pollingInterval:50});
const account=privateKeyToAccount(toHex(0xc11e17n,{size:32}));
const wallet=createWalletClient({chain,account,transport:http(deployment.rpcUrl)});
await ok('/api/demo/faucet',{address:account.address});
const balance=()=>client.readContract({address:deployment.mockUsdc,abi:mockUsdcAbi,functionName:'balanceOf',args:[deployment.provider]});
const state=id=>client.readContract({address:deployment.erc8183,abi:erc8183Abi,functionName:'getJob',args:[id]});
const receipt=id=>client.readContract({address:deployment.evaluator,abi:evaluatorAbi,functionName:'receiptIdByJob',args:[id]});
const creations=new Map();
async function create(scenario) {
  const block=await client.getBlock();
  const hash=await wallet.writeContract({address:deployment.erc8183,abi:erc8183Abi,functionName:'createAndFundDemo',args:[deployment.provider,deployment.evaluator,block.timestamp+3600n,`vbb://api-test/${scenario}`,deployment.evidenceHook]});
  const tx=await client.waitForTransactionReceipt({hash}); assert.equal(tx.status,'success');
  const [event]=parseEventLogs({abi:erc8183Abi,eventName:'JobCreated',logs:tx.logs});
  assert.ok(event,'Confirmed JobCreated is required');
  creations.set(event.args.jobId,hash);
  return event.args.jobId;
}
const initial=await balance();
const rover=await create('rover');
assert.equal((await ok(`/api/demo/rover/complete?jobId=${rover}&createTx=${creations.get(rover)}`)).client.toLowerCase(),account.address.toLowerCase());
for(const body of [{},{evidence:{jobId:rover.toString()}},{action:'complete'}]) {
  const blocked=await request('/api/demo/rover/complete',body);
  assert.equal(blocked.response.status,409); assert.equal(blocked.payload.error,'PHYSICAL_MOVEMENT_NOT_VERIFIED');
}
assert.equal((await state(rover)).status,1);assert.equal(await receipt(rover),zeroHash);assert.equal(await balance(),initial);
const success=await create('success');
assert.equal((await request(`/api/demo/rover/complete?jobId=${rover}&createTx=${creations.get(success)}`)).response.ok,false);
const submitted=await ok('/api/demo/provider',{action:'submit',jobId:success.toString(),scenario:'success'});
const verified=await ok('/api/demo/verify',{evidence:submitted.evidence});
assert.equal(verified.verifier.mode,process.env.EXPECTED_VERIFIER_MODE||'MOCK_TEE');
const invalid=await request('/api/demo/settle',{verdict:verified.verdict,signature:'0x12'});
assert.equal(invalid.payload.error,'SIGNATURE_INVALID');assert.equal(await balance(),initial);
const settled=await ok('/api/demo/settle',{verdict:verified.verdict,signature:verified.signature});
assert.equal((await state(success)).status,3);assert.equal(await receipt(success),settled.receiptId);assert.notEqual(settled.receiptId,zeroHash);assert.equal(await balance(),initial+100_000_000n);
const duplicate=await request('/api/demo/settle',{verdict:verified.verdict,signature:verified.signature});
assert.equal(duplicate.response.ok,false);assert.equal(await balance(),initial+100_000_000n);
const tampered=await create('tampered');
const fixture=await ok('/api/demo/provider',{action:'submit',jobId:tampered.toString(),scenario:'tampered'});
const rejected=await request('/api/demo/verify',{evidence:{...fixture.evidence,imageHash:'0x'+'ab'.repeat(32)}});
assert.equal(rejected.response.status,422);assert.equal(rejected.payload.error,'EVIDENCE_HASH_MISMATCH');
assert.equal((await state(tampered)).status,2);assert.equal(await receipt(tampered),zeroHash);assert.equal(await balance(),initial+100_000_000n);
const foreign=await request('/api/demo/faucet',{address:account.address},{Origin:'https://example.com'});
assert.equal(foreign.response.status,403);
for(const method of ['anvil_setBalance','personal_sign','eth_sendTransaction']) {
  assert.equal((await request('/api/demo/rpc',{jsonrpc:'2.0',id:1,method,params:[]})).response.status,400);
}
console.log(JSON.stringify({ok:true,verifier:verified.verifier.mode,successJob:success.toString(),receiptId:settled.receiptId,tamperedJob:tampered.toString(),checks:['100 mUSDC payment','confirmed JobCreated','receipt','tamper rejection','replay rejection','physical completion blocked','foreign origin blocked','RPC allowlist']},null,2));
