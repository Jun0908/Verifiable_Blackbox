import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {importAsset} from '../src/assets.mjs';
import {createApp} from '../src/app.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const frame=Buffer.from([255,216,1,2,3,255,217]);
const owner='0x'+'12'.repeat(20), internalToken='test-internal-token-32-characters-only';
const input=()=>({chainId:11155111,core:'0x'+'34'.repeat(20),jobId:'1',sessionId:'00000000-0000-4000-8000-000000000001',
  owner,rawSha256:sha(frame),rawBase64:frame.toString('base64'),frames:[{sha256:sha(frame),capturedAt:100}],receiptId:null,transactionHash:null});
test('recording import binds raw bytes, frame hashes and Job; rejects substitution',()=>{
  const asset=importAsset(input());assert.equal(asset.clip.rawSha256,sha(frame));assert.deepEqual(asset.frames[0],frame);
  for(const change of [{rawSha256:'0'.repeat(64)},{frames:[]},{frames:[{sha256:'1'.repeat(64),capturedAt:100}]},{owner:'attacker'},
    {path:'C:/private'}, {rawBase64:Buffer.concat([frame,frame]).toString('base64'),rawSha256:sha(Buffer.concat([frame,frame]))}])assert.throws(()=>importAsset({...input(),...change}));
});
test('registered assets require internal authentication, scoped approver and viewer-bound grants',async t=>{
  let app, clock=Date.now();
  const server=http.createServer((req,res)=>app.emit('request',req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const options={root:fileURLToPath(new URL('../',import.meta.url)),base,mode:'rehearsal',operatorCode:'operator-code-for-tests-only',internalToken,allowedOwners:[owner],now:()=>clock};
  app=createApp(options);
  const register=async(payload,auth=internalToken)=>fetch(base+'/internal/assets',{method:'POST',headers:{Authorization:`Bearer ${auth}`},body:JSON.stringify(payload)});
  assert.equal((await register(input(),'forged')).status,403);
  assert.equal((await register({...input(),owner:'0x'+'56'.repeat(20)})).status,403);
  const first=await (await register(input())).json();assert.equal((await(await register(input())).json()).assetId,first.assetId);
  const second=await(await register({...input(),jobId:'2'})).json();assert.notEqual(first.assetId,second.assetId);
  function browser(){let cookie;return async(route,body,headers={})=>{
    const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;
  };}
  const viewer=browser(), other=browser(), approver=browser();
  assert.equal((await viewer('/api/requests',{assetId:'forged'})).status,404);
  const request=await(await viewer('/api/requests',{assetId:first.assetId})).json();assert.equal(request.clip.jobId,'1');
  assert.equal((await viewer(`/media/${request.id}/frame/0`)).status,403);
  await approver('/api/operator/login',{code:'operator-code-for-tests-only'});
  await approver(`/api/requests/${request.id}/rehearse`,{});
  assert.equal((await other(`/media/${request.id}/frame/0`)).status,403);
  assert.equal((await approver(`/media/${request.id}`)).status,403);
  const read=await viewer(`/media/${request.id}/frame/0`);assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()),frame);
  assert.equal((await viewer(`/media/${request.id}`,undefined,{Range:'bytes=0-2'})).status,206);
  for(const route of ['/private/clip.media','/.env','/internal/assets','/frame/0'])assert.equal((await viewer(route)).status,404);
  clock+=300001;assert.equal((await viewer(`/media/${request.id}`,undefined,{Range:'bytes=0-2'})).status,403);
  const next=await(await viewer('/api/requests',{assetId:second.assetId})).json();await approver(`/api/requests/${next.id}/rehearse`,{});
  await approver(`/api/requests/${next.id}/revoke`,{});assert.equal((await viewer(`/media/${next.id}/frame/0`)).status,403);
  app=createApp(options);assert.equal((await viewer(`/media/${request.id}`)).status,404);
});
test('loopback registration supports a distinct public HTTPS origin without weakening browser origin checks',async t=>{
  const app=createApp({root:fileURLToPath(new URL('../',import.meta.url)),base:'https://world.example',mode:'world',
    operatorCode:'operator-code-for-tests-only',internalToken,allowedOwners:[owner]});
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>{app.close(resolve);app.closeAllConnections();}));
  const base=`http://127.0.0.1:${app.address().port}`;
  const headers={Authorization:`Bearer ${internalToken}`};
  const response=await fetch(base+'/internal/assets',{method:'POST',headers,body:JSON.stringify(input())});
  assert.equal(response.status,201);assert.match((await response.json()).invitationUrl,/^https:\/\/world\.example\/\?asset=/);
  assert.equal((await fetch(base+'/api/session')).status,403);
  assert.equal((await fetch(base+'/internal/assets',{method:'POST',headers:{...headers,Origin:'https://world.example'},body:JSON.stringify(input())})).status,403);
});
