import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { checkPhalaEnvironment } from '../dist/cloud-config.js';
import { boundedJson, expectationsSchema, verifyAttestation } from '../dist/attestation-verifier.js';
// Read-only. No wallet and no transactions, including on Sepolia.
try {
  const [endpoint,expectedFile] = process.argv.slice(2);
  if(!endpoint || !expectedFile) throw Error('ENDPOINT_AND_EXPECTATIONS_REQUIRED');
  const url = new URL(endpoint);
  if(url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('HTTPS_ENDPOINT_REQUIRED');
  const {config} = checkPhalaEnvironment(process.env);
  const parsed = expectationsSchema.safeParse(JSON.parse(await readFile(expectedFile,'utf8')));
  if(!parsed.success) throw Error('EXPECTATIONS_INVALID'); const expected=parsed.data;
  if(expected.chainId !== config.chainId || getAddress(expected.evaluatorAddress) !== config.evaluatorAddress) throw Error('EXPECTATIONS_CONFIG_MISMATCH');
  const base = url.href.replace(/\/$/,'');
  const health=await boundedJson(await fetch(`${base}/health`,{signal:AbortSignal.timeout(15000),redirect:'error'}));
  if(health.ok !== true || health.verifier?.mode !== 'PHALA_DSTACK' || health.verifier?.keySource !== 'DSTACK_KMS' ||
    health.verifier?.simulated !== false || health.verifier?.attested !== true ||
    getAddress(health.verifier.signerAddress) !== getAddress(expected.signerAddress)) throw Error('HEALTH_SIGNER_MISMATCH');
  const chain = createPublicClient({transport:http(config.rpcUrl,{retryCount:1,timeout:10000})});
  if(await chain.getChainId() !== 11155111) throw Error('CHAIN_ID_MISMATCH');
  const block=await chain.getBlock();
  const abi = parseAbi(['function mockTeeSigner() view returns (address)','function core() view returns (address)','function evidenceHook() view returns (address)']);
  const [signer,core,hook] = await Promise.all(['mockTeeSigner','core','evidenceHook'].map(functionName => chain.readContract({address:config.evaluatorAddress,abi,functionName,blockNumber:block.number})));
  if(getAddress(signer)!==getAddress(expected.signerAddress) || getAddress(core)!==config.erc8183Address || getAddress(hook)!==config.evidenceHookAddress) throw Error('EVALUATOR_CONFIG_MISMATCH');
  const nonce=randomBytes(32).toString('hex');
  const report=await boundedJson(await fetch(`${base}/attestation?nonce=${nonce}`,{signal:AbortSignal.timeout(30000),redirect:'error'}));
  const attestation=await verifyAttestation(report,expected,nonce);
  console.log(JSON.stringify({ok:true,readOnly:true,checkedAt:new Date().toISOString(),blockNumber:String(block.number),chainId:11155111,attestation}));
} catch(e) {
  console.error(JSON.stringify({ok:false,reason:/^[A-Z_]+$/.test(e.message) || e.message.startsWith('Invalid configuration:') ? e.message : 'LIVE_CHECK_FAILED'}));
  process.exitCode=1;
}
