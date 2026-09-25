import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GET, POST} from '../apps/web/app/api/demo/rover/camera/route.ts';

const base = 'http://localhost:3000/api/demo/rover/camera';
function request({frame = false, body, headers = {}} = {}) {
  return new Request(base + (frame ? '?frame=1' : ''), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {host:'localhost:3000', origin:'http://localhost:3000', 'content-type':'application/json', ...headers},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('camera proxy isolates the token, rejects foreign origins and never forwards drive actions', async t => {
  const originalToken = process.env.VBB_BRIDGE_TOKEN;
  process.env.VBB_BRIDGE_TOKEN = 'test-camera-token';
  t.after(() => {if (originalToken === undefined) delete process.env.VBB_BRIDGE_TOKEN; else process.env.VBB_BRIDGE_TOKEN = originalToken;});
  const upstream = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer test-camera-token');
    assert.equal(url, 'http://127.0.0.1:8765/camera');
    return Response.json({enabled:true, configured:true, receiving:false, url:'http://camera:81/stream'});
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.text()).includes('test-camera-token'), false);
  for (const headers of [{host:'attacker.test:3000'}, {'sec-fetch-site':'cross-site'}, {'sec-fetch-site':'same-site'}]) {
    assert.equal((await GET(request({headers}))).status, 403);
  }
  assert.equal((await POST(request({body:{action:'power', enabled:false},headers:{origin:'https://attacker.test'}}))).status, 403);
  assert.equal((await POST(request({body:{action:'drive', direction:'forward'}}))).status, 400);
  assert.equal((await POST(request({body:{action:'power', enabled:'false'}}))).status, 400);
  assert.equal(upstream.mock.callCount(), 1);
});

test('frames preserve JPEG bytes and freshness; absent or failed frames are not replaced', async t => {
  const originalToken = process.env.VBB_BRIDGE_TOKEN;
  process.env.VBB_BRIDGE_TOKEN = 'test-camera-token';
  t.after(() => {if (originalToken === undefined) delete process.env.VBB_BRIDGE_TOKEN; else process.env.VBB_BRIDGE_TOKEN = originalToken;});
  const bytes = new Uint8Array([255,216,1,2,255,217]);
  let mode = 'jpeg';
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'http://127.0.0.1:8765/camera/frame');
    if (mode === 'empty') return new Response(null, {status:204});
    if (mode === 'failed') throw Error('private upstream detail');
    return new Response(bytes, {headers:{'content-type': mode === 'jpeg' ? 'image/jpeg' : 'text/html', 'x-camera-frame':'123'}});
  });
  const frame = await GET(request({frame:true}));
  assert.equal(frame.headers.get('x-camera-frame'), '123');
  assert.deepEqual(new Uint8Array(await frame.arrayBuffer()), bytes);
  mode = 'empty';
  assert.equal((await GET(request({frame:true}))).status, 204);
  for (mode of ['failed','html']) {
    const response = await GET(request({frame:true}));
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('private upstream'), false);
  }
});

test('camera settings only reach the camera endpoints', async t => {
  const originalToken = process.env.VBB_BRIDGE_TOKEN;
  process.env.VBB_BRIDGE_TOKEN = 'test-camera-token';
  t.after(() => {if (originalToken === undefined) delete process.env.VBB_BRIDGE_TOKEN; else process.env.VBB_BRIDGE_TOKEN = originalToken;});
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return Response.json({enabled:false});
  });
  assert.equal((await POST(request({body:{action:'power', enabled:false}}))).status, 200);
  assert.equal((await POST(request({body:{action:'configure', url:'http://camera:81/stream'}}))).status, 200);
  assert.deepEqual(calls, [
    ['http://127.0.0.1:8765/camera/power', {enabled:false}],
    ['http://127.0.0.1:8765/camera', {url:'http://camera:81/stream'}],
  ]);
});
