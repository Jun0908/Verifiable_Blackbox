import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const base=process.env.DEMO_WEB_URL||'http://127.0.0.1:3000';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(60000);
const errors=[],writes=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/demo/'))writes.push(r.url());});
const ready=()=>page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Play'&&!button.disabled));
const readyAnalysis=()=>page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Reanalyze recovered video'&&!button.disabled));
try {
  await page.goto(base+'/stegavar',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'A rover on vacation?',exact:true}).waitFor();
  const catalog=await(await page.request.get(base+'/api/stegavar/assets/catalog.json')).json();
  for(const [name,label] of [['Moving rover','Motion detected'],['Stationary rover','Nearly stationary']]) {
    await page.getByRole('button',{name,exact:true}).click();
    for(const scene of ['Surfing','Hiking','Camping']) {
      await page.getByRole('button',{name:scene,exact:true}).click();await ready();
      await page.getByRole('heading',{name:label,exact:true}).waitFor();
      await page.getByRole('button',{name:'Reveal video',exact:true}).click();
      assert.equal(await page.locator('.stg-player canvas').count(),2);
      await page.getByRole('slider',{name:'Video position'}).press('End');
      await page.waitForFunction(()=>document.querySelector('output')?.textContent==='3.9 / 4.0 s');
      const caseId=name==='Moving rover'?'rover-moving':'rover-still';
      const sceneId=({Surfing:'surf',Hiking:'hike',Camping:'camp'})[scene];
      assert.ok(await page.evaluate(async ({caseId,sceneId})=>{
        const canvases=Array.from(document.querySelectorAll('.stg-player canvas'));
        for(const [index,kind] of ['stego','recovered'].entries()) {
          const img=new Image();img.src=`/api/stegavar/assets/${caseId}/${sceneId}/${kind}/0039.png`;
          await img.decode();const reference=document.createElement('canvas');reference.width=384;reference.height=216;
          reference.getContext('2d').drawImage(img,0,0);
          const a=reference.getContext('2d').getImageData(0,0,384,216).data;
          const b=canvases[index].getContext('2d').getImageData(0,0,384,216).data;
          if(!a.every((value,i)=>value===b[i]))return false;
        }return true;
      },{caseId,sceneId}));
      await readyAnalysis();await page.getByRole('button',{name:'Reanalyze recovered video',exact:true}).click();
      await page.getByText('ANALYSIS FROM THIS REQUEST',{exact:true}).waitFor();
    }
  }
  for(const mode of ['Cover','Difference ×12','Stego']) {
    await page.getByRole('button',{name:mode,exact:true}).click();await ready();
  }
  await page.getByRole('slider',{name:'Video position'}).press('Home');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('input[type=range]').value)>1);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  for(const [status,error] of [[409,'BUSY'],[503,'UNAVAILABLE'],[504,'TIMEOUT'],[422,'INPUT_INTEGRITY'],[500,'ANALYSIS_FAILED']]) {
    await page.route('**/api/stegavar/analyze',route=>route.fulfill({status,json:{error}}));
    await readyAnalysis();await page.getByRole('button',{name:'Reanalyze recovered video',exact:true}).click();
    await page.locator('.stg-analysis [role=alert]').waitFor();
    assert.equal(await page.getByText('ANALYSIS FROM THIS REQUEST',{exact:true}).count(),1);
    assert.ok(await page.getByRole('button',{name:'Play',exact:true}).isEnabled());
    await page.unroute('**/api/stegavar/analyze');
  }
  const wrong={...catalog.cases[1].scenes[2].savedAnalysis,execution:'live',recovered_frames_sha256:'0'.repeat(64),request_id:'test',analyzed_at:new Date().toISOString(),total_seconds:1};
  await page.route('**/api/stegavar/analyze',route=>route.fulfill({json:wrong}));
  await readyAnalysis();await page.getByRole('button',{name:'Reanalyze recovered video',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'does not match'}).waitFor();await page.unroute('**/api/stegavar/analyze');
  await page.route('**/api/stegavar/analyze',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.fulfill({json:wrong}).catch(()=>{});});
  await readyAnalysis();await page.getByRole('button',{name:'Reanalyze recovered video',exact:true}).click();
  await page.getByRole('button',{name:'Moving rover',exact:true}).click();await ready();
  await page.waitForTimeout(1200);
  assert.equal(await page.getByText('SAVED ANALYSIS',{exact:true}).count(),1);
  assert.equal(await page.locator('.stg-analysis [role=alert]').count(),0);
  await page.unroute('**/api/stegavar/analyze');
  await page.route('**/api/stegavar/health',route=>route.fulfill({status:503,json:{error:'UNAVAILABLE'}}));
  await page.getByRole('button',{name:'Check service status',exact:true}).click();
  await page.getByText('Service unavailable',{exact:true}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Play',exact:true}).isEnabled());
  assert.equal(await page.getByText('SAVED ANALYSIS',{exact:true}).count(),1);
  await page.unroute('**/api/stegavar/health');
  await page.getByRole('button',{name:'Check service status',exact:true}).click();await readyAnalysis();
  await page.getByRole('button',{name:'Reveal video',exact:true}).click();
  await mkdir('artifacts/stegavar',{recursive:true});
  await page.screenshot({path:'artifacts/stegavar/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'日本語',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'artifacts/stegavar/mobile.png',fullPage:true});
  await page.evaluate(()=>{window.stegavarNavigationMarker=123;window.stegavarWalletFrames=Array.from(document.querySelectorAll('iframe')).filter(frame=>frame.src.includes('privy'));});
  await page.getByRole('link',{name:'台帳',exact:true}).click();
  await page.getByRole('link',{name:'StegaVAR',exact:true}).click();
  await page.getByRole('heading',{name:'Rover、休暇中？',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.stegavarNavigationMarker),123);
  assert.ok(await page.evaluate(()=>window.stegavarWalletFrames.every(frame=>frame.isConnected)));
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('PASS: six real analyses, synchronized pixels and seek, playback, failure retention, case switch, unavailable service, languages, mobile, shared navigation and no payment calls.');
}finally {await browser.close();}
