import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2), source=args[args.indexOf('--from')+1], owner=args[args.indexOf('--owner')+1];
const target=resolve(root,'.env');
let text=await readFile(target,'utf8').catch(()=> '');
if(!text) {
  text=await readFile(resolve(root,'.env.example'),'utf8');
  if(args.includes('--from')) {
    const env=parseEnv(await readFile(resolve(source),'utf8'));
    for(const key of ['MODE','BASE_URL','PORT','WORLD_ISSUER','WORLD_CLIENT_ID','WORLD_CLIENT_SECRET','WORLD_CLIENT_AUTH','WORLD_SCOPE','WORLD_APPROVER_SUBS']) {
      if(env[key])text=text.replace(new RegExp(`^${key}=.*$`,'m'),()=>`${key}=${JSON.stringify(env[key])}`);
    }
  }
}
const set=(key,value)=>{const line=`${key}=${JSON.stringify(value)}`;text=new RegExp(`^${key}=`,'m').test(text)?text.replace(new RegExp(`^${key}=.*$`,'m'),()=>line):text+'\n'+line+'\n';};
let env=parseEnv(text);
for(const key of ['OPERATOR_CODE','WORLD_INTERNAL_TOKEN']) if(!env[key])set(key,randomBytes(32).toString('base64url'));
if(args.includes('--owner')) {if(!/^0x[0-9a-f]{40}$/i.test(owner))throw Error('Use the Job owner wallet address');set('WORLD_APPROVER_OWNERS',owner.toLowerCase());}
await writeFile(target,text,{mode:0o600});env=parseEnv(text);
await mkdir(resolve(root,'.local'),{recursive:true});await writeFile(resolve(root,'.local/operator-code.txt'),env.OPERATOR_CODE,{mode:0o600});
const webPath=resolve(root,'../../.env');let web=await readFile(webPath,'utf8');
for(const [key,value] of Object.entries({WORLD_SERVICE_URL:`http://127.0.0.1:${env.PORT||8787}`,WORLD_PUBLIC_URL:env.BASE_URL,WORLD_INTERNAL_TOKEN:env.WORLD_INTERNAL_TOKEN})) {
  const line=`${key}=${JSON.stringify(value)}`;web=new RegExp(`^${key}=`,'m').test(web)?web.replace(new RegExp(`^${key}=.*$`,'m'),()=>line):web+'\n'+line+'\n';
}
await writeFile(webPath,web,{mode:0o600});
console.log('Saved private service and web settings. Operator code: services/world-idp/.local/operator-code.txt');
console.log(`Authorized owner: ${env.WORLD_APPROVER_OWNERS?'configured':'missing; run setup with --owner 0x...'}`);
console.log('Restart the web app after configuration. No credentials were printed.');
