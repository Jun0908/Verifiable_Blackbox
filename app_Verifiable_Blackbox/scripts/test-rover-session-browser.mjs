import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createPublicClient,createWalletClient,defineChain,encodeFunctionData,http,parseAbi,parseEventLogs,toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'..'),web=resolve(root,'apps/web');
const rpc='http://127.0.0.1:8557',base='http://127.0.0.1:3017';
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
  for(const url of [rpc,base]) {try {await fetch(url,{signal:AbortSignal.timeout(500)});throw Error('TEST_PORT_IN_USE');}catch(error){if(error.message==='TEST_PORT_IN_USE')throw error;}}
  await mkdir(resolve(root,'tmp'),{recursive:true});temporary=await mkdtemp(resolve(root,'tmp/rover-browser-'));
  launch(resolve(root,'.tools/foundry-v1.7.1/anvil'+(process.platform==='win32'?'.exe':'')),['--host','127.0.0.1','--port','8557','--chain-id','31337','--silent']);
  await waitFor(()=>client.getChainId());
  const token=await deploy('MockUSDC',[owner.address]);
  const implementation=await deploy('HackathonAgenticCommerce');
  const core=await deploy('ERC1967Proxy',[implementation,encodeFunctionData({abi:parseAbi(['function initialize(address,address)']),functionName:'initialize',args:[token,owner.address]})]);
  const hook=await deploy('DemoEvidenceHook',[core]);
  const tee=privateKeyToAccount(toHex(0xa11cen,{size:32}));
  const evaluator=await deploy('MockTeeEvaluator',[core,hook,tee.address]);
  await contract(core,parseAbi(['function setHookWhitelist(address,bool)']),'setHookWhitelist',[hook,true]);
  await contract(token,parseAbi(['function transferOwnership(address)']),'transferOwnership',[core]);
  const {erc8183Abi}=await import('../apps/web/lib/contracts.ts');
  const {roverAccessMessage,ROVER_JOB_DESCRIPTION}=await import('../apps/web/lib/rover-session.ts');
  const created=await contract(core,erc8183Abi,'createAndFundDemo',[provider.address,evaluator,(await client.getBlock()).timestamp+86400n,ROVER_JOB_DESCRIPTION,hook]);
  const jobId=parseEventLogs({abi:erc8183Abi,logs:created.logs,eventName:'JobCreated'})[0].args.jobId.toString();
  const env={...process.env,NEXT_PUBLIC_LOCAL_DEMO:'true',NEXT_PUBLIC_PRIVY_APP_ID:'',NEXT_PUBLIC_PRIVY_CLIENT_ID:'',NEXT_PUBLIC_CHAIN_ID:'31337',NEXT_PUBLIC_RPC_URL:rpc,DEMO_RPC_URL:rpc,
    DEMO_NEXT_DIST_DIR:'.next-rover-session-test',ROVER_SESSION_DIR:resolve(temporary,'sessions'),DEMO_REVIEW_DIR:resolve(temporary,'reviews'),
    MOCK_USDC_ADDRESS:token,ERC8183_ADDRESS:core,EVIDENCE_HOOK_ADDRESS:hook,EVALUATOR_ADDRESS:evaluator,
    DEMO_PROVIDER_ADDRESS:provider.address,
    DEMO_RELAYER_ADDRESS:owner.address,
    DEMO_TEE_SIGNER_ADDRESS:tee.address,DEMO_VERIFIER_MODE:'MOCK_TEE',VBB_BRIDGE_URL:'http://127.0.0.1:65530'};
  // These public test keys are used only by the isolated Anvil chain.
  env.DEMO_PROVIDER_PRIVATE_KEY=toHex(0xb0bn,{size:32});
  env.DEMO_RELAYER_PRIVATE_KEY='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  for(const file of ['tsconfig.json','next-env.d.ts']) generatedFiles.set(file,await readFile(resolve(web,file),'utf8'));
  launch(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3017'],{cwd:web,env});
  await waitFor(async()=>{const response=await fetch(base+'/api/demo/config');assert.equal(response.status,200);assert.equal((await response.json()).chainId,31337);});
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/demo/rover/control',route=>route.fulfill({json:{state:'idle',message:'Test',telemetryFresh:false,motorsRunning:false}}));
  await page.route('**/api/demo/rover/camera**',route=>route.fulfill({status:503,json:{error:'CAMERA_UNAVAILABLE'}}));
  await page.addInitScript(({core,owner,jobId,hash})=>{
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
  await mkdir(resolve(root,'artifacts/rover-session'),{recursive:true});
  await page.screenshot({path:resolve(root,'artifacts/rover-session/desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'日本語',exact:true}).click();
  await page.screenshot({path:resolve(root,'artifacts/rover-session/mobile.png'),fullPage:true});
  const request=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const access={action:'prepare',chainId:31337,core,jobId,requestId:crypto.randomUUID(),issuedAt:Math.floor(Date.now()/1000),options:{judgmentMode:'SKIP_VIDEO',operation:'FORWARD',durationMs:3000,speed:35}};
  const outsider=privateKeyToAccount(toHex(999n,{size:32}));
  assert.equal((await request('/api/demo/rover/session',{action:'prepare',access,signature:await outsider.signMessage({message:roverAccessMessage(access)})})).status,403);
  assert.equal((await request('/api/demo/rover/session',{action:'prepare',access},{origin:'http://evil.test'})).status,403);
  const review=await(await request('/api/demo/rover/review',{action:'prepare',jobId})).json();
  assert.equal(review.error,'ROVER_SESSION_PAYMENT_REQUIRED');
  const submitted=await(await request('/api/demo/provider',{action:'submit',jobId,scenario:'success'})).json();
  assert.equal(submitted.error,'ROVER_SESSION_PAYMENT_REQUIRED');
  assert.equal((await request('/api/demo/rover/complete',{jobId})).status,409);
  // Damaged session storage keeps the payment gate closed.
  await writeFile(resolve(temporary,`sessions/31337-${core.toLowerCase()}/${jobId}.json`),'null');
  assert.equal((await(await request('/api/demo/rover/review',{action:'prepare',jobId})).json()).error,'SESSION_RECORD_INVALID');
  assert.equal((await client.readContract({address:core,abi:erc8183Abi,functionName:'getJob',args:[BigInt(jobId)]})).status,1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['owner signatures','hidden settings keyboard and pointer','default reset','persisted authorization','mobile Japanese','origin and owner rejection','session payment gate','no robot movement or payment']}));
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
