import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {bridgeEnvironment} from '../../M5stack_RoverC/scripts/bridge-environment.mjs';
import {parseEnv} from 'node:util';

const root = resolve(import.meta.dirname, '..');
const test = process.argv.includes('--test');
const roverMock=process.argv.includes('--rover-mock');
const roverReal=process.argv.includes('--rover');
const bridgePort=Number(process.env.VBB_BRIDGE_PORT||8765);
const phala = process.argv.includes('--phala');
const webPort = Number(process.env.VBB_WEB_PORT || 3000);
const rpcPort = Number(process.env.VBB_RPC_PORT || 8545);
const phalaPort = Number(process.env.VBB_PHALA_PORT || 3100);
const rpc = `http://127.0.0.1:${rpcPort}`;
const url = `http://127.0.0.1:${webPort}`;
const children = new Set();
const env = {...process.env, RUST_LOG:'error'};
const settings = resolve(root, '.env');
if (existsSync(settings)) {
  const values = parseEnv(readFileSync(settings, 'utf8'));
  for (const key of ['NEXT_PUBLIC_PRIVY_APP_ID', 'NEXT_PUBLIC_PRIVY_CLIENT_ID']) env[key] ||= values[key];
}
Object.assign(env, {
  NEXT_PUBLIC_CHAIN_ID:'31337', NEXT_PUBLIC_RPC_URL:rpc, DEMO_RPC_URL:rpc,
  NEXT_PUBLIC_LOCAL_DEMO:'true',
  DEMO_REVIEW_DIR:resolve(root,'apps/web/.demo-reviews',`local-${Date.now()}-${randomBytes(4).toString('hex')}`),
  DEMO_DEPLOYMENT_FILE:'demo.web.json', DEMO_VERIFIER_MODE:phala?'PHALA':'MOCK_TEE',
  DEPLOYER_PRIVATE_KEY:'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  DEMO_PROVIDER_PRIVATE_KEY:'0x'+'b0b'.padStart(64,'0'),
  DEMO_RELAYER_PRIVATE_KEY:'0x'+'d00d'.padStart(64,'0'),
  DEMO_TEE_PRIVATE_KEY:'0x'+'a11ce'.padStart(64,'0'),
  PHALA_VERIFIER_URL:`http://127.0.0.1:${phalaPort}`,
});
for (const key of ['SEPOLIA_RPC_URL','MOCK_USDC_ADDRESS','ERC8183_ADDRESS','EVIDENCE_HOOK_ADDRESS','EVALUATOR_ADDRESS','DEMO_PROVIDER_ADDRESS','DEMO_RELAYER_ADDRESS','DEMO_TEE_SIGNER_ADDRESS']) delete env[key];
if (test) {delete env.NEXT_PUBLIC_PRIVY_APP_ID; delete env.NEXT_PUBLIC_PRIVY_CLIENT_ID;}

async function freePort(port) {
  await new Promise((yes,no) => {const server=createServer(); server.once('error',()=>no(Error(`Port ${port} is already in use; stop its owner or set VBB_WEB_PORT/VBB_RPC_PORT/VBB_PHALA_PORT.`))); server.listen(port,'127.0.0.1',()=>server.close(yes));});
}
function launch(command,args,options={}) {
  const child=spawn(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true,...options});
  children.add(child); child.once('exit',()=>children.delete(child));
  return child;
}
async function run(command,args,options) {
  const child=launch(command,args,options);
  await new Promise((yes,no)=>{child.once('error',no);child.once('exit',code=>code===0?yes():no(Error(`${command} exited ${code}`)));});
}
async function ready(child,check) {
  const deadline=Date.now()+180000; let last;
  while(Date.now()<deadline) {
    if(child.exitCode!==null) throw Error('Service exited before becoming ready');
    try {await check();return;} catch(error) {last=error; await new Promise(r=>setTimeout(r,500));}
  }
  throw Error(`Service readiness timeout: ${last?.message}`);
}
const binary=tool=>{const path=resolve(root,'.tools/foundry-v1.7.1',tool+(process.platform==='win32'?'.exe':'')); return existsSync(path)?path:tool;};
async function stop() {
  for(const child of [...children].reverse()) {
    if(process.platform==='win32' && child.pid)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else child.kill();
  }
}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{void stop();process.exitCode=0;});

try {
  for(const port of [webPort,rpcPort,...(phala?[phalaPort]:[]),...((roverMock||roverReal)?[bridgePort]:[])]) await freePort(port);
  mkdirSync(resolve(root,'deployments'),{recursive:true});
  const anvil=launch(binary('anvil'),['--host','127.0.0.1','--port',String(rpcPort),'--chain-id','31337','--silent']);
  await ready(anvil,async()=>{const r=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(1000)});if((await r.json()).result!=='0x7a69')throw Error('Wrong local chain');});
  await run(binary('forge'),['script','packages/contracts/script/DeployWebDemo.s.sol:DeployWebDemo','--rpc-url',rpc,'--broadcast']);
  const deployment=JSON.parse(readFileSync(resolve(root,'deployments/demo.web.json'),'utf8'));
  if(phala) {
    const phalaRoot=resolve(process.env.PHALA_PROJECT_ROOT||resolve(root,'../../PhalaNetwork'));
    if(!existsSync(resolve(phalaRoot,'dist/index.js'))) throw Error('Build PHALA_PROJECT_ROOT first; see docs/PHALA.md');
    const verifier=launch(process.execPath,['dist/index.js'],{cwd:phalaRoot,env:{...env,PORT:String(phalaPort),RPC_URL:rpc,CHAIN_ID:'31337',ERC8183_ADDRESS:deployment.erc8183,EVIDENCE_HOOK_ADDRESS:deployment.evidenceHook,EVALUATOR_ADDRESS:deployment.evaluator,VERIFIER_MODE:'LOCAL_DEV',VERDICT_SIGNING_KEY:env.DEMO_TEE_PRIVATE_KEY}});
    await ready(verifier,async()=>{const r=await fetch(`${env.PHALA_VERIFIER_URL}/health`,{signal:AbortSignal.timeout(1000)});const h=await r.json();if(!h.ok||h.verifier.signerAddress.toLowerCase()!==deployment.mockTeeSigner.toLowerCase())throw Error('Phala signer mismatch');});
  }
  if(roverMock||roverReal) {
    env.VBB_BRIDGE_TOKEN=randomBytes(32).toString('hex');
    env.VBB_BRIDGE_PORT=String(bridgePort);
    env.VBB_BRIDGE_URL='http://127.0.0.1:'+bridgePort;
    let bridge;
    if(roverMock) bridge=launch(process.execPath,[resolve(root,'scripts/mock-bridge.mjs')]);
    else {
      const roverRoot=resolve(process.env.ROVER_PYTHON_ROOT||resolve(root,'../M5stack_RoverC/rover-python'));
      const python=process.env.ROVER_PYTHON||resolve(roverRoot,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
      if(!existsSync(python)||!existsSync(resolve(roverRoot,'web_bridge_server.py')))throw Error('Python or Rover project missing. Set ROVER_PYTHON_ROOT and create its .venv; see docs/ROVER.md');
      console.log('Hardware bridge: keep the robot in view. No ARM until Connect; an offline robot is reported by the UI.');
      bridge=launch(python,['web_bridge_server.py','--camera','--no-browser','--port',String(bridgePort)],{cwd:roverRoot,env:bridgeEnvironment(env)});
    }
    await ready(bridge,async()=>{const r=await fetch(env.VBB_BRIDGE_URL+'/status',{headers:{Authorization:'Bearer '+env.VBB_BRIDGE_TOKEN},signal:AbortSignal.timeout(1000)});if(!r.ok)throw Error('Bridge unavailable');});
  }
  const web=launch(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(webPort)],{cwd:resolve(root,'apps/web')});
  await ready(web,async()=>{const r=await fetch(`${url}/api/demo/config`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Web configuration unavailable');});
  console.log(`Local demo ready: ${url} (${phala?'Phala LOCAL_DEV':'MOCK_TEE'})`);
  console.log(`Review records: ${env.DEMO_REVIEW_DIR}; chain is disposable. Keep this path for server-only recovery.`);
  if(test) await run(process.execPath,[resolve(root,'scripts/test-web-api.mjs')],{env:{...env,DEMO_WEB_URL:url,EXPECTED_VERIFIER_MODE:phala?'LOCAL_DEV':'MOCK_TEE'}});
  else await new Promise((yes,no)=>{web.once('exit',code=>code===0?yes():no(Error(`Web exited ${code}`)));anvil.once('exit',()=>{web.kill();no(Error('Local chain stopped'));});});
} finally {await stop();}
