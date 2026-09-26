// Explicit live Sepolia test. Keeps its disposable key privately in ignored artifacts for recovery.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import assert from 'node:assert/strict';
import {createPublicClient, createWalletClient, formatEther, http} from 'viem';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';
const root=resolve(import.meta.dirname,'..');
loadEnvFile(resolve(root,'.env'));
if(!process.argv.includes('--broadcast')&&!process.argv.includes('--refund'))throw Error('Use --broadcast for a test top-up and refund; --refund to recover its remaining test ETH');
if(process.env.NEXT_PUBLIC_CHAIN_ID!=='11155111')throw Error('Sepolia required');
const transport=http(process.env.SEPOLIA_RPC_URL);
const client=createPublicClient({chain:sepolia,transport});
assert.equal(await client.getChainId(),11155111);
const directory=resolve(root,'artifacts/gas-smoke');
await mkdir(directory,{recursive:true});
const keyPath=resolve(directory,'wallet.json');
let key;
try {key=JSON.parse(await readFile(keyPath,'utf8')).privateKey;} catch(error) {
  if(error.code!=='ENOENT'||process.argv.includes('--refund'))throw error;
  key=generatePrivateKey();await writeFile(keyPath,JSON.stringify({privateKey:key}),{mode:0o600});
}
const account=privateKeyToAccount(key);
const pool=privateKeyToAccount(process.env.DEMO_GAS_FAUCET_PRIVATE_KEY).address;
const wallet=createWalletClient({account,chain:sepolia,transport});
const origin='http://127.0.0.1:3000';
const endpoint=origin+'/api/demo/faucet';
const report={address:account.address,pool,chainId:11155111};
async function save(){await writeFile(resolve(directory,'result.json'),JSON.stringify(report,null,2));}
if(process.argv.includes('--broadcast')) {
  const response=await fetch(endpoint+'?address='+account.address);
  const info=await response.json();assert.equal(response.ok,true,JSON.stringify(info));
  assert.equal(info.poolAddress.toLowerCase(),pool.toLowerCase());assert.equal(info.balanceWei,'0');
  const signature=await account.signMessage({message:info.message});
  const paid=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({address:account.address,day:info.day,signature})});
  const result=await paid.json();assert.equal(paid.ok,true,JSON.stringify(result));
  assert.equal(result.ready,true);
  assert.equal((await client.getTransactionReceipt({hash:result.gasTransactionHash})).status,'success');
  Object.assign(report,{fundingHash:result.gasTransactionHash,fundedETH:formatEther(await client.getBalance({address:account.address}))});
  await save();console.log(JSON.stringify(report));
}
const balance=await client.getBalance({address:account.address});
const fees=await client.estimateFeesPerGas();
const gas=await client.estimateGas({account:account.address,to:pool,value:1n});
const value=balance-gas*fees.maxFeePerGas;
if(value>0n) {
  const hash=await wallet.sendTransaction({to:pool,value,gas,...fees});
  report.refundHash=hash;await save();
  assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');
  report.refundedETH=formatEther(value);
}
report.remainingTestETH=formatEther(await client.getBalance({address:account.address}));
report.ok=true;await save();console.log(JSON.stringify(report));
