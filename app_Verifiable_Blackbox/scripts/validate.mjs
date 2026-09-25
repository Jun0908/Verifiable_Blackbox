import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const npm=process.env.npm_execpath;
if(!npm)throw Error('Run npm run validate');
const tasks=['typecheck:web','contracts:test','test:evidence','test:job-flow','test:job-history','test:rover','test:device','test:device-contracts','test:device-local'];
if(process.argv.includes('--phala'))tasks.push('test:demo-review','test:phala-local');
else tasks.push('test:web-api');
for(const task of tasks){
 console.log(`\nChecking ${task}`);
 const child=spawn(process.execPath,[npm,'run',task],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 const code=await new Promise((yes,no)=>{child.once('error',no);child.once('exit',yes);});
 if(code!==0){process.exitCode=code||1;break;}
}
if(!process.exitCode)console.log('All selected checks passed. Real hardware and TEE checks are separate.');
