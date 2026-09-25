import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, toHex, zeroHash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evidenceCommitment, evidenceToWire } from '../dist/evidence.js';
import { freePort, launch, ready, run, stop } from './local-process.mjs';

const root = resolve(import.meta.dirname, '..');
const app = resolve(process.env.APP_PROJECT_ROOT || resolve(root, '../app_Verifiable_Blackbox'));
const rpcPort = Number(process.env.TEST_RPC_PORT || 8548);
const port = Number(process.env.TEST_VERIFIER_PORT || 3109);
for (const value of [rpcPort, port]) assert.ok(Number.isInteger(value) && value > 0 && value <= 65535);
assert.notEqual(rpcPort, port);
const rpc = `http://127.0.0.1:${rpcPort}`; const url = `http://127.0.0.1:${port}`;
const chain = defineChain({id:31337, name:'Local verifier test', nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18}, rpcUrls:{default:{http:[rpc]}}});
const publicClient = createPublicClient({chain, transport:http(rpc, {retryCount:0, timeout:1000}), pollingInterval:30});
const owner = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const teeKey = toHex(0xa11cen,{size:32}); const tee = privateKeyToAccount(teeKey);
const wallet = createWalletClient({account:owner, chain, transport:http(rpc)});
const artifacts = {};
let anvil; let verifier;
async function mined(hash) { const receipt = await publicClient.waitForTransactionReceipt({hash: await hash}); assert.equal(receipt.status,'success'); return receipt; }
async function deploy(name, args=[]) {
  const artifact = artifacts[name] = JSON.parse(await readFile(resolve(app,`out/${name}.sol/${name}.json`),'utf8'));
  return (await mined(await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,args}))).contractAddress;
}
async function write(address, abi, functionName, args) {return mined(await wallet.writeContract({address,abi,functionName,args}));}
try {
  await freePort(rpcPort); await freePort(port);
  await run(process.execPath, [resolve(app,'scripts/foundry.mjs'),'forge','build'], {cwd:app});
  const binary = resolve(app,`.tools/foundry-v1.7.1/anvil${process.platform === 'win32' ? '.exe' : ''}`);
  anvil = launch(existsSync(binary) ? binary : 'anvil', ['--host','127.0.0.1','--port',String(rpcPort),'--chain-id','31337','--silent']);
  await ready(anvil, async () => assert.equal(await publicClient.getChainId(),31337));
  // All writes below target the loopback chain created by this process.
  const token = await deploy('MockUSDC',[owner.address]);
  const implementation = await deploy('HackathonAgenticCommerce');
  const core = await deploy('ERC1967Proxy',[implementation,encodeFunctionData({abi:parseAbi(['function initialize(address,address)']),functionName:'initialize',args:[token,owner.address]})]);
  const hook = await deploy('DemoEvidenceHook',[core]);
  const evaluator = await deploy('MockTeeEvaluator',[core,hook,tee.address]);
  const coreAbi = artifacts.HackathonAgenticCommerce.abi; const tokenAbi = artifacts.MockUSDC.abi; const evaluatorAbi = artifacts.MockTeeEvaluator.abi;
  await write(core,coreAbi,'setHookWhitelist',[hook,true]);
  await write(token,tokenAbi,'transferOwnership',[core]);
  const provider = privateKeyToAccount(toHex(0xb0bn,{size:32}));
  const pw = createWalletClient({account:provider,chain,transport:http(rpc)});
  await publicClient.request({method:'anvil_setBalance',params:[provider.address,toHex(10n ** 19n)]});
  const env = {...process.env, HOST:'127.0.0.1', PORT:String(port), RPC_URL:rpc, CHAIN_ID:'31337', ERC8183_ADDRESS:core,
    EVIDENCE_HOOK_ADDRESS:hook, EVALUATOR_ADDRESS:evaluator, VERIFIER_MODE:'LOCAL_DEV', VERDICT_SIGNING_KEY:teeKey};
  delete env.DSTACK_SIMULATOR_ENDPOINT;
  verifier = launch(process.execPath,['dist/index.js'],{cwd:root,env});
  await ready(verifier, async () => {
    const r = await fetch(`${url}/health`,{signal:AbortSignal.timeout(1000)}); const h = await r.json();
    assert.equal(h.verifier.signerAddress,tee.address); assert.equal(h.verifier.mode,'LOCAL_DEV');
  });
  const balance = () => publicClient.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[provider.address]});
  const receiptFor = id => publicClient.readContract({address:evaluator,abi:evaluatorAbi,functionName:'receiptIdByJob',args:[id]});
  const verify = async (e,status=200) => {
    const r = await fetch(`${url}/verify`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({evidence:evidenceToWire(e)}),signal:AbortSignal.timeout(15000)});
    assert.equal(r.status,status); const result = await r.json();
    if(status !== 200) {assert.equal(result.signature,undefined); assert.equal(result.verdict,undefined);}
    return result;
  };
  async function job(evaluatorAddress=evaluator) {
    const block = await publicClient.getBlock();
    await write(core,coreAbi,'createAndFundDemo',[provider.address,evaluatorAddress,block.timestamp+3600n,'vbb://local-test',hook]);
    const jobId = await publicClient.readContract({address:core,abi:coreAbi,functionName:'jobCounter'});
    return {jobId,scenario:'success',robotId:'rover-demo-001',challenge:`challenge-success-${jobId}`,capturedAt:(await publicClient.getBlock()).timestamp,
      imageHash:`0x${'0'.repeat(60)}cafe`,checkpoint:'checkpoint-a',sequence:1n};
  }
  const submit = e => mined(pw.writeContract({address:core,abi:coreAbi,functionName:'submit',args:[e.jobId,evidenceCommitment(e),'0x']}));
  const e = await job(); await verify(e,422); assert.equal(await receiptFor(e.jobId),zeroHash);
  await submit(e);
  await verify({...e,imageHash:`0x${'ab'.repeat(32)}`},422);
  assert.equal(await balance(),0n); assert.equal(await receiptFor(e.jobId),zeroHash);
  const r = await verify(e); const v = {...r.verdict,jobId:BigInt(r.verdict.jobId),issuedAt:BigInt(r.verdict.issuedAt),validUntil:BigInt(r.verdict.validUntil)};
  const tx = await write(evaluator,evaluatorAbi,'settle',[v,r.signature]);
  assert.equal(await balance(),100_000_000n); const receiptId = await receiptFor(e.jobId); assert.notEqual(receiptId,zeroHash);
  const receipt = await publicClient.readContract({address:evaluator,abi:evaluatorAbi,functionName:'getReceipt',args:[receiptId]});
  assert.equal(receipt.verdictSigner,tee.address);
  await assert.rejects(publicClient.simulateContract({account:owner,address:evaluator,abi:evaluatorAbi,functionName:'settle',args:[v,r.signature]}));
  await verify(e,422); assert.equal(await balance(),100_000_000n); assert.equal(await receiptFor(e.jobId),receiptId);
  const other = await job(owner.address); await submit(other); await verify(other,422); assert.equal(await receiptFor(other.jobId),zeroHash);
  const expired = await job(); await submit(expired);
  await publicClient.request({method:'evm_increaseTime',params:[4000]}); await publicClient.request({method:'evm_mine',params:[]});
  await verify(expired,422); assert.equal(await receiptFor(expired.jobId),zeroHash); assert.equal(await balance(),100_000_000n);
  const report = {ok:true,mode:'LOCAL_DEV',chainId:31337,paid:'100 mUSDC',jobId:String(e.jobId),transactionHash:tx.transactionHash,receiptId,
    checks:['unsubmitted','tampering','wrong evaluator','expired','reused verdict','completed job','exactly one payout']};
  await mkdir(resolve(root,'artifacts'),{recursive:true}); await writeFile(resolve(root,'artifacts/local-e2e.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {await stop(verifier); await stop(anvil);}
