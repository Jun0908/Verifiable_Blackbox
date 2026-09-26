import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const base=process.env.DEMO_WEB_URL || 'http://127.0.0.1:3000';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : process.platform==='win32' ? {channel:'msedge'} : {})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(base+'/ledger',{timeout:60000});
  await page.getByRole('heading',{name:'Job 1',exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh from MultiBaas'}).click();
  await page.getByText('Fetch complete',{exact:true}).waitFor();
  await page.getByText('View evidence and receipt',{exact:true}).click();
  assert.match(await page.locator('.ledger-payment').innerText(),/Matched/);
  const view=await(await page.request.get(base+'/api/ledger')).json();
  assert.equal(view.payments.length,1);assert.equal(view.payments[0].amountDisplay,'100.00');
  assert.equal(view.payments[0].status,'matched');
  await mkdir('artifacts/ledger',{recursive:true});
  await page.screenshot({path:'artifacts/ledger/payments-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'日本語',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'artifacts/ledger/payments-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'EN',exact:true}).click();
  for (const [status,label] of [['matched','Matched'],['confirming','Confirming'],['incomplete','Missing evidence'],['mismatch','Mismatch']]) {
    const mocked={...view,payments:[{...view.payments[0],status}]};
    await page.route('**/api/ledger',route=>route.fulfill({json:mocked}));
    await page.reload();await page.getByText(label,{exact:true}).waitFor();
    await page.unroute('**/api/ledger');
  }
  await page.getByRole('button',{name:'Monthly sample',exact:true}).click();
  await page.getByText('120 / 3',{exact:true}).waitFor();
  assert.match(await page.locator('.ledger-totals').innerText(),/12.00/);
  await page.getByText('View usage details',{exact:true}).first().click();
  assert.equal(await page.locator('tbody').first().locator('tr').count(),40);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'artifacts/ledger/monthly-mobile.png',fullPage:true});
  for(const kind of ['summary','details']) {
    const wait=page.waitForEvent('download');
    await page.getByRole('link',{name:kind==='summary'?'Download summary CSV':'Download details CSV'}).click();
    const download=await wait;assert.equal(download.suggestedFilename(),`sample-2026-09-${kind}.csv`);
    await download.saveAs(`artifacts/ledger/${download.suggestedFilename()}`);
  }
  await page.locator('input[type=month]').fill('2026-08');
  await page.getByText('No sample usage for this month.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: live Job 1, payment details, four mocked match states, Japanese/English, mobile, monthly totals, CSV downloads and empty month.');
} finally {await browser.close();}
