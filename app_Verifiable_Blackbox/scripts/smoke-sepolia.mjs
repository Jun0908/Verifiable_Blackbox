// Synthetic Sepolia payment smoke test. Sends a test Job; does not use Privy or a Rover.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {createPublicClient, createWalletClient, formatEther, http, parseEventLogs, zeroHash} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';
import {erc8183Abi, evaluatorAbi, mockUsdcAbi} from '../apps/web/lib/contracts.ts';

const root=resolve(import.meta.dirname,'..');
loadEnvFile(resolve(root,'.env'));
if(process.argv.slice(2).some(arg=>arg!=='--broadcast'))throw Error('Only --broadcast is supported');
const broadcast=process.argv.includes('--broadcast');
const deployment=JSON.parse(readFileSync(resolve(root,'deployments/demo.testnet.json'),'utf8'));
assert.equal(deployment.chainId,sepolia.id);
assert.equal(process.env.DEMO_VERIFIER_MODE,'PHALA');
assert.equal(process.env.ALLOW_PUBLIC_DEMO_AUTOMATION,'true');
const rpc=process.env.SEPOLIA_RPC_URL;
if(!rpc || new URL(rpc).pathname.endsWith('/api/demo/rpc'))throw Error('Direct Sepolia RPC required');
const account=privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const client=createPublicClient({chain:sepolia,transport:http(rpc)});
const wallet=createWalletClient({chain:sepolia,account,transport:http(rpc)});
assert.equal(await client.getChainId(),sepolia.id);
const base='http://127.0.0.1:3000';
async function request(path,body) {
  const response=await fetch(base+path,{
    method:body===undefined?'GET':'POST',
    headers:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(180000),
  });
  const data=await response.json();
  if(!response.ok || data.ok===false)throw Error(`${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const config=await request('/api/demo/config');
assert.equal(config.chainId,sepolia.id);
assert.equal(config.verifier.mode,'PHALA');
for(const field of ['erc8183','evidenceHook','evaluator','mockUsdc','provider','relayer','mockTeeSigner']) {
  assert.equal(config[field].toLowerCase(),deployment[field].toLowerCase(),`${field} mismatch`);
}
const [clientBalance,providerGas,relayerGas]=await Promise.all([
  client.getBalance({address:account.address}),
  client.getBalance({address:deployment.provider}),
  client.getBalance({address:deployment.relayer}),
]);
console.log(`Synthetic Job sender ${account.address}; gas: ${formatEther(clientBalance)} ETH, provider ${formatEther(providerGas)} ETH, relayer ${formatEther(relayerGas)} ETH`);
if(!broadcast) {
  console.log('Preflight only. --broadcast creates, submits and settles one synthetic 100 mUSDC Job on Sepolia.');
  process.exit(0);
}
if([clientBalance,providerGas,relayerGas].some(balance=>balance<1000000000000000n))throw Error('A transaction wallet has less than 0.001 Sepolia ETH');
const before=await client.readContract({address:deployment.mockUsdc,abi:mockUsdcAbi,functionName:'balanceOf',args:[deployment.provider]});
const block=await client.getBlock();
const createTx=await wallet.writeContract({
  address:deployment.erc8183,
  abi:erc8183Abi,
  functionName:'createAndFundDemo',
  args:[deployment.provider,deployment.evaluator,block.timestamp+3600n,'vbb://sepolia-smoke/synthetic',deployment.evidenceHook],
});
console.log(`Job creation broadcast: ${createTx}`);
const created=await client.waitForTransactionReceipt({hash:createTx});
assert.equal(created.status,'success');
const [event]=parseEventLogs({abi:erc8183Abi,eventName:'JobCreated',logs:created.logs});
assert.ok(event,'Confirmed JobCreated missing');
const jobId=event.args.jobId;
console.log(`Job ${jobId} created; submitting synthetic evidence`);
const submitted=await request('/api/demo/provider',{action:'submit',jobId:jobId.toString(),scenario:'success'});
const verified=await request('/api/demo/verify',{evidence:submitted.evidence});
assert.equal(verified.verifier.mode,'PHALA_DSTACK');
assert.equal(verified.verifier.attested,true);
assert.equal(verified.verifier.simulated,false);
const settled=await request('/api/demo/settle',{verdict:verified.verdict,signature:verified.signature});
const [job,receiptId,after]=await Promise.all([
  client.readContract({address:deployment.erc8183,abi:erc8183Abi,functionName:'getJob',args:[jobId]}),
  client.readContract({address:deployment.evaluator,abi:evaluatorAbi,functionName:'receiptIdByJob',args:[jobId]}),
  client.readContract({address:deployment.mockUsdc,abi:mockUsdcAbi,functionName:'balanceOf',args:[deployment.provider]}),
]);
assert.equal(job.status,3);
assert.notEqual(receiptId,zeroHash);
assert.equal(receiptId,settled.receiptId);
assert.equal(after-before,100000000n);
const report={chainId:sepolia.id,kind:'synthetic-smoke-test',sender:account.address,jobId:jobId.toString(),createTx,submitTx:submitted.transactionHash,settleTx:settled.transactionHash,receiptId,providerPayment:'100000000',verifierMode:verified.verifier.mode};
writeFileSync(resolve(root,'deployments/demo.testnet.smoke.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
