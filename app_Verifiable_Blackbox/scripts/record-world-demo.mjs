// Records saved Job footage disclosure through the official World Sandbox.
// This script never connects to hardware or sends a chain transaction.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const invitationArg=process.argv.indexOf('--invitation');
if(invitationArg<0 || !process.argv[invitationArg+1])throw Error('Provide --invitation with an existing Job footage request link');
const env=parseEnv(await readFile(resolve(root,'services/world-idp/.env'),'utf8'));
const invitation=new URL(process.argv[invitationArg+1]);
assert.equal(invitation.origin,new URL(env.BASE_URL).origin,'Use the configured World service');
assert.ok(invitation.searchParams.get('asset'),'A saved Job recording is required');
assert.equal(env.MODE,'world','This recording requires the official World connection');
assert.equal(env.WORLD_ISSUER,'https://sandbox.auth.world.org','Record the event Sandbox explicitly');
invitation.searchParams.delete('lang');
const output=resolve(root,'artifacts/world-demo',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const options={viewport:{width:1920,height:1080},recordVideo:{dir:output,size:{width:1920,height:1080}},timezoneId:'Asia/Tokyo'};
const viewer=await browser.newContext(options),approver=await browser.newContext(options);
let v,a,viewerStart,approverStart;
const seconds=start=>(Date.now()-start)/1000;
const hold=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeline={};
async function english(page) {
  if(await page.locator('#language').innerText()==='English')await page.locator('#language').click();
  await page.getByRole('heading',{name:'Footage opened by human approval.',exact:true}).waitFor();
}
async function click(page,selector) {
  await page.locator(selector).hover();await hold(600);await page.locator(selector).click();
}
async function denied(context,url) {
  for(let attempt=0;attempt<3;attempt++) {
    const response=await context.request.get(url);
    if(response.status()>=500 && attempt<2){await hold(700);continue;}
    assert.equal(response.status(),403,'Media must require an active grant for this browser');return;
  }
}
try {
  viewerStart=Date.now();v=await viewer.newPage();
  await v.goto(invitation.href);await v.locator('#request:enabled').waitFor();await english(v);
  const job=await v.locator('#job').innerText();
  timeline.job=job;timeline.source='official-world-sandbox';timeline.savedRecording=true;
  timeline.viewerIntroStart=seconds(viewerStart);
  await hold(2500);await v.mouse.wheel(0,180);await hold(1500);
  await click(v,'#request');await v.locator('#approval-link').waitFor({state:'visible'});await hold(3500);
  const approval=new URL(await v.locator('#approval-link').getAttribute('href'));approval.searchParams.delete('lang');
  const id=approval.searchParams.get('approve'),media=`${invitation.origin}/media/${id}/frame/0`;
  await denied(viewer,media);
  timeline.viewerIntroEnd=seconds(viewerStart);

  approverStart=Date.now();a=await approver.newPage();
  await a.goto(approval.href);await a.locator('#operator-code').waitFor();await english(a);
  await a.mouse.wheel(0,180);await hold(1500);
  timeline.approverStart=seconds(approverStart);
  await a.locator('#operator-code').fill(env.OPERATOR_CODE);await hold(1000);
  await click(a,'#login-button');await a.locator('#approve:visible').waitFor();await hold(2500);
  let issuerSeen=false;
  a.on('framenavigated',frame=>{if(frame===a.mainFrame()&&frame.url().startsWith(env.WORLD_ISSUER+'/'))issuerSeen=true;});
  await click(a,'#approve');
  await a.waitForURL(url=>url.origin===new URL(env.WORLD_ISSUER).origin,{timeout:30000});
  await a.waitForURL(url=>url.origin===invitation.origin,{timeout:60000});
  await a.locator('#revoke:visible').waitFor({timeout:20000});await english(a);
  assert.ok(issuerSeen,'Official World authentication page must be visited');
  await a.mouse.wheel(0,180);await hold(2500);
  timeline.approverEnd=seconds(approverStart);
  await v.locator('#animation').waitFor({state:'visible',timeout:15000});
  await v.waitForFunction(()=>document.getElementById('animation').naturalWidth>0);
  assert.match(await v.locator('#events').innerText(),/World result verified/);
  await denied(approver,media);
  timeline.viewerGrantedStart=seconds(viewerStart);
  await v.screenshot({path:resolve(output,'granted.png')});
  await hold(10000);
  timeline.viewerGrantedEnd=seconds(viewerStart);
  timeline.revokeStart=seconds(approverStart);
  await click(a,'#revoke');await hold(1800);
  timeline.revokeEnd=seconds(approverStart);
  await v.locator('#animation').waitFor({state:'hidden'});
  await denied(viewer,media);
  await v.locator('#error').waitFor({state:'hidden'});
  assert.equal(await v.locator('#remaining').innerText(),'');
  timeline.viewerRevokedStart=seconds(viewerStart);
  await hold(3500);await v.screenshot({path:resolve(output,'revoked.png')});
  timeline.viewerRevokedEnd=seconds(viewerStart);
  timeline.ok=true;
  console.log(JSON.stringify({ok:true,job,output,checks:['official Sandbox authentication','saved recording playback','viewer session binding','revocation','no hardware or payment']}));
} catch(error) {
  timeline.ok=false;timeline.error=error instanceof Error?error.name:'Error';
  if(typeof error.actual==='number')timeline.actual=error.actual;
  if(typeof error.expected==='number')timeline.expected=error.expected;
  console.error('Recording incomplete; see local screenshots. No successful authentication is claimed.');
  console.error(JSON.stringify(timeline));
  if(a)await a.screenshot({path:resolve(output,'approval-failure.png')}).catch(()=>{});
  if(v)await v.screenshot({path:resolve(output,'viewer-failure.png')}).catch(()=>{});
  process.exitCode=1;
} finally {
  await viewer.close();await approver.close();
  if(v)await v.video().saveAs(resolve(output,'viewer.webm'));
  if(a)await a.video().saveAs(resolve(output,'approver.webm'));
  await browser.close();
  await writeFile(resolve(output,'timeline.json'),JSON.stringify(timeline,null,2));
}
