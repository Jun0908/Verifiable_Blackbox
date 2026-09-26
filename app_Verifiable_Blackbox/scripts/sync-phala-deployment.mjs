import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';

const root=resolve(import.meta.dirname,'..');
const deployment=JSON.parse(readFileSync(resolve(root,'deployments/demo.testnet.json'),'utf8'));
if(deployment.chainId!==11155111)throw Error('Sepolia deployment required');
const phalaRoot=resolve(process.env.PHALA_PROJECT_ROOT||resolve(root,'../../PhalaNetwork'));
const envPath=resolve(phalaRoot,'.env');
const source=readFileSync(envPath,'utf8');
const current=parseEnv(source);
if(current.CHAIN_ID!=='11155111' || current.VERIFIER_MODE!=='PHALA_DSTACK')throw Error('Unexpected Phala chain or verifier mode');
if(!/^.+@sha256:[0-9a-f]{64}$/i.test(current.DOCKER_IMAGE||''))throw Error('Phala image must be pinned by digest');
const values={
  ERC8183_ADDRESS:deployment.erc8183,
  EVIDENCE_HOOK_ADDRESS:deployment.evidenceHook,
  EVALUATOR_ADDRESS:deployment.evaluator,
};
const newline=source.includes('\r\n')?'\r\n':'\n';
let output=source;
for(const [name,value] of Object.entries(values)) {
  const pattern=new RegExp(`^${name}=.*$`,'m');
  if(!pattern.test(output))throw Error(`${name} is missing from Phala .env`);
  output=output.replace(pattern,`${name}=${value}`);
}
if(output===source) {
  console.log('Phala contract addresses already match the Sepolia deployment.');
  process.exit(0);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=resolve(phalaRoot,`.env.before-vbb-sepolia-${stamp}`);
writeFileSync(backup,source,{mode:0o600,flag:'wx'});
const temporary=`${envPath}.sync.tmp`;
writeFileSync(temporary,output,{mode:0o600,flag:'wx'});
renameSync(temporary,envPath);
console.log(`Phala contract addresses updated; previous private configuration backed up at ${backup}`);
