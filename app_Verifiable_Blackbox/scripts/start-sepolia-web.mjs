import {spawn, spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
loadEnvFile(resolve(root,'.env'));
if(process.env.NEXT_PUBLIC_CHAIN_ID!=='11155111')throw Error('NEXT_PUBLIC_CHAIN_ID must be 11155111');
if(process.env.DEMO_DEPLOYMENT_FILE!=='demo.testnet.json')throw Error('DEMO_DEPLOYMENT_FILE must be demo.testnet.json');
if(!process.env.NEXT_PUBLIC_PRIVY_APP_ID)throw Error('NEXT_PUBLIC_PRIVY_APP_ID is required');
const webEnv={...process.env};
const development=process.argv.includes('--dev');
const buildOnly=process.argv.includes('--build');
if(development&&buildOnly)throw Error('Choose --dev or --build');
webEnv.DEMO_NEXT_DIST_DIR=development?'.next':'.next-demo';
delete webEnv.DEPLOYER_PRIVATE_KEY;
delete webEnv.DEMO_CLIENT_PRIVATE_KEY;
delete webEnv.DEMO_TEE_PRIVATE_KEY;
const withRover=!process.argv.includes('--no-rover');
const bridgePort=Number(process.env.VBB_BRIDGE_PORT || 8765);
const children=new Set();
let stopping=false;

async function freePort(port) {
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid bridge port');
  await new Promise((yes,no)=>{
    const server=createServer();
    server.once('error',()=>no(Error(`Port ${port} is occupied. Close the previous Demo or standalone Rover launcher first.`)));
    server.listen(port,'127.0.0.1',()=>server.close(yes));
  });
}
function launch(command,args,options) {
  const child=spawn(command,args,{stdio:'inherit',windowsHide:true,...options});
  children.add(child);
  const done=new Promise(resolve=>{
    child.once('error',error=>resolve({error}));
    child.once('exit',code=>{children.delete(child);resolve({code});});
  });
  return {child,done};
}
function stop() {
  if(stopping)return;
  stopping=true;
  for(const child of [...children].reverse()) {
    if(process.platform==='win32'&&child.pid)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else child.kill('SIGTERM');
  }
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);

try {
  if(buildOnly) {
    const result=await launch(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:resolve(root,'apps/web'),env:webEnv}).done;
    if(result.error)throw result.error;
    process.exitCode=result.code ?? 1;
  } else {
  if(!development&&!existsSync(resolve(root,'apps/web/.next-demo/BUILD_ID')))throw Error('Build the demo first: node scripts/start-sepolia-web.mjs --build');
  await freePort(3000);
  const services=[];
  if(withRover) {
    await freePort(bridgePort);
    const roverRoot=resolve(process.env.ROVER_PYTHON_ROOT || resolve(root,'../../M5stack_RoverC/rover-python'));
    const python=process.env.ROVER_PYTHON || resolve(roverRoot,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
    if(!existsSync(python)||!existsSync(resolve(roverRoot,'web_bridge_server.py')))throw Error('Rover Python environment missing. Set ROVER_PYTHON_ROOT / ROVER_PYTHON, or use --no-rover for a wallet-only demo. See docs/internal/ROVER.md.');
    webEnv.VBB_BRIDGE_TOKEN=randomBytes(32).toString('hex');
    webEnv.VBB_BRIDGE_URL=`http://127.0.0.1:${bridgePort}`;
    // The robot process needs OS and Rover settings, not Ethereum signing keys or RPC credentials.
    const osNames=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','HOMEDRIVE','HOMEPATH','COMSPEC']);
    const bridgeEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>osNames.has(name.toUpperCase())||name.startsWith('ROVER_')));
    Object.assign(bridgeEnv,{VBB_BRIDGE_TOKEN:webEnv.VBB_BRIDGE_TOKEN,PYTHONUNBUFFERED:'1'});
    const bridge=launch(python,['web_bridge_server.py','--camera','--no-browser','--port',String(bridgePort)],{cwd:roverRoot,env:bridgeEnv});
    services.push(bridge);
    const deadline=Date.now()+30_000;
    let ready=false;
    while(Date.now()<deadline&&!stopping) {
      if(bridge.child.exitCode!==null)throw Error('Rover bridge exited during startup. Check rover-python/.env and Python dependencies.');
      try {
        const response=await fetch(webEnv.VBB_BRIDGE_URL+'/status',{headers:{Authorization:`Bearer ${webEnv.VBB_BRIDGE_TOKEN}`},signal:AbortSignal.timeout(1000)});
        const state=await response.json();
        if(response.ok&&state.ok&&state.state==='idle'&&state.simulated!==true) {ready=true;break;}
      } catch { /* Wait for this owned bridge to bind its port. */ }
      await new Promise(r=>setTimeout(r,200));
    }
    if(!ready)throw Error('Rover bridge did not become ready');
    console.log(`Hardware bridge ready on ${bridgePort}; settings: ${roverRoot}. Connect robot will ARM; startup does not.`);
  } else {
    delete webEnv.VBB_BRIDGE_TOKEN;
    delete webEnv.VBB_BRIDGE_URL;
    console.log('Web-only mode: robot controls are unavailable (--no-rover).');
  }
  services.push(launch(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),development?'dev':'start','--hostname','127.0.0.1','--port','3000'],{cwd:resolve(root,'apps/web'),env:webEnv}));
  const result=await Promise.race(services.map(service=>service.done));
  if(!stopping) {
    if(result.error)throw result.error;
    process.exitCode=result.code ?? 1;
  }
  }
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
} finally {stop();}
