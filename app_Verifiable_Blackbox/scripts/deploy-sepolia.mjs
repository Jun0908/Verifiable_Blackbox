import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {createPublicClient, formatEther, formatGwei, http, isAddress, parseAbi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

const root=resolve(import.meta.dirname,'..');
loadEnvFile(resolve(root,'.env'));
const broadcast=process.argv.includes('--broadcast');
if(process.argv.slice(2).some(arg=>arg!=='--broadcast'))throw Error('Only --broadcast is supported');

const rpc=process.env.SEPOLIA_RPC_URL || process.env.DEMO_RPC_URL;
if(!rpc || !/^https?:\/\//.test(rpc) || new URL(rpc).pathname.endsWith('/api/demo/rpc'))throw Error('Set a direct SEPOLIA_RPC_URL in .env');
if(process.env.NEXT_PUBLIC_CHAIN_ID!=='11155111')throw Error('Set NEXT_PUBLIC_CHAIN_ID=11155111');
if(process.env.DEMO_DEPLOYMENT_FILE!=='demo.testnet.json')throw Error('Set DEMO_DEPLOYMENT_FILE=demo.testnet.json');
const key=name=>{
  const value=process.env[name];
  if(!/^0x[0-9a-fA-F]{64}$/.test(value||''))throw Error(`${name} must be a 32-byte private key`);
  return value;
};
const accounts={
  deployer:privateKeyToAccount(key('DEPLOYER_PRIVATE_KEY')),
  provider:privateKeyToAccount(key('DEMO_PROVIDER_PRIVATE_KEY')),
  relayer:privateKeyToAccount(key('DEMO_RELAYER_PRIVATE_KEY')),
};
if(accounts.deployer.address.toLowerCase()==='0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')throw Error('Public Anvil deployer key is unsafe on Sepolia');
const previousDeployer=process.env.PREVIOUS_DEPLOYER_ADDRESS;
if(isAddress(previousDeployer) && accounts.deployer.address.toLowerCase()===previousDeployer.toLowerCase())throw Error('New deployer address matches the previous Sepolia deployer');
for(const role of ['provider','relayer']) {
  const configured=process.env[`DEMO_${role.toUpperCase()}_ADDRESS`];
  if(!isAddress(configured) || configured.toLowerCase()!==accounts[role].address.toLowerCase())throw Error(`${role} key and address do not match`);
}
if(!isAddress(process.env.DEMO_TEE_SIGNER_ADDRESS) || /^0x0{40}$/i.test(process.env.DEMO_TEE_SIGNER_ADDRESS))throw Error('Set DEMO_TEE_SIGNER_ADDRESS to the verifier service signer');
if(process.env.DEMO_VERIFIER_MODE==='MOCK_TEE' && privateKeyToAccount(key('DEMO_TEE_PRIVATE_KEY')).address.toLowerCase()!==process.env.DEMO_TEE_SIGNER_ADDRESS.toLowerCase())throw Error('TEE key and signer address do not match');

const client=createPublicClient({transport:http(rpc)});
if(await client.getChainId()!==11155111)throw Error('RPC is not Ethereum Sepolia');
if(await client.getTransactionCount({address:accounts.deployer.address})!==0)throw Error('Deployer wallet has already sent transactions; use a fresh wallet');
console.log('Ethereum Sepolia (chain 11155111)');
let deployerBalance=0n;
for(const [role,account] of Object.entries(accounts)) {
  const balance=await client.getBalance({address:account.address});
  console.log(`${role}: ${account.address}, ${formatEther(balance)} Sepolia ETH`);
  if(role==='deployer')deployerBalance=balance;
}
const gasPrice=await client.getGasPrice();
const suggestedDeployerBalance=12_000_000n*gasPrice;
console.log(`Deployer funding check: at least ${formatEther(suggestedDeployerBalance)} Sepolia ETH at the current ${formatGwei(gasPrice)} gwei gas price (12 million gas allowance)`);
if(broadcast && deployerBalance<suggestedDeployerBalance)throw Error('Deployer Sepolia ETH is below the deployment gas allowance');
if(!broadcast) {
  console.log('Preflight only. Run with --broadcast to deploy all six contracts.');
  process.exit(0);
}

const deploymentPath=resolve(root,'deployments/demo.testnet.json');
const previous=existsSync(deploymentPath)?readFileSync(deploymentPath):null;
const forge=resolve(root,'.tools/foundry-v1.7.1',`forge${process.platform==='win32'?'.exe':''}`);
const result=spawnSync(existsSync(forge)?forge:'forge',[
  'script','packages/contracts/script/DeploySepolia.s.sol:DeploySepolia',
  '--rpc-url',rpc,'--broadcast','--slow',
],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
if(result.error || result.status!==0) {
  if(previous)writeFileSync(deploymentPath,previous);
  else if(existsSync(deploymentPath))unlinkSync(deploymentPath);
  throw result.error || Error(`Forge exited ${result.status}; inspect broadcast/ for any transactions already sent`);
}

const d=JSON.parse(readFileSync(deploymentPath,'utf8'));
if(d.chainId!==11155111)throw Error('Deployment JSON has the wrong chain');
for(const field of ['mockUsdc','erc8183','erc8183Implementation','evidenceHook','evaluator','deviceSignatureVerifier']) {
  if(!isAddress(d[field]) || (await client.getCode({address:d[field]}))==='0x')throw Error(`Deployed code is missing: ${field}`);
}
const abi=parseAbi([
  'function core() view returns (address)',
  'function evidenceHook() view returns (address)',
  'function mockTeeSigner() view returns (address)',
  'function owner() view returns (address)',
  'function paymentToken() view returns (address)',
  'function whitelistedHooks(address) view returns (bool)',
]);
for(const [address,functionName,expected] of [
  [d.evidenceHook,'core',d.erc8183],
  [d.evaluator,'core',d.erc8183],
  [d.evaluator,'evidenceHook',d.evidenceHook],
  [d.evaluator,'mockTeeSigner',d.mockTeeSigner],
  [d.mockUsdc,'owner',d.erc8183],
  [d.erc8183,'paymentToken',d.mockUsdc],
]) {
  const actual=await client.readContract({address,abi,functionName});
  if(actual.toLowerCase()!==expected.toLowerCase())throw Error(`Deployed link mismatch: ${functionName}`);
}
if(!await client.readContract({address:d.erc8183,abi,functionName:'whitelistedHooks',args:[d.evidenceHook]}))throw Error('Evidence hook is not whitelisted');
console.log(`Verified on-chain code and links. Deployment: ${deploymentPath}`);
