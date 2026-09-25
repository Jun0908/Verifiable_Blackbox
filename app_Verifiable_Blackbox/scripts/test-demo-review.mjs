// Isolated Anvil + local Phala-policy integration. Never uses the live wallet or RPC.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile, mkdtemp, rm, mkdir, writeFile, rmdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

const root = resolve(import.meta.dirname, '..');
const web = resolve(root, 'apps/web');
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return {url:'data:text/javascript,export {};', shortCircuit:true};
  const path = specifier.startsWith('@/') ? resolve(web, specifier.slice(2))
    : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? resolve(dirname(fileURLToPath(context.parentURL)), specifier) : null;
  if (path && existsSync(`${path}.ts`)) return {url:pathToFileURL(`${path}.ts`).href, shortCircuit:true};
  return nextResolve(specifier, context);
}});
const chain = defineChain({id:31337, name:'Approval test', nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18}, rpcUrls:{default:{http:['http://127.0.0.1:8547']}}});
const rpc = chain.rpcUrls.default.http[0];
const publicClient = createPublicClient({chain, transport:http(rpc), pollingInterval:50});
const owner = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const outsider = privateKeyToAccount(toHex(0x123456n,{size:32}));
const provider = privateKeyToAccount(toHex(0xb0bn,{size:32}));
const relayer = privateKeyToAccount(toHex(0xd00dn,{size:32}));
const tee = privateKeyToAccount(toHex(0xa11cen,{size:32}));
const wallet = createWalletClient({account:owner,chain,transport:http(rpc)});
const children = [];
let temporary;
const launch = (command,args,options={}) => {
  const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});
  let errors=''; child.stderr.on('data',data=>{errors+=data;});
  child.on('error',error=>{errors+=error.message;});
  child.testErrors=()=>errors; children.push(child); return child;
};
async function until(fn) {let last; for(let i=0;i<80;i++){try{return await fn();}catch(e){last=e; await new Promise(r=>setTimeout(r,100));}} throw last;}
async function mined(hash) {const receipt=await publicClient.waitForTransactionReceipt({hash}); assert.equal(receipt.status,'success'); return receipt;}
async function deploy(name,args=[]) {const artifact=JSON.parse(await readFile(resolve(root,`out/${name}.sol/${name}.json`),'utf8')); return (await mined(await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,args}))).contractAddress;}
async function write(address,abi,functionName,args) {return mined(await wallet.writeContract({address,abi,functionName,args}));}

try {
  // Abort if this port already has any server: the test must own its chain.
  try {await publicClient.getChainId(); throw new Error('TEST_PORT_ALREADY_IN_USE');} catch(e) {if(e.message==='TEST_PORT_ALREADY_IN_USE')throw e;}
  launch(resolve(root,'.tools/foundry-v1.7.1/anvil.exe'),['--host','127.0.0.1','--port','8547','--chain-id','31337','--silent']);
  await until(()=>publicClient.getChainId());
  const token=await deploy('MockUSDC',[owner.address]);
  const implementation=await deploy('HackathonAgenticCommerce');
  const core=await deploy('ERC1967Proxy',[implementation,encodeFunctionData({abi:parseAbi(['function initialize(address,address)']),functionName:'initialize',args:[token,owner.address]})]);
  const hook=await deploy('DemoEvidenceHook',[core]);
  const evaluator=await deploy('MockTeeEvaluator',[core,hook,tee.address]);
  await write(core,parseAbi(['function setHookWhitelist(address,bool)']),'setHookWhitelist',[hook,true]);
  await write(token,parseAbi(['function transferOwnership(address)']),'transferOwnership',[core]);
  for(const account of [provider,relayer]) await publicClient.request({method:'anvil_setBalance',params:[account.address,toHex(10n**19n)]});
  temporary=await mkdtemp(resolve(root,'.approval-test-'));
  process.chdir(temporary);
  Object.assign(process.env,{NEXT_PUBLIC_CHAIN_ID:'31337',NEXT_PUBLIC_RPC_URL:rpc,MOCK_USDC_ADDRESS:token,ERC8183_ADDRESS:core,
    EVIDENCE_HOOK_ADDRESS:hook,EVALUATOR_ADDRESS:evaluator,DEMO_PROVIDER_ADDRESS:provider.address,
    DEMO_RELAYER_ADDRESS:relayer.address,DEMO_TEE_SIGNER_ADDRESS:tee.address,
    DEMO_PROVIDER_PRIVATE_KEY:toHex(0xb0bn,{size:32}),DEMO_RELAYER_PRIVATE_KEY:toHex(0xd00dn,{size:32}),
    DEMO_VERIFIER_MODE:'PHALA',PHALA_VERIFIER_URL:'http://127.0.0.1:3107'});
  const verifier=launch(process.execPath,['dist/index.js'],{cwd:resolve(process.env.PHALA_PROJECT_ROOT || resolve(root,'../../PhalaNetwork')),env:{...process.env,PORT:'3107',RPC_URL:rpc,CHAIN_ID:'31337',VERIFIER_MODE:'LOCAL_DEV',VERDICT_SIGNING_KEY:toHex(0xa11cen,{size:32})}});
  await until(async()=>{const r=await fetch('http://127.0.0.1:3107/health'); assert.equal(r.status,200);});
  const {erc8183Abi,mockUsdcAbi}=await import('../apps/web/lib/contracts.ts');
  const {reviewMessage}=await import('../apps/web/lib/demo-review.ts');
  const {updateDemoReview,readDemoReview}=await import('../apps/web/lib/server/demo-review.ts');
  async function create() {
    const block=await publicClient.getBlock();
    await write(core,erc8183Abi,'createAndFundDemo',[provider.address,evaluator,block.timestamp+3600n,'vbb://demo/success',hook]);
    return (await publicClient.readContract({address:core,abi:erc8183Abi,functionName:'jobCounter'})).toString();
  }
  const job=await create(); const second=await create();
  const draft=await updateDemoReview(job,'prepare');
  const sign=(account=owner,context=draft.context)=>account.signMessage({message:reviewMessage(context)});
  await assert.rejects(updateDemoReview(job,'verify-and-pay'),/OWNER_SIGNATURE_REQUIRED/);
  await assert.rejects(updateDemoReview(job,'verify-and-pay',await sign(outsider)),/OWNER_SIGNATURE_REQUIRED/);
  await updateDemoReview(second,'prepare');
  const paySignature=await sign();
  await assert.rejects(updateDemoReview(second,'verify-and-pay',paySignature),/OWNER_SIGNATURE_REQUIRED/);
  const recordPath=id=>resolve(temporary,'.demo-reviews',`31337-${core.toLowerCase()}`,`${id}.json`);
  const secondDraft=await readDemoReview(second);
  await mkdir(`${recordPath(second)}.lock`);
  await assert.rejects(updateDemoReview(second,'prepare'),/APPROVAL_REQUEST_IN_PROGRESS/);
  await rmdir(`${recordPath(second)}.lock`);
  const changed={...secondDraft,context:{...secondDraft.context,budget:'1'}};
  await writeFile(recordPath(second),JSON.stringify(changed));
  await assert.rejects(updateDemoReview(second,'verify-and-pay',await sign(owner,changed.context)),/APPROVAL_CONTEXT_CHANGED/);
  await writeFile(recordPath(second),JSON.stringify({...secondDraft,phase:'submitting',authorizationSignature:await sign(owner,secondDraft.context)}));
  await assert.rejects(updateDemoReview(second,'verify-and-pay',await sign(owner,secondDraft.context)),/TRANSACTION_RECONCILIATION_REQUIRED/);
  await writeFile(recordPath(second),JSON.stringify(secondDraft));
  const balance=()=>publicClient.readContract({address:token,abi:mockUsdcAbi,functionName:'balanceOf',args:[provider.address]});
  assert.equal(await balance(),0n,'Preparing or viewing a job must not pay');
  assert.equal((await readDemoReview(job)).phase,'review');
  // Fail verification after evidence submission, then resume the persisted job.
  process.env.PHALA_VERIFIER_URL='http://127.0.0.1:3108';
  await assert.rejects(updateDemoReview(job,'verify-and-pay',paySignature),/PHALA_UNAVAILABLE/);
  const interrupted=await readDemoReview(job);
  assert.equal(interrupted.phase,'submitted'); assert.ok(interrupted.submitTransactionHash);
  assert.equal(await balance(),0n,'Verifier failure must not pay');
  await writeFile(recordPath(job),JSON.stringify({...interrupted,phase:'paying'}));
  await assert.rejects(updateDemoReview(job,'verify-and-pay',paySignature),/TRANSACTION_RECONCILIATION_REQUIRED/);
  await writeFile(recordPath(job),JSON.stringify(interrupted));
  process.env.PHALA_VERIFIER_URL='http://127.0.0.1:3107';
  const attempts=await Promise.allSettled([updateDemoReview(job,'verify-and-pay',paySignature),updateDemoReview(job,'verify-and-pay',paySignature)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  const paid=await readDemoReview(job);
  assert.equal(paid.phase,'paid'); assert.equal(paid.verification.verifier.mode,'LOCAL_DEV');
  assert.ok(paid.receiptId); assert.ok(paid.completeTransactionHash);
  assert.equal(paid.submitTransactionHash,interrupted.submitTransactionHash,'Retry must reuse submitted evidence');
  assert.equal(await balance(),100_000_000n);
  const repeated=await updateDemoReview(job,'verify-and-pay',paySignature);
  assert.equal(repeated.completeTransactionHash,paid.completeTransactionHash);
  assert.equal(await balance(),100_000_000n,'Duplicate request must not pay twice');
  await publicClient.request({method:'evm_increaseTime',params:[4000]});
  await publicClient.request({method:'evm_mine',params:[]});
  const expired=await readDemoReview(second);
  await assert.rejects(updateDemoReview(second,'verify-and-pay',await sign(owner,expired.context)),/JOB_EXPIRED/);
  console.log('PASS: owner authorization, no unsigned payout, cross-job/context rejection, residual lock, unknown submission/payment recovery, saved progress, failed-verifier no payment, retry, concurrency, exactly-once payout, expiry. Local Phala policy + Anvil only.');
  if(verifier.exitCode!==null) throw Error(verifier.testErrors());
} finally {
  process.chdir(root);
  for(const child of children.reverse()) {child.kill(); await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}
  if(temporary && dirname(temporary)===root && temporary.startsWith(resolve(root,'.approval-test-'))) await rm(temporary,{recursive:true,force:true});
}
