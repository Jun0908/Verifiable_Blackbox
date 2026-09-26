const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), approverId = params.get('approve'), assetId = params.get('asset');
let lang = params.get('lang') || localStorage.getItem('world-language') || 'ja';
const t = (en, ja) => lang === 'ja' ? ja : en;
let session, current, busy = false, frameBusy = false, frameIndex = 0, mediaEpoch = 0, objectUrl, nextFrameAt = 0;
const storageKey = `disclosure-request:${assetId || ''}`;
let requestId = approverId || sessionStorage.getItem(storageKey);
const stateName = value => ({pending:t('Awaiting approval','承認待ち'),approved:t('Access granted','閲覧可能'),expired:t('Expired','期限切れ'),denied:t('Denied','開示しない'),cancelled:t('Cancelled','取消済み'),revoked:t('Revoked','閲覧終了')})[value] || t('Private','非公開');
const eventName = value => ({requested:t('Access requested','開示を依頼'),world_started:t('World verification started','World認証を開始'),world_verified:t('World result verified','Worldの応答を検証'),rehearsal_approved:t('Rehearsal approved','リハーサルで承認'),access_granted:t('Viewing permission granted','閲覧を許可'),viewed:t('Footage delivered','映像を配信'),denied:t('Access denied','開示を拒否'),cancelled:t('Request cancelled','依頼を取消'),revoked:t('Permission revoked','閲覧許可を取消'),world_incomplete:t('World verification incomplete','World認証が未完了')})[value] || value;
function labels() {
  document.documentElement.lang = lang;
  const text = {
    heading:t('Footage opened by human approval.','映像は、人の承認で開く。'),
    lead:t('Request access to one Job recording. An authorized approver can grant five minutes of viewing.','このJobの記録映像の開示を依頼します。承認者が許可すると5分間閲覧できます。'),
    'locked-text':t('Footage stays private until approved.','承認されるまで映像は配信されません。'),
    role:approverId?t('Approve this request','この依頼を承認する'):t('Request access','映像の開示を依頼する'),
    request:t('Request footage access','映像の開示を依頼'),
    'pending-text':t('Send the approval link to your approver. This page updates automatically.','承認用リンクを承認者へ渡してください。この画面は自動更新されます。'),
    'approval-link':t('Open approver page','承認者画面を開く'), 'link-label':t('Approval link','承認用リンク'),
    cancel:t('Cancel request','依頼を取り消す'), 'code-label':t('Approver code','承認者コード'), 'login-button':t('Continue as approver','承認者として入る'),
    approve:session?.mode==='rehearsal'?t('Approve rehearsal / no World verification','リハーサルで承認・World未接続'):t('Approve disclosure with World','Worldで開示を承認'),
    deny:t('Deny access','開示しない'), revoke:t('Revoke access','閲覧許可を取り消す'),
    permission:t('Allow this viewer to access this recording for 5 minutes after approval.','表示中の映像を、この閲覧者へ承認後5分間だけ開示します。'),
    scope:t('Receipt reference only. This display does not certify that the footage hash is committed onchain.','Receiptとの関連表示です。映像ハッシュがオンチェーンで検証されたことを示す表示ではありません。'),
    language:lang==='ja'?'English':'日本語'
  };
  for (const [id,value] of Object.entries(text)) $(id).textContent=value;
  $('mode').textContent=session?.mode==='world'?(session.sandbox?'WORLD / EVENT MOCK ID':'WORLD / OIDC'):'REHEARSAL / WORLD DISCONNECTED';
  $('notice').textContent=session?.mode==='world'?(session.sandbox?t('Official event environment uses mock identities. This is not production human verification.','公式イベント環境は模擬IDを使用します。本番の人間認証ではありません。'):t('World authentication is checked by the server.','Worldの認証結果をサーバーで確認します。')):t('Local rehearsal: World is not connected.','ローカルリハーサル：Worldには接続していません。');
}
function report(error) {$('error').hidden=false; $('error').textContent=t('Unable to complete the request. Check the connection, approver code, and link validity.','処理できませんでした。接続・承認者コード・リンクの有効性を確認してください。');}
async function api(url, body) {
  const response=await fetch(url,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json(); if(!response.ok){const e=Error();e.status=response.status;throw e;} return data;
}
function lockVideo() {
  mediaEpoch++; $('animation').hidden=true; $('animation').removeAttribute('src'); $('locked').hidden=false;
  if(objectUrl) URL.revokeObjectURL(objectUrl); objectUrl=undefined;
}
function metadata(clip) {
  $('job').textContent=clip?`${clip.chainId} / ${clip.core} / Job ${clip.jobId}`:'—';
  $('owner').textContent=clip?.owner || '—'; $('digest').textContent=clip?.sha256 || '—'; $('receipt').textContent=clip?.receiptId || '—';
}
function render() {
  labels(); metadata(current?.clip || session?.clip);
  const pending=current?.status==='pending', approved=current?.status==='approved' && current.grantUntil>Date.now();
  $('state').textContent=stateName(current?.status);
  $('viewer-panel').hidden=!!approverId; $('approver-panel').hidden=!approverId;
  $('request').disabled=busy || !session?.clip; $('request').hidden=pending || approved;
  $('pending').hidden=!pending; $('login').hidden=!!session?.operator;
  $('decision').hidden=!session?.operator || !pending; $('revoke').hidden=!session?.operator || !approved;
  $('viewer-id').textContent=`Viewer ${current?.viewer || '—'}`;
  if(current) {
    const link=new URL(`/?approve=${current.id}&lang=${lang}`,location.origin).href;
    $('approval-link').href=link; $('approval-url').value=link;
    $('events').replaceChildren(...current.events.map(event=>{const li=document.createElement('li');li.textContent=`${eventName(event.name)} · ${new Date(event.at).toLocaleTimeString(lang)}`;return li;}));
  }
  if(!approved || approverId) lockVideo();
}
async function refresh() {
  if(!requestId || (approverId && !session?.operator))return;
  try {current=await api(`/api/requests/${requestId}`);render();} catch(error){lockVideo(); if(error.status===404){sessionStorage.removeItem(storageKey);requestId=null;current=null;render();}report(error);}
}
async function run(fn) {
  if(busy)return;busy=true;$('error').hidden=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await fn();}catch(error){report(error);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);render();}
}
$('language').onclick=()=>{lang=lang==='ja'?'en':'ja';localStorage.setItem('world-language',lang);render();};
$('approval-url').onfocus=event=>event.target.select();
$('request').onclick=()=>run(async()=>{current=await api('/api/requests',{assetId});requestId=current.id;sessionStorage.setItem(storageKey,requestId);frameIndex=0;render();});
$('login').onsubmit=event=>{event.preventDefault();run(async()=>{await api('/api/operator/login',{code:$('operator-code').value});$('operator-code').value='';session.operator=true;await refresh();});};
$('approve').onclick=()=>run(async()=>{if(session.mode==='rehearsal'){current=await api(`/api/requests/${requestId}/rehearse`,{});render();}else{const result=await api(`/api/requests/${requestId}/start`,{});location.assign(result.location);}});
for(const action of ['deny','revoke','cancel'])$(action).onclick=()=>run(async()=>{current=await api(`/api/requests/${requestId}/${action}`,{});render();});
await run(async()=>{
  session=await api(`/api/session${assetId?`?asset=${encodeURIComponent(assetId)}`:''}`);
  $('back').href=session.returnUrl || '/';
  if(params.get('result')==='incomplete')report(Error());
  await refresh();
});
setInterval(()=>{if(!busy)void refresh();},1500);
setInterval(async()=>{
  if(approverId || current?.status!=='approved')return;
  const seconds=Math.max(0,Math.ceil((current.grantUntil-Date.now())/1000));$('remaining').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  if(!seconds){current.status='expired';render();return;}
  if(frameBusy || !current.clip.frameCount || Date.now()<nextFrameAt)return;
  frameBusy=true; const epoch=mediaEpoch, id=current.id, index=frameIndex;
  try{
    const response=await fetch(`/media/${id}/frame/${index}`,{cache:'no-store'});
    if(!response.ok)throw Error();const blob=await response.blob();
    if(epoch!==mediaEpoch || current?.id!==id || current?.status!=='approved' || current.grantUntil<=Date.now())return;
    if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(blob);$('animation').src=objectUrl;$('animation').hidden=false;$('locked').hidden=true;
    const times=current.clip.capturedAt;const delay=index+1<times.length?Math.max(30,Math.min(2000,(times[index+1]-times[index])*1000)):500;
    nextFrameAt=Date.now()+delay;frameIndex=(index+1)%current.clip.frameCount;
  }catch(error){lockVideo();report(error);}finally{frameBusy=false;}
},50);
