// Exercise real Blackbox route functions against the real Python bridge on loopback.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {bridgeEnvironment} from './bridge-environment.mjs';
const root=resolve(import.meta.dirname,'..');
const app=resolve(process.env.VBB_APP_ROOT || resolve(root,'../app_Verifiable_Blackbox'));
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=source=>stripTypeScriptTypes(source,{mode:'strip'});
const source=file=>readFileSync(resolve(app,'apps/web',file),'utf8');
const config=dataUrl(compile(source('lib/server/bridge-config.ts').replace('import "server-only";','')));
const route=async name=>import(dataUrl(compile(source(`app/api/demo/rover/${name}/route.ts`).replaceAll('@/lib/server/bridge-config',config))));
const control=await route('control'), camera=await route('camera');
const request=(path,body)=>new Request('http://127.0.0.1:3000/api/demo/rover/'+path,{
  method:body?'POST':'GET',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{})});
const call=async(body)=>{
  const response=await control[body?'POST':'GET'](request('control',body));
  assert.equal(response.status,200,await response.clone().text());return response.json();
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
assert.equal((await call()).state,'idle');
const {session}=await call({action:'activate'});
for(let n=0;n<30 && !(await call()).telemetryFresh;n++)await wait(40);
assert.equal((await call()).telemetryFresh,true);
await call({action:'drive',session,sequence:1,direction:'forward',speed:35});
await wait(120);
assert.equal((await call()).motorsRunning,true);
await call({action:'release',session,sequence:2});
await call({action:'gripper',session,sequence:3,gripperAction:'close'});
await wait(160);
await call({action:'release',session,sequence:4});
assert.ok((await call()).gripperAngle>25);
const info=await camera.GET(request('camera'));
assert.equal(info.status,200);
let frame;
for(let n=0;n<30;n++) {frame=await camera.GET(request('camera?frame=1'));if(frame.status===200)break;await wait(100);}
assert.equal(frame.status,200);assert.equal(frame.headers.get('content-type'),'image/jpeg');
assert.ok((await frame.arrayBuffer()).byteLength>100);
assert.equal((await camera.POST(request('camera',{action:'power',enabled:false}))).status,200);
assert.equal((await camera.GET(request('camera?frame=1'))).status,204);
await call({action:'stop',session});
for(let n=0;n<30 && (await call()).state==='stopping';n++)await wait(50);
const stopped=await call();assert.equal(stopped.state,'idle');
assert.equal(stopped.physicalMovementVerified,false);assert.equal(stopped.paymentEnabled,false);
// Execute the production POST export alone: it must have no dependencies or payment calls.
const complete=source('app/api/demo/rover/complete/route.ts');
assert.ok(complete.includes('export async function POST()'));
const completeRoute=await import(dataUrl(compile(complete.slice(complete.indexOf('export async function POST()')))));
assert.equal((await completeRoute.POST()).status,409);
const activeUrl=dataUrl(compile(source('lib/active-job.ts')));
const flow=await import(dataUrl(compile(source('lib/job-flow.ts')).replace('./active-job',activeUrl)));
const active=await import(activeUrl);
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
const scope={chainId:31337,core:'0x'+'11'.repeat(20),wallet:'0x'+'22'.repeat(20)};
const tx='0x'+'33'.repeat(32);
active.storeDemoState(scope,{jobId:7n,source:'rover',scenario:'success',createTransactionHash:tx,fundTransactionHash:tx},{verified:false});
const before=JSON.stringify(active.loadDemoState(scope));
const job=flow.readActiveRobotJob(scope);assert.equal(job.jobId,'7');
flow.recordControlEnded(job);assert.equal(flow.controlHasEnded(job),true);
assert.equal(JSON.stringify(active.loadDemoState(scope)),before);
assert.equal(flow.readActiveRobotJob({...scope,wallet:'0x'+'44'.repeat(20)}),undefined);
const env=bridgeEnvironment({PATH:'test',VBB_BRIDGE_TOKEN:'test',ROVER_API_TOKEN:'test',ETHEREUM_PRIVATE_KEY:'omit',DEMO_PROVIDER_PRIVATE_KEY:'omit',SEPOLIA_RPC_URL:'omit',PHALA_TOKEN:'omit'});
assert.deepEqual(Object.keys(env).sort(),['PATH','PYTHONUNBUFFERED','ROVER_API_TOKEN','VBB_BRIDGE_TOKEN'].sort());
// The application signature client against a loopback-only, PUBLIC fixture endpoint.
const {requestDevice}=await import(pathToFileURL(resolve(app,'parts/device-signature/device.mjs')));
const {makeFixture,testJob}=await import(pathToFileURL(resolve(app,'parts/device-signature/test/fixture.mjs')));
let calls=0;
const signer=createServer(async(req,res)=>{
  assert.equal(req.headers['x-rover-token'],'simulation-token');
  assert.equal(req.url,'/device-signature');
  let body='';for await(const chunk of req)body+=chunk;
  if(req.method==='POST')assert.equal(new URLSearchParams(body).get('job_id'),'0x'+'7'.padStart(64,'0'));
  const busy=++calls===1;res.writeHead(busy?202:200,{'content-type':'application/json'});
  res.end(JSON.stringify(busy?{state:'busy'}:{...makeFixture(),state:'ready'}));
});
await new Promise(r=>signer.listen(0,'127.0.0.1',r));
try {assert.equal((await requestDevice({url:`http://127.0.0.1:${signer.address().port}`,token:'simulation-token',job:testJob})).state,'ready');}
finally {await new Promise(r=>signer.close(r));}
console.log('PASS: Blackbox routes -> Python bridge -> simulated device; camera, gripper, stop, Job marker, blocked payment, isolated credentials and signature client.');
