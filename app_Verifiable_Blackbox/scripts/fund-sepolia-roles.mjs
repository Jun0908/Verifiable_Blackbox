import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {createPublicClient, createWalletClient, formatEther, http, parseEther} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';

const root=resolve(import.meta.dirname,'..');
loadEnvFile(resolve(root,'.env'));
const deployment=JSON.parse(readFileSync(resolve(root,'deployments/demo.testnet.json'),'utf8'));
if(deployment.chainId!==sepolia.id)throw Error('Wrong deployment chain');
const rpc=process.env.SEPOLIA_RPC_URL;
if(!rpc)throw Error('SEPOLIA_RPC_URL is required');
const transport=http(rpc);
const publicClient=createPublicClient({chain:sepolia,transport});
if(await publicClient.getChainId()!==sepolia.id)throw Error('RPC is not Ethereum Sepolia');
const account=privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const wallet=createWalletClient({account,chain:sepolia,transport});
const targetBalance=parseEther('0.01');
for(const role of ['provider','relayer']) {
  const address=deployment[role];
  const balance=await publicClient.getBalance({address});
  if(balance>=targetBalance) {
    console.log(`${role}: ${formatEther(balance)} ETH, no top-up needed`);
    continue;
  }
  const amount=targetBalance-balance;
  const deployerBalance=await publicClient.getBalance({address:account.address});
  if(deployerBalance<amount+parseEther('0.02'))throw Error('Insufficient deployer reserve for role funding');
  const hash=await wallet.sendTransaction({to:address,value:amount});
  const receipt=await publicClient.waitForTransactionReceipt({hash});
  if(receipt.status!=='success')throw Error(`${role} funding transaction reverted`);
  console.log(`${role}: funded to 0.01 Sepolia ETH, tx ${hash}`);
}
