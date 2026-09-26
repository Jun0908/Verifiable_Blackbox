import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {createPublicClient, createWalletClient, formatEther, http, parseEther} from 'viem';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';

const root=resolve(import.meta.dirname,'..');
const envPath=resolve(root,'.env');
loadEnvFile(envPath);
if(process.env.NEXT_PUBLIC_CHAIN_ID!=='11155111')throw Error('Sepolia configuration required');
if(process.argv.includes('--create-wallet')) {
  let contents=readFileSync(envPath,'utf8');
  function set(name,value) {
    const pattern=new RegExp(`^${name}=.*$`,'m');
    contents=pattern.test(contents)?contents.replace(pattern,()=>`${name}=${value}`):`${contents.trimEnd()}\n${name}=${value}\n`;
    process.env[name]=value;
  }
  if(!process.env.DEMO_GAS_FAUCET_PRIVATE_KEY)set('DEMO_GAS_FAUCET_PRIVATE_KEY',generatePrivateKey());
  set('DEMO_GAS_FAUCET_ENABLED','true');
  writeFileSync(envPath,contents,{mode:0o600});
}
if(!process.env.DEMO_GAS_FAUCET_PRIVATE_KEY)throw Error('Run with --create-wallet once to configure a dedicated gas pool');
const transport=http(process.env.SEPOLIA_RPC_URL);
const client=createPublicClient({chain:sepolia,transport});
if(await client.getChainId()!==sepolia.id)throw Error('RPC must be Ethereum Sepolia');
const source=privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const wallet=createWalletClient({account:source,chain:sepolia,transport});
const roles=[['gasPool','DEMO_GAS_FAUCET_PRIVATE_KEY','0.03'],['provider','DEMO_PROVIDER_PRIVATE_KEY','0.01'],['relayer','DEMO_RELAYER_PRIVATE_KEY','0.01']];
const plan=[];
for(const [role,key,target] of roles) {
  const address=privateKeyToAccount(process.env[key]).address;
  const balance=await client.getBalance({address});
  plan.push({role,address,balance,target:parseEther(target),amount:balance<parseEther(target)?parseEther(target)-balance:0n});
}
console.log('Sepolia only. Funding source:',source.address,'balance:',formatEther(await client.getBalance({address:source.address})), 'ETH');
for(const entry of plan)console.log(JSON.stringify({role:entry.role,address:entry.address,balanceETH:formatEther(entry.balance),topUpETH:formatEther(entry.amount)}));
if(process.argv.includes('--broadcast')) {
  const total=plan.reduce((sum,x)=>sum+x.amount,0n);
  if(await client.getBalance({address:source.address})<total+parseEther('0.01'))throw Error('Keep at least 0.01 ETH in the deployer after funding');
  for(const entry of plan) {
    if(entry.amount===0n)continue;
    const hash=await wallet.sendTransaction({to:entry.address,value:entry.amount});
    const receipt=await client.waitForTransactionReceipt({hash});
    if(receipt.status!=='success')throw Error('Funding reverted: '+entry.role);
    console.log(JSON.stringify({role:entry.role,hash,status:receipt.status}));
  }
} else console.log('Read-only balances. Use --broadcast to top up these demo wallets.');
