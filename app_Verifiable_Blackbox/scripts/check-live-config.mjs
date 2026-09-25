// Read-only: never obtains signing accounts or sends transactions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseAbi} from 'viem';
const root=resolve(import.meta.dirname,'..');
if(process.env.VBB_LIVE_DEPLOYMENT) {
  const d=JSON.parse(readFileSync(process.env.VBB_LIVE_DEPLOYMENT,'utf8'));
  Object.assign(process.env,{NEXT_PUBLIC_CHAIN_ID:String(d.chainId),MOCK_USDC_ADDRESS:d.mockUsdc,ERC8183_ADDRESS:d.erc8183,EVIDENCE_HOOK_ADDRESS:d.evidenceHook,EVALUATOR_ADDRESS:d.evaluator,DEMO_PROVIDER_ADDRESS:d.provider,DEMO_RELAYER_ADDRESS:d.relayer,DEMO_TEE_SIGNER_ADDRESS:d.mockTeeSigner,PHALA_VERIFIER_URL:d.phalaVerifierUrl||process.env.PHALA_VERIFIER_URL,DEMO_VERIFIER_MODE:'PHALA'});
}
process.chdir(resolve(root,'apps/web'));
const {getDeployment,getPublicClient,getVerifierConfig}=await import('../apps/web/lib/server/config.ts');
let stage='configuration';
try {
  const d=getDeployment(), client=getPublicClient(), verifier=getVerifierConfig();
  stage='chain';
  assert.equal(await client.getChainId(),d.chainId,'CHECK_CHAIN_MISMATCH');
  stage='contract bytecode';
  for(const address of [d.mockUsdc,d.erc8183,d.evidenceHook,d.evaluator])assert.ok((await client.getCode({address}))?.length>2,'CHECK_CONTRACT_MISSING');
  stage='contract links';
  const abi=parseAbi(['function core() view returns(address)','function evidenceHook() view returns(address)','function mockTeeSigner() view returns(address)']);
  for(const [address,fn,expected] of [[d.evidenceHook,'core',d.erc8183],[d.evaluator,'core',d.erc8183],[d.evaluator,'evidenceHook',d.evidenceHook],[d.evaluator,'mockTeeSigner',d.mockTeeSigner]])assert.equal((await client.readContract({address,abi,functionName:fn})).toLowerCase(),expected.toLowerCase(),'CHECK_CONTRACT_LINK_MISMATCH');
  if(verifier.mode!=='PHALA')throw Error('CHECK_PHALA_MODE_REQUIRED');
  stage='Phala health';
  const response=await fetch(verifier.baseUrl+'/health',{headers:verifier.bearerToken?{Authorization:`Bearer ${verifier.bearerToken}`}:{},signal:AbortSignal.timeout(verifier.timeoutMs)});
  const health=await response.json();assert.equal(response.ok,true,'CHECK_PHALA_HEALTH_FAILED');assert.equal(health.verifier.signerAddress.toLowerCase(),d.mockTeeSigner.toLowerCase(),'CHECK_PHALA_SIGNER_MISMATCH');
  console.log(JSON.stringify({ok:true,checkedAt:new Date().toISOString(),chainId:d.chainId,core:d.erc8183,hook:d.evidenceHook,evaluator:d.evaluator,trustedSigner:d.mockTeeSigner,serviceMode:health.verifier.mode,transactionSent:false,quoteVerified:false},null,2));
} catch(error) {console.error(JSON.stringify({ok:false,stage,error:/^CHECK_[A-Z_]+$/.test(error.message)?error.message:'RPC_OR_SERVICE_CHECK_FAILED',type:error.name,networkCode:error.cause?.code}));process.exitCode=1;}
