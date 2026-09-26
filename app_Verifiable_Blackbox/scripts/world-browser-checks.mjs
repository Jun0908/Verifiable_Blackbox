import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
export async function checkWorldDisclosure({browser,page,root,jobId,rawSha256}) {
  await mkdir(resolve(root,'artifacts/rover-session'),{recursive:true});
  await page.getByRole('button',{name:'Create footage request link',exact:true}).click();
  const link=page.getByRole('link',{name:'Open request page'});await link.waitFor();
  const invitation=await link.getAttribute('href');assert.ok(invitation.startsWith('http://127.0.0.1:8798/?asset='));
  const viewer=await browser.newContext(), approver=await browser.newContext(), stranger=await browser.newContext();
  const errors=[];const watch=p=>p.on('pageerror',e=>errors.push(e.message));
  try {
    const v=await viewer.newPage(), a=await approver.newPage();watch(v);watch(a);
    await v.goto(invitation);await v.getByRole('button',{name:'English',exact:true}).click();
    assert.ok((await v.locator('#job').textContent()).includes(`Job ${jobId}`));
    assert.equal(await v.locator('#digest').textContent(),rawSha256);
    await v.getByRole('button',{name:'Request footage access',exact:true}).click();
    await v.locator('#approval-link').waitFor({state:'visible'});
    const approval=await v.locator('#approval-link').getAttribute('href');
    const id=new URL(approval).searchParams.get('approve'),media=`http://127.0.0.1:8798/media/${id}/frame/0`;
    assert.equal((await viewer.request.get(media)).status(),403);
    await a.goto(approval);await a.locator('#operator-code').fill('public-world-browser-operator-code');
    await a.getByRole('button',{name:'Continue as approver',exact:true}).click();
    await a.getByRole('button',{name:'Approve rehearsal / no World verification',exact:true}).click();
    await v.locator('#animation').waitFor({state:'visible'});
    await v.waitForFunction(()=>document.getElementById('animation').naturalWidth>0);
    assert.equal((await stranger.request.get(media)).status(),403);
    assert.equal((await approver.request.get(media)).status(),403);
    await v.screenshot({path:resolve(root,'artifacts/rover-session/world-granted.png'),fullPage:true});
    await v.setViewportSize({width:390,height:844});assert.ok(await v.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await a.getByRole('button',{name:'Revoke access',exact:true}).click();
    await v.locator('#animation').waitFor({state:'hidden'});
    assert.equal((await viewer.request.get(media)).status(),403);
    await v.getByRole('button',{name:'Request footage access',exact:true}).click();
    await v.locator('#approval-link').waitFor({state:'visible'});
    const denied=await v.locator('#approval-link').getAttribute('href');await a.goto(denied);
    await a.getByRole('button',{name:'Deny access',exact:true}).click();
    await v.getByText('Denied',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('World browser: Job recording, hash, English/Japanese, approval, viewer binding, decoded frames, mobile, revoke, denial passed');
  } finally {await viewer.close();await approver.close();await stranger.close();}
}
