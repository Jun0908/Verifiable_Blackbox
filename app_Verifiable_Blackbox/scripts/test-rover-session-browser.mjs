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
const worldCheck=process.argv.includes('--world');
const children=[];let temporary,browser,page;
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
  if(worldCheck) {
    env.WORLD_SERVICE_URL='http://127.0.0.1:8798';env.WORLD_PUBLIC_URL=env.WORLD_SERVICE_URL;env.WORLD_INTERNAL_TOKEN='public-world-browser-internal-token';
    launch(process.execPath,[resolve(root,'services/world-idp/server.mjs')],{cwd:resolve(root,'services/world-idp'),env:{...process.env,
      MODE:'rehearsal',BASE_URL:env.WORLD_PUBLIC_URL,PORT:'8798',WORLD_INTERNAL_TOKEN:env.WORLD_INTERNAL_TOKEN,
      OPERATOR_CODE:'public-world-browser-operator-code',WORLD_APPROVER_OWNERS:owner.address,APP_RETURN_URL:base}});
    await waitFor(async()=>assert.equal((await fetch(env.WORLD_PUBLIC_URL+'/api/session')).status,200));
  }
  // These public test keys are used only by the isolated Anvil chain.
  env.DEMO_PROVIDER_PRIVATE_KEY=toHex(0xb0bn,{size:32});
  env.DEMO_TEE_PRIVATE_KEY=toHex(0xa11cen,{size:32});
  env.DEMO_RELAYER_PRIVATE_KEY='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  for(const file of ['tsconfig.json','next-env.d.ts']) generatedFiles.set(file,await readFile(resolve(web,file),'utf8'));
  launch(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3017'],{cwd:web,env});
  await waitFor(async()=>{const response=await fetch(base+'/api/demo/config',{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.equal((await response.json()).chainId,31337);});
  await fetch(base,{signal:AbortSignal.timeout(240000)});
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('response',async response=>{if(response.request().method()==='POST'&&/rover\/(complete|session\/(start|direct))$/.test(response.url()))console.log('Job response',response.url().split('/').slice(-2).join('/'),response.status(),response.status()!==200?await response.text():'ok');});
  await page.route('**/api/demo/rover/camera**',route=>route.fulfill({status:503,json:{error:'CAMERA_UNAVAILABLE'}}));
  await page.addInitScript(({core,owner,jobId,hash})=>{
    if(localStorage.getItem(`vbb-active-job-v1:31337:${core.toLowerCase()}:${owner.toLowerCase()}`))return;
    localStorage.setItem(`vbb-active-job-v1:31337:${core.toLowerCase()}:${owner.toLowerCase()}`,JSON.stringify({version:3,walletAddress:owner,verified:false,
      job:{jobId,source:'rover',scenario:'success',createTransactionHash:hash,fundTransactionHash:hash}}));
  },{core,owner:owner.address,jobId,hash:created.transactionHash});
  await page.goto(base+`/rover?job=${jobId}`,{waitUntil:'domcontentloaded',timeout:240000});
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();

  const request=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const stored=async id=>JSON.parse(await readFile(resolve(temporary,`sessions/31337-${core.toLowerCase()}/${id}.json`),'utf8')).sessions.at(-1);
  const credentials=r=>({jobId:r.context.jobId,sessionId:r.context.sessionId,signature:r.controlToken});
  const forward=page.getByRole('button',{name:'Forward',exact:true});
  const ready=async()=>{await page.getByText('Waiting for a Forward press',{exact:true}).waitFor();};
  const connect=async()=>{await page.getByRole('button',{name:'Connect robot',exact:true}).click();await waitFor(async()=>assert.equal(await forward.isEnabled(),true));};
  const tap=async(name,ms=40)=>{const button=page.getByRole('button',{name,exact:true});await button.focus();await page.keyboard.down('Space');await page.waitForTimeout(ms);await page.keyboard.up('Space');};
  let signatureCalls=0;
  page.on('request',r=>{if(r.url()===rpc&&r.postData()?.includes('personal_sign'))signatureCalls++;});
  await ready();
  assert.equal(await page.getByRole('button',{name:/Review execution|Sign these|Start observation|Load saved/}).count(),0);
  assert.equal(await page.getByRole('spinbutton').count(),0);
  assert.equal(await page.getByRole('checkbox').count(),0);
  const untouched=await stored(jobId);
  assert.equal(untouched.phase,'AUTHORIZED');assert.equal(untouched.run,undefined);
  assert.equal((await request('/api/demo/rover/complete',credentials(untouched))).status,409);
  assert.equal((await request('/api/demo/rover/session/start',{...credentials(untouched),signature:'0x'+'00'.repeat(32),action:'start'})).status,403);
  assert.equal((await request('/api/demo/rover/session/direct',{jobId,skipVideo:false},{origin:'http://evil.test'})).status,403);
  let reviewCalls=0;
  page.on('request',r=>{if(r.url().includes('/api/demo/rover/review'))reviewCalls++;});
  await page.getByRole('button',{name:'End controls & return to Step 3',exact:false}).click();
  await page.getByText('No Forward press has been recorded for this Job. Open robot controls and tap Forward once.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Verify & pay',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Resume saved payment',exact:true}).count(),0);
  await page.getByRole('link',{name:/2\. Operate robot/}).click();await ready();
  const finishAndPay=async()=>{
    assert.equal(await page.getByRole('button',{name:'View job video',exact:true}).count(),0);
    await page.getByRole('button',{name:'End controls & return to Step 3',exact:false}).click();
    await page.waitForURL(base+'/#step-3');
    await page.getByRole('button',{name:'Verify & pay',exact:true}).waitFor();
    assert.match(await page.locator('[aria-current=step]').innerText(),/Verify record/);
    assert.equal(await page.getByRole('button',{name:'View job video',exact:true}).count(),0);
    await page.getByRole('button',{name:'Verify & pay',exact:true}).click();
    await page.getByText('Payment completed',{exact:true}).waitFor();
    await page.getByRole('button',{name:'View job video',exact:true}).click();
  };
  await connect();
  for(const name of ['Reverse','Left','Right','Turn left','Turn right']) await tap(name);
  await page.getByRole('button',{name:'Release',exact:true}).click();
  await page.waitForTimeout(200);await tap('Hold to grab');
  assert.equal((await stored(jobId)).buttonAuthorization.pressedAt,undefined);
  await tap('Forward',40);
  assert.equal((await stored(jobId)).payment,undefined);
  await finishAndPay();
  await page.getByText('Raw recording analyzed by StegaVAR',{exact:true}).waitFor();
  const first=await stored(jobId);
  assert.ok(first.buttonAuthorization.pressedAt);assert.equal(first.payment.phase,'PAID');
  assert.equal(first.authorizationSignature,undefined);
  assert.equal(first.analysis.execution,'ANALYZED');
  assert.equal(first.analysis.recordingSha256,first.run.recording.sha256);
  if(worldCheck) {
    const {checkWorldDisclosure}=await import('./world-browser-checks.mjs');
    await checkWorldDisclosure({browser,page,root,jobId,rawSha256:first.run.recording.sha256});
    assert.equal((await request('/api/demo/world/disclosure',{jobId,owner:provider.address})).status,409);
    assert.equal((await request('/api/demo/world/disclosure',{jobId,sessionId:'00000000-0000-4000-8000-000000000000'})).status,409);
  }
  await page.getByRole('link',{name:/Return to robot controls/}).click();
  await page.getByText('Job complete \u00b7 Forward press recorded',{exact:true}).waitFor();
  await connect();await tap('Reverse');
  await page.getByRole('button',{name:'Stop and disconnect',exact:true}).click();
  await page.waitForTimeout(500);
  const blockBefore=await client.getBlockNumber({cacheTime:0});
  assert.equal((await request('/api/demo/rover/complete',credentials(first))).status,200);
  assert.equal(await client.getBlockNumber({cacheTime:0}),blockBefore);
  await page.getByRole('button',{name:'End controls & return to Step 3',exact:false}).click();
  await page.getByText('Payment completed',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Verify & pay',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Resume saved payment',exact:true}).count(),0);
  await page.getByRole('link',{name:/Return to robot controls/}).click();
  await page.getByText('Job complete \u00b7 Forward press recorded',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Connect robot',exact:true}).isEnabled(),true);
  assert.equal(reviewCalls,0);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByText('Job complete \u00b7 Forward press recorded',{exact:true}).waitFor();
  assert.equal(await client.getBlockNumber({cacheTime:0}),blockBefore);
  await mkdir(resolve(root,'artifacts/rover-session'),{recursive:true});
  await page.screenshot({path:resolve(root,'artifacts/rover-session/button-paid.png'),fullPage:true});
  const newJob=async()=>{
    const tx=await contract(core,erc8183Abi,'createAndFundDemo',[provider.address,evaluator,(await client.getBlock()).timestamp+86400n,'vbb://rover/forward-button-v1',hook]);
    const id=parseEventLogs({abi:erc8183Abi,logs:tx.logs,eventName:'JobCreated'})[0].args.jobId.toString();
    await page.evaluate(({core,owner,jobId,hash})=>localStorage.setItem(`vbb-active-job-v1:31337:${core.toLowerCase()}:${owner.toLowerCase()}`,JSON.stringify({version:3,walletAddress:owner,verified:false,
      job:{jobId,source:'rover',scenario:'success',createTransactionHash:hash,fundTransactionHash:hash}})),{core,owner:owner.address,jobId:id,hash:tx.transactionHash});
    await page.goto(base+`/rover?job=${id}`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Sign in',exact:true}).first().click();await ready();return id;
  };
  const tapId=await newJob();
  await connect();
  await page.route('**/api/demo/rover/control',async route=>{const body=route.request().postDataJSON();if(body?.action==='drive')await new Promise(r=>setTimeout(r,800));await route.continue();});
  await tap('Forward',40);
  await finishAndPay();await page.getByText('Did not move',{exact:true}).waitFor();
  const short=await stored(tapId);assert.ok(short.buttonAuthorization.pressedAt);
  assert.equal(short.run.commands.some(c=>c.y>0&&c.result==='SENT'),false);assert.equal(short.analysis.judgment,'STILL');
  await page.unroute('**/api/demo/rover/control');

  const skipId=await newJob();
  const settings=page.getByRole('button',{name:'Settings',exact:true});
  await settings.focus();await page.keyboard.down('Space');await page.waitForTimeout(1300);await page.keyboard.up('Space');
  await page.getByRole('checkbox',{name:'Skip video recognition',exact:true}).check();await ready();
  await connect();await tap('Forward',40);
  await finishAndPay();await page.getByText('Skipped',{exact:true}).waitFor();
  assert.equal((await stored(skipId)).analysis.execution,'SKIPPED');

  // Only the isolated inference process is stopped for this outage check.
  const inference=children[1];
  if(process.platform==='win32') await new Promise(done=>{const kill=spawn('taskkill',['/PID',String(inference.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('close',done);});
  else inference.kill();
  const offlineId=await newJob();
  await connect();await tap('Forward',40);
  await finishAndPay();
  await page.getByText('No analysis response',{exact:true}).waitFor();
  const offline=await stored(offlineId);
  assert.equal(offline.payment.phase,'PAID');assert.equal(offline.analysis.judgment,'INCONCLUSIVE');assert.equal(offline.analysis.execution,'UNAVAILABLE');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'\u65e5\u672c\u8a9e',exact:true}).click();
  await page.screenshot({path:resolve(root,'artifacts/rover-session/button-mobile.png'),fullPage:true});
  assert.equal(signatureCalls,0);
  const balance=await client.readContract({address:token,abi:parseAbi(['function balanceOf(address) view returns(uint256)']),functionName:'balanceOf',args:[provider.address]});
  assert.equal(balance,BigInt(first.context.budget)*4n);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['no operation signatures','40ms press saved without automatic payment','return to Step 3','payment before video viewing','full controls before and after payment','no press no payment','Raw recording analysis','early release prevents delayed movement','STILL remains STILL with payment','hidden video skip','receipt reload and payment idempotence','no hardware or Sepolia transactions']}));
} catch(error) {
  if(page) {console.error('PAGE:',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:resolve(root,'tmp/rover-test-failure.png'),fullPage:true}).catch(()=>{});}
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
