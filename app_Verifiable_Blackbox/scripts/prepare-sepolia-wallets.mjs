import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';

const root=resolve(import.meta.dirname,'..');
const envPath=resolve(root,'.env');
const source=readFileSync(envPath,'utf8');
const current=parseEnv(source);
const names=['DEPLOYER_PRIVATE_KEY','DEMO_PROVIDER_PRIVATE_KEY','DEMO_RELAYER_PRIVATE_KEY'];
for(const name of names) {
  if(current[name]?.trim())throw Error(`${name} already has a value; refusing to replace a wallet`);
}

const wallets=Object.fromEntries(names.map(name=>{
  const privateKey=generatePrivateKey();
  return [name,{privateKey,address:privateKeyToAccount(privateKey).address}];
}));
const values={
  DEPLOYER_PRIVATE_KEY:wallets.DEPLOYER_PRIVATE_KEY.privateKey,
  DEMO_PROVIDER_PRIVATE_KEY:wallets.DEMO_PROVIDER_PRIVATE_KEY.privateKey,
  DEMO_RELAYER_PRIVATE_KEY:wallets.DEMO_RELAYER_PRIVATE_KEY.privateKey,
  DEMO_PROVIDER_ADDRESS:wallets.DEMO_PROVIDER_PRIVATE_KEY.address,
  DEMO_RELAYER_ADDRESS:wallets.DEMO_RELAYER_PRIVATE_KEY.address,
};
const newline=source.includes('\r\n')?'\r\n':'\n';
let output=source;
for(const [name,value] of Object.entries(values)) {
  const pattern=new RegExp(`^${name}=.*$`,'m');
  if(pattern.test(output))output=output.replace(pattern,`${name}=${value}`);
  else output+=`${output.endsWith(newline)?'':newline}${name}=${value}${newline}`;
}
const temporary=`${envPath}.wallets.tmp`;
writeFileSync(temporary,output,{mode:0o600,flag:'wx'});
renameSync(temporary,envPath);
for(const name of names)console.log(`${name.replace('_PRIVATE_KEY','')}: ${wallets[name].address}`);
