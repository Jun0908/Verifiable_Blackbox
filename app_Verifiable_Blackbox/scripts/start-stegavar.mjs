import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {parseEnv} from 'node:util';

const root=resolve(import.meta.dirname,'..');
const file=resolve(root,'.env');
const env={...(existsSync(file)?parseEnv(readFileSync(file,'utf8')):{}),...process.env};
const port=Number(env.STEGAVAR_PORT||4178),webPort=Number(env.VBB_WEB_PORT||3000);
if(![port,webPort].every(value=>Number.isInteger(value)&&value>0&&value<65536))throw Error('Invalid service port');
const python=resolve(root,env.STEGAVAR_PYTHON||`services/stegavar/.venv/${process.platform==='win32'?'Scripts/python.exe':'bin/python'}`);
const base=new URL(env.STEGAVAR_URL||`http://127.0.0.1:${port}`);
if(base.origin!==`http://127.0.0.1:${port}`||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw Error('STEGAVAR_URL must match the local STEGAVAR_PORT');
env.STEGAVAR_URL=base.origin;
env.STEGAVAR_DATA_ROOT=resolve(root,env.STEGAVAR_DATA_ROOT||'apps/web/public/stegavar');
const children=new Set();let stopping=false;
function launch(command,args,options={}) {
  const child=spawn(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true,...options});
  children.add(child);child.on('error',()=>{});child.once('exit',()=>children.delete(child));return child;
}
function stop() {
  if(stopping)return;stopping=true;
  for(const child of [...children].reverse()) {
    if(child.exitCode!==null||!child.pid)continue;
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else child.kill('SIGTERM');
  }
}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function free(port) {
  return await new Promise(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});
}
async function health() {
  try {const response=await fetch(`${base.origin}/health`,{signal:AbortSignal.timeout(1000)});return response.ok?await response.json():null;}catch{return null;}
}
async function run() {
  let pythonChild;
  let status=await health();
  if(status?.application==='vbb-stegavar'&&status.version===1)console.log('StegaVAR analysis service connected.');
  else if(!await free(port))console.log(`Port ${port} is occupied; video browsing is available. Configure STEGAVAR_PORT and STEGAVAR_URL for analysis.`);
  else if(!existsSync(python))console.log('Python environment missing; video browsing is available. See services/stegavar/README.md.');
  else {
    const osNames=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','HOMEDRIVE','HOMEPATH','COMSPEC']);
    const pythonEnv=Object.fromEntries(Object.entries(env).filter(([key])=>osNames.has(key.toUpperCase())||key.startsWith('STEGAVAR_')));
    pythonEnv.PYTHONUNBUFFERED='1';
    const check=spawnSync(python,['-c','import numpy, PIL'],{env:pythonEnv,windowsHide:true,stdio:'pipe',timeout:15000});
    if(check.status!==0)console.log('Python dependencies unavailable; video browsing is available. Install services/stegavar/requirements.txt.');
    else {
      pythonChild=launch(python,['services/stegavar/scripts/inference_server.py','--port',String(port)],{env:pythonEnv});
      const deadline=Date.now()+15000;
      while(!stopping&&Date.now()<deadline&&pythonChild.exitCode===null) {
        status=await health();if(status?.application==='vbb-stegavar'&&status.version===1)break;
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      if(status?.application!=='vbb-stegavar')console.log('Analysis service unavailable; video browsing is available.');
      else console.log(`CPU analysis ready: ${status.available.length} case/scene pairs. X-CLIP files: ${status.model_available?'available':'optional for motion cases'}.`);
    }
  }
  if(stopping)return;
  let web;
  if(await free(webPort))web=launch(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(webPort)],{cwd:resolve(root,'apps/web')});
  else {
    const response=await fetch(`http://127.0.0.1:${webPort}/api/stegavar/assets/catalog.json`,{signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    const local=JSON.parse(readFileSync(resolve(env.STEGAVAR_DATA_ROOT,'catalog.json'),'utf8'));
    if(!response.ok||data.version!==1||JSON.stringify(data.cases?.map(row=>row.scenes.map(s=>s.manifest.recovered_frames_sha256)))!==JSON.stringify(local.cases.map(row=>row.scenes.map(s=>s.manifest.recovered_frames_sha256))))throw Error(`Port ${webPort} does not serve the configured StegaVAR data`);
    console.log('Web application connected.');
  }
  console.log(`StegaVAR: http://127.0.0.1:${webPort}/stegavar`);
  const deadline=Date.now()+60000;
  let ready=false;
  while(!stopping&&Date.now()<deadline) {
    try {
      const response=await fetch(`http://127.0.0.1:${webPort}/api/stegavar/assets/catalog.json`,{signal:AbortSignal.timeout(1500)});
      if(response.ok){ready=true;break;}
    }catch { /* Wait for the web application. */ }
    if(web?.exitCode!==undefined&&web.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready&&!stopping)throw Error('Web startup did not become ready');
  if(status?.application==='vbb-stegavar') {
    const response=await fetch(`http://127.0.0.1:${webPort}/api/stegavar/health`,{signal:AbortSignal.timeout(5000)});
    const data=await response.json();
    if(!response.ok||data.servicePid!==status.pid)throw Error('Restart the Web application with matching STEGAVAR_URL before connecting this analysis service');
  }
  if(process.argv.includes('--check')||stopping)return;
  if(web)await new Promise(resolve=>{web.once('exit',resolve);web.once('error',resolve);});
  else if(pythonChild&&pythonChild.exitCode===null)await new Promise(resolve=>{pythonChild.once('exit',resolve);pythonChild.once('error',resolve);});
}
try{await run();}catch(error){console.error(error.message);process.exitCode=1;}finally{stop();}
