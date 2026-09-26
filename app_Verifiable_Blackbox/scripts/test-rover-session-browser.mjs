import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createPublicClient,createWalletClient,defineChain,encodeFunctionData,http,parseAbi,parseEventLogs,toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'..'),web=resolve(root,'apps/web');
const rpc='http://127.0.0.1:8557',base='http://127.0.0.1:3017';
const bridgeBase='http://127.0.0.1:8769',bridgeToken='rover-session-public-test-token-only';
const chain=defineChain({id:31337,name:'Rover session test',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const owner=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const provider=privateKeyToAccount(toHex(0xb0bn,{size:32}));
const client=createPublicClient({chain,transport:http(rpc,{retryCount:0}),pollingInterval:50});
const wallet=createWalletClient({account:owner,chain,transport:http(rpc)});
const children=[];let temporary,browser;
const generatedFiles=new Map();
const launch=(cmd,args,options={})=>{
  const child=spawn(cmd,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});
  let log='';child.stdout.on('data',chunk=>{log=(log+chunk).slice(-12000);});child.stderr.on('data',chunk=>{log=(log+chunk).slice(-12000);});
  child.on('error',error=>{log+=error.message;});child.log=()=>log;children.push(child);return child;
};
const waitFor=async fn=>{let last;for(let i=0;i<360;i++){try{return await fn();}catch(error){last=error;await new Promise(r=>setTimeout(r,500));}}throw last;};
async function receipt(hash){const value=await client.waitForTransactionReceipt({hash});assert.equal(value.status,'success');return value;}
async function deploy(name,args=[]){const artifact=JSON.parse(await readFile(resolve(root,`out/${name}.sol/${name}.json`),'utf8'));return (await receipt(await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,args}))).contractAddress;}
async function contract(address,abi,functionName,args){return receipt(await wallet.writeContract({address,abi,functionName,args}));}

try {
  for(const url of [rpc,base,bridgeBase,'http://127.0.0.1:4179/health']) {try {await fetch(url,{signal:AbortSignal.timeout(500)});throw Error('TEST_PORT_IN_USE');}catch(error){if(error.message==='TEST_PORT_IN_USE')throw error;}}
  await mkdir(resolve(root,'tmp'),{recursive:true});temporary=await mkdtemp(resolve(root,'tmp/rover-browser-'));
  launch(process.platform==='win32'?'py':'python3', [...(process.platform==='win32'?['-3.11']:[]),'-m','tests.serve_job_fixture','--port','8769',
    '--directory',resolve(temporary,'recordings'),'--token',bridgeToken],{cwd:resolve(root,'../M5stack_RoverC/rover-python')});
  await waitFor(async()=>assert.equal((await fetch(bridgeBase+'/status',{headers:{Authorization:`Bearer ${bridgeToken}`}})).status,200));
  launch(resolve(root,'services/stegavar/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),
    [resolve(root,'services/stegavar/scripts/inference_server.py'),'--port','4179']);
  await waitFor(async()=>assert.equal((await fetch('http://127.0.0.1:4179/health')).status,200));
  launch(resolve(root,'.tools/foundry-v1.7.1/anvil'+(process.platform==='win32'?'.exe':'')),['--host','127.0.0.1','--port','8557','--chain-id','31337','--silent']);
  await waitFor(()=>client.getChainId());
  await client.request({method:'anvil_setBalance',params:[provider.address,toHex(10n**19n)]});
  const token=await deploy('MockUSDC',[owner.address]);
  const implementation=await deploy('HackathonAgenticCommerce');
  const core=await deploy('ERC1967Proxy',[implementation,encodeFunctionData({abi:parseAbi(['function initialize(address,address)']),functionName:'initialize',args:[token,owner.address]})]);
  const hook=await deploy('DemoEvidenceHook',[core]);
  const tee=privateKeyToAccount(toHex(0xa11cen,{size:32}));
  const evaluator=await deploy('MockTeeEvaluator',[core,hook,tee.address]);
  await contract(core,parseAbi(['function setHookWhitelist(address,bool)']),'setHookWhitelist',[hook,true]);
  await contract(token,parseAbi(['function transferOwnership(address)']),'transferOwnership',[core]);
  const {erc8183Abi}=await import('../apps/web/lib/contracts.ts');
  const {roverAccessMessage,roverAuthorizationMessage,roverRunRequest,ROVER_JOB_DESCRIPTION}=await import('../apps/web/lib/rover-session.ts');
  const created=await contract(core,erc8183Abi,'createAndFundDemo',[provider.address,evaluator,(await client.getBlock()).timestamp+86400n,ROVER_JOB_DESCRIPTION,hook]);
  const jobId=parseEventLogs({abi:erc8183Abi,logs:created.logs,eventName:'JobCreated'})[0].args.jobId.toString();
  const env={...process.env,NEXT_PUBLIC_LOCAL_DEMO:'true',NEXT_PUBLIC_PRIVY_APP_ID:'',NEXT_PUBLIC_PRIVY_CLIENT_ID:'',NEXT_PUBLIC_CHAIN_ID:'31337',NEXT_PUBLIC_RPC_URL:rpc,DEMO_RPC_URL:rpc,
    DEMO_NEXT_DIST_DIR:'.next-rover-session-test',STEGAVAR_URL:'http://127.0.0.1:4179',ROVER_SESSION_DIR:resolve(temporary,'sessions'),DEMO_REVIEW_DIR:resolve(temporary,'reviews'),
    MOCK_USDC_ADDRESS:token,ERC8183_ADDRESS:core,EVIDENCE_HOOK_ADDRESS:hook,EVALUATOR_ADDRESS:evaluator,
    DEMO_PROVIDER_ADDRESS:provider.address,
    DEMO_RELAYER_ADDRESS:owner.address,
    DEMO_TEE_SIGNER_ADDRESS:tee.address,DEMO_VERIFIER_MODE:'MOCK_TEE',VBB_BRIDGE_URL:bridgeBase,VBB_BRIDGE_TOKEN:bridgeToken};
  // These public test keys are used only by the isolated Anvil chain.
  env.DEMO_PROVIDER_PRIVATE_KEY=toHex(0xb0bn,{size:32});
  env.DEMO_TEE_PRIVATE_KEY=toHex(0xa11cen,{size:32});
  env.DEMO_RELAYER_PRIVATE_KEY='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  for(const file of ['tsconfig.json','next-env.d.ts']) generatedFiles.set(file,await readFile(resolve(web,file),'utf8'));
  launch(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3017'],{cwd:web,env});
  await waitFor(async()=>{const response=await fetch(base+'/api/demo/config');assert.equal(response.status,200);assert.equal((await response.json()).chainId,31337);});
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('response',async response=>{if(response.request().method()==='POST'&&response.url().endsWith('/rover/complete')&&response.status()!==200)console.error('Payment response:',await response.text());});
  await page.route('**/api/demo/rover/control',route=>route.fulfill({json:{state:'idle',message:'Test',telemetryFresh:false,motorsRunning:false}}));
  await page.route('**/api/demo/rover/camera**',route=>route.fulfill({status:503,json:{error:'CAMERA_UNAVAILABLE'}}));
  await page.addInitScript(({core,owner,jobId,hash})=>{
    if(localStorage.getItem(`vbb-active-job-v1:31337:${core.toLowerCase()}:${owner.toLowerCase()}`))return;
    localStorage.setItem(`vbb-active-job-v1:31337:${core.toLowerCase()}:${owner.toLowerCase()}`,JSON.stringify({version:3,walletAddress:owner,verified:false,
      job:{jobId,source:'rover',scenario:'success',createTransactionHash:hash,fundTransactionHash:hash}}));
  },{core,owner:owner.address,jobId,hash:created.transactionHash});
  await page.goto(base+`/rover?job=${jobId}`,{waitUntil:'domcontentloaded',timeout:240000});
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('heading',{name:'Plan this run',exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox').count(),0);
  const settings=page.getByRole('button',{name:'Settings',exact:true});
  await settings.focus();await page.keyboard.down('Space');await page.waitForTimeout(200);await page.keyboard.up('Space');
  assert.equal(await page.getByRole('checkbox').count(),0);
  await page.keyboard.down('Space');await page.waitForTimeout(1300);await page.keyboard.up('Space');
  const skip=page.getByRole('checkbox',{name:'Skip video recognition',exact:true});
  assert.equal(await skip.isChecked(),false);await skip.check();
  await page.getByRole('button',{name:'Review execution conditions',exact:true}).click();
  await page.getByRole('button',{name:'Sign these conditions',exact:true}).waitFor();
  await page.getByRole('button',{name:'Change conditions',exact:true}).click();
  assert.equal(await page.getByRole('checkbox').count(),0);
  const box=await settings.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(1300);await page.mouse.up();
  assert.equal(await skip.isChecked(),false);await skip.check();
  await page.getByRole('button',{name:'Review execution conditions',exact:true}).click();
  await page.getByRole('button',{name:'Sign these conditions',exact:true}).click();
  await page.getByText('Authorization saved. Driving has not started.',{exact:true}).waitFor();
  assert.equal(await settings.isDisabled(),true);
  const stored=JSON.parse(await readFile(resolve(temporary,`sessions/31337-${core.toLowerCase()}/${jobId}.json`),'utf8'));
  assert.equal(stored.sessions.at(-1).context.options.judgmentMode,'SKIP_VIDEO');
  assert.equal(stored.sessions.at(-1).phase,'AUTHORIZED');
  assert.equal(stored.sessions[0].phase,'SUPERSEDED');
  await page.getByRole('button',{name:'Start observation',exact:true}).click();
  const forward=page.getByRole('button',{name:'Hold Forward',exact:true});
  await forward.focus();await page.keyboard.down('Space');await page.waitForTimeout(700);await page.keyboard.up('Space');
  await page.getByText('Operation records saved. Stop confirmed.',{exact:true}).waitFor();
  await page.getByText('Payment completed',{exact:true}).waitFor();
  const executed=JSON.parse(await readFile(resolve(temporary,`sessions/31337-${core.toLowerCase()}/${jobId}.json`),'utf8')).sessions.at(-1);
  assert.equal(executed.phase,'CAPTURED');assert.equal(executed.run.stop.confirmed,true);
  assert.equal(executed.run.forwardPressed,true);
  assert.deepEqual(executed.run.inputs.map(e=>e.action),['press','release']);
  assert.ok(executed.run.commands.some(event=>event.result==='SENT'&&event.y===1));
  const duplicate=await(await fetch(bridgeBase+'/jobs/start',{method:'POST',headers:{Authorization:`Bearer ${bridgeToken}`,'content-type':'application/json'},body:JSON.stringify(executed.run.request)})).json();
  assert.equal(duplicate.operationHash,executed.run.operationHash);
  await mkdir(resolve(root,'artifacts/rover-session'),{recursive:true});
  await page.screenshot({path:resolve(root,'artifacts/rover-session/desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'日本語',exact:true}).click();
  await page.screenshot({path:resolve(root,'artifacts/rover-session/mobile.png'),fullPage:true});
  const request=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const access={action:'prepare',chainId:31337,core,jobId,requestId:crypto.randomUUID(),issuedAt:Math.floor(Date.now()/1000),options:{judgmentMode:'SKIP_VIDEO',operation:'FORWARD',durationMs:3000,speed:35}};
  const outsider=privateKeyToAccount(toHex(999n,{size:32}));
  assert.equal((await request('/api/demo/rover/session',{action:'prepare',access,signature:await outsider.signMessage({message:roverAccessMessage(access)})})).status,409);
  assert.equal((await request('/api/demo/rover/session',{action:'prepare',access},{origin:'http://evil.test'})).status,403);
  const review=await(await request('/api/demo/rover/review',{action:'prepare',jobId})).json();
  assert.equal(review.error,'ROVER_SESSION_PAYMENT_REQUIRED');
  const submitted=await(await request('/api/demo/provider',{action:'submit',jobId,scenario:'success'})).json();
  assert.equal(submitted.error,'ROVER_SESSION_PAYMENT_REQUIRED');
  assert.equal((await request('/api/demo/rover/complete',{jobId})).status,409);
  const blockBeforeRetry=await client.getBlockNumber({cacheTime:0});
  const retry=await request('/api/demo/rover/complete',{jobId,sessionId:executed.context.sessionId,signature:executed.authorizationSignature});
  assert.equal(retry.status,200);
  assert.equal(await client.getBlockNumber({cacheTime:0}),blockBeforeRetry);
  // Damaged session storage keeps the payment gate closed.
  await writeFile(resolve(temporary,`sessions/31337-${core.toLowerCase()}/${jobId}.json`),'null');
  assert.equal((await(await request('/api/demo/rover/review',{action:'prepare',jobId})).json()).error,'SESSION_RECORD_INVALID');
  assert.equal((await client.readContract({address:core,abi:erc8183Abi,functionName:'getJob',args:[BigInt(jobId)]})).status,3);
  // A stopped VIDEO fixture exercises the additional approval independently of manual driving.
  const videoCreated=await contract(core,erc8183Abi,'createAndFundDemo',[provider.address,evaluator,(await client.getBlock()).timestamp+86400n,ROVER_JOB_DESCRIPTION,hook]);
  const videoJobId=parseEventLogs({abi:erc8183Abi,logs:videoCreated.logs,eventName:'JobCreated'})[0].args.jobId.toString();
  const videoAccess={...access,jobId:videoJobId,requestId:crypto.randomUUID(),issuedAt:Math.floor(Date.now()/1000),options:{...access.options,judgmentMode:'VIDEO'}};
  const videoPreparedResponse=await request('/api/demo/rover/session',{action:'prepare',access:videoAccess,signature:await owner.signMessage({message:roverAccessMessage(videoAccess)})});
  assert.equal(videoPreparedResponse.status,200);
  const videoContext=(await videoPreparedResponse.json()).record.context;
  const videoSignature=await owner.signMessage({message:roverAuthorizationMessage(videoContext)});
  assert.equal((await request('/api/demo/rover/session',{action:'authorize',jobId:videoJobId,sessionId:videoContext.sessionId,signature:videoSignature})).status,200);
  const videoPath=resolve(temporary,`sessions/31337-${core.toLowerCase()}/${videoJobId}.json`);
  const videoStored=JSON.parse(await readFile(videoPath,'utf8')),videoRecord=videoStored.sessions.at(-1);
  const time=Math.max(videoContext.issuedAt,Date.now()/1000);
  videoRecord.phase='CAPTURED';
  videoRecord.run={version:1,request:roverRunRequest(videoContext),phase:'CAPTURED',forwardPressed:false,inputs:[],
    operationStartedAt:time,operationEndedAt:time,operationHash:'ab'.repeat(32),
    commands:[{sessionId:videoContext.sessionId,sequence:1,sentAt:time,x:0,y:1,z:0,speed:35,deadman:true,result:'SENT'}],
    stop:{requestedAt:time,confirmed:true,confirmedAt:time},recording:{state:'ERROR',frames:[],error:'RECORDING_UNAVAILABLE'}};
  videoRecord.videoJudgment='INCONCLUSIVE';
  await writeFile(videoPath,JSON.stringify(videoStored));
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.evaluate(({core,owner,jobId,hash})=>{
    localStorage.setItem(`vbb-active-job-v1:31337:${core.toLowerCase()}:${owner.toLowerCase()}`,JSON.stringify({version:3,walletAddress:owner,verified:false,
      job:{jobId,source:'rover',scenario:'success',createTransactionHash:hash,fundTransactionHash:hash}}));
  },{core,owner:owner.address,jobId:videoJobId,hash:videoCreated.transactionHash});
  await page.goto(base+`/rover?job=${videoJobId}`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Load saved session',exact:true}).click();
  await page.getByText('Operation records saved. Stop confirmed.',{exact:true}).waitFor();
  await settings.focus();await page.keyboard.down('Space');await page.waitForTimeout(1300);await page.keyboard.up('Space');
  assert.equal(await skip.isDisabled(),true);
  assert.equal((await request('/api/demo/rover/session',{action:'prepare-skip',jobId:videoJobId,sessionId:videoContext.sessionId,signature:videoSignature})).status,409);
  videoRecord.run.forwardPressed=true;
  videoRecord.run.inputs=[{sessionId:videoContext.sessionId,action:'press',sequence:0,receivedAt:time}];
  await writeFile(videoPath,JSON.stringify(videoStored));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Load saved session',exact:true}).click();
  await page.getByText('Operation records saved. Stop confirmed.',{exact:true}).waitFor();
  await settings.focus();await page.keyboard.down('Space');await page.waitForTimeout(1300);await page.keyboard.up('Space');
  assert.equal(await skip.isChecked(),false);await skip.check();
  const approvalButton=page.getByRole('button',{name:'Sign video skip approval',exact:true});
  await approvalButton.click();
  await page.getByText('Video skip approval saved for this operation record.',{exact:true}).waitFor();
  await page.getByText('Payment completed',{exact:true}).waitFor();
  const approvedRecord=JSON.parse(await readFile(videoPath,'utf8')).sessions.at(-1);
  assert.ok(approvedRecord.skipApproval.signature);
  assert.deepEqual(approvedRecord.context,videoContext);
  assert.deepEqual(approvedRecord.run,videoRecord.run);
  assert.equal(approvedRecord.authorizationSignature,videoSignature);
  assert.equal(approvedRecord.videoJudgment,'INCONCLUSIVE');
  assert.equal(approvedRecord.analysis.judgment,'INCONCLUSIVE');
  assert.equal(approvedRecord.payment.phase,'PAID');
  await page.screenshot({path:resolve(root,'artifacts/rover-session/skip-approval.png'),fullPage:true});
  assert.equal((await client.readContract({address:core,abi:erc8183Abi,functionName:'getJob',args:[BigInt(videoJobId)]})).status,3);
  const rawCreated=await contract(core,erc8183Abi,'createAndFundDemo',[provider.address,evaluator,(await client.getBlock()).timestamp+86400n,ROVER_JOB_DESCRIPTION,hook]);
  const rawJobId=parseEventLogs({abi:erc8183Abi,logs:rawCreated.logs,eventName:'JobCreated'})[0].args.jobId.toString();
  const rawAccess={...videoAccess,jobId:rawJobId,requestId:crypto.randomUUID(),issuedAt:Math.floor(Date.now()/1000)};
  const rawPrepared=await(await request('/api/demo/rover/session',{action:'prepare',access:rawAccess,signature:await owner.signMessage({message:roverAccessMessage(rawAccess)})})).json();
  const rawContext=rawPrepared.record.context;
  assert.equal((await request('/api/demo/rover/session',{action:'authorize',jobId:rawJobId,sessionId:rawContext.sessionId,
    signature:await owner.signMessage({message:roverAuthorizationMessage(rawContext)})})).status,200);
  await page.evaluate(({core,owner,jobId,hash})=>{
    localStorage.setItem(`vbb-active-job-v1:31337:${core.toLowerCase()}:${owner.toLowerCase()}`,JSON.stringify({version:3,walletAddress:owner,verified:false,
      job:{jobId,source:'rover',scenario:'success',createTransactionHash:hash,fundTransactionHash:hash}}));
  },{core,owner:owner.address,jobId:rawJobId,hash:rawCreated.transactionHash});
  await page.goto(base+`/rover?job=${rawJobId}`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Load saved session',exact:true}).click();
  await page.getByRole('button',{name:'Start observation',exact:true}).click();
  await forward.focus();await page.keyboard.down('Space');await page.waitForTimeout(900);await page.keyboard.up('Space');
  await page.getByText('Moved',{exact:true}).waitFor();
  await page.getByText('Payment completed',{exact:true}).waitFor();
  await page.getByRole('img',{name:"This session's Raw recording",exact:true}).waitFor();
  const rawStored=JSON.parse(await readFile(resolve(temporary,`sessions/31337-${core.toLowerCase()}/${rawJobId}.json`),'utf8')).sessions.at(-1);
  assert.equal(rawStored.analysis.judgment,'MOVING');assert.equal(rawStored.analysis.execution,'ANALYZED');
  assert.equal(rawStored.analysis.recordingSha256,rawStored.run.recording.sha256);
  assert.equal(rawStored.run.forwardPressed,true);
  assert.equal(rawStored.payment.phase,'PAID');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(root,'artifacts/rover-session/raw-analysis.png'),fullPage:true});
  const paidBlock=await client.getBlockNumber({cacheTime:0});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Load saved session',exact:true}).click();
  await page.getByText('Payment completed',{exact:true}).waitFor();
  assert.equal(await client.getBlockNumber({cacheTime:0}),paidBlock);
  const stillCreated=await contract(core,erc8183Abi,'createAndFundDemo',[provider.address,evaluator,(await client.getBlock()).timestamp+86400n,ROVER_JOB_DESCRIPTION,hook]);
  const stillJobId=parseEventLogs({abi:erc8183Abi,logs:stillCreated.logs,eventName:'JobCreated'})[0].args.jobId.toString();
  const stillAccess={...videoAccess,jobId:stillJobId,requestId:crypto.randomUUID(),issuedAt:Math.floor(Date.now()/1000)};
  const stillPrepared=await(await request('/api/demo/rover/session',{action:'prepare',access:stillAccess,signature:await owner.signMessage({message:roverAccessMessage(stillAccess)})})).json();
  const stillContext=stillPrepared.record.context;
  const stillSignature=await owner.signMessage({message:roverAuthorizationMessage(stillContext)});
  const stillInput={jobId:stillJobId,sessionId:stillContext.sessionId,signature:stillSignature};
  assert.equal((await request('/api/demo/rover/session',{action:'authorize',...stillInput})).status,200);
  assert.equal((await request('/api/demo/rover/session/start',{action:'start',...stillInput})).status,200);
  await waitFor(async()=>{const r=await(await request('/api/demo/rover/session/status',stillInput)).json();assert.equal(r.record.phase,'OPERATING');});
  await new Promise(r=>setTimeout(r,1000));
  assert.equal((await request('/api/demo/rover/session/input',{...stillInput,action:'finish',sequence:0})).status,200);
  await waitFor(async()=>{const r=await(await request('/api/demo/rover/session/status',stillInput)).json();assert.equal(r.record.phase,'CAPTURED');});
  const stillResult=await(await request('/api/demo/rover/session/analyze',stillInput)).json();
  assert.equal(stillResult.record.analysis.judgment,'STILL');
  assert.equal(stillResult.record.run.forwardPressed,false);
  assert.equal((await(await request('/api/demo/rover/complete',stillInput)).json()).error,'FORWARD_PRESS_REQUIRED');
  assert.equal((await request('/api/demo/rover/session',{action:'prepare-skip',...stillInput})).status,409);
  assert.equal((await client.readContract({address:core,abi:erc8183Abi,functionName:'getJob',args:[BigInt(stillJobId)]})).status,1);
  const balance=await client.readContract({address:token,abi:parseAbi(['function balanceOf(address) view returns(uint256)']),functionName:'balanceOf',args:[provider.address]});
  assert.equal(balance,BigInt(rawStored.context.budget)*3n);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['owner signatures','hidden settings keyboard and pointer','default reset','persisted authorization','mock Bridge drive and confirmed stop','recorded commands','idempotent start and payment','mobile Japanese','origin and owner rejection','session payment gate','stopped VIDEO fixture additional signature','missing forward press rejection','preserved INCONCLUSIVE and original approval','local Anvil payments only; no hardware movement or Sepolia transfers']}));
} catch(error) {
  for(const child of children) console.error(child.log());
  throw error;
} finally {
  await browser?.close();
  for(const child of children.reverse()) if(child.pid && child.exitCode===null) {
    if(process.platform==='win32') await new Promise(done=>{const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('close',done);});
    else child.kill();
  }
  for(const [file,content] of generatedFiles) await writeFile(resolve(web,file),content);
  if(temporary){assert.ok(temporary.startsWith(resolve(root,'tmp')+sep));await rm(temporary,{recursive:true,force:true});}
}
