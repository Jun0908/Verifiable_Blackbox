import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('health checks expose no credentials and authenticate internal readiness', async t => {
  const f = await fixture(t,{internalToken:'test-internal-token',allowedOwners:['0x'+'11'.repeat(20)]});
  const browser = f.browser();
  const publicHealth = await browser('/health');
  assert.equal(publicHealth.status,200);
  assert.deepEqual(await publicHealth.json(),{ok:true,service:'vbb-world-disclosure',mode:'rehearsal',sandbox:false});
  assert.equal((await browser('/internal/health')).status,403);
  const authorized = await browser('/internal/health',undefined,{Authorization:'Bearer test-internal-token'});
  assert.equal(authorized.status,200);
  const body = await authorized.json();assert.equal(body.ownersConfigured,true);
  assert.equal(JSON.stringify(body).includes('test-internal-token'),false);
  assert.equal((await browser('/internal/health',undefined,{Authorization:'Bearer test-internal-token',Origin:f.base})).status,403);
});
async function fixture(t, options = {}) {
  let clock = Date.now();
  // Bind first to select an available port; requests start only after base is set.
  let app;
  const http = await import('node:http');
  const server = http.createServer((req, res) => app.emit('request', req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  app = createApp({ root, base, mode: 'rehearsal', operatorCode: 'test-operator-code-long-enough',
    bytes: Buffer.from('0123456789'), clip: { jobId: 'DEMO', sha256: 'abc', sample: true }, now: () => clock, ...options });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  function browser() {
    let cookie;
    return async (route, body, headers = {}) => {
      const response = await fetch(base + route, { redirect: 'manual',
        method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    };
  }
  const viewer = browser(), operator = browser();
  const login = () => operator('/api/operator/login', { code: 'test-operator-code-long-enough' });
  const create = async () => (await viewer('/api/requests', {})).json();
  return { base, browser, viewer, operator, login, create, advance: ms => clock += ms };
}
test('private clip requires approval and is bound to requesting browser; range playback works', async t => {
  const f = await fixture(t); const r = await f.create();
  assert.equal((await f.viewer(`/media/${r.id}`)).status, 403);
  for (const route of ['/private/clip.mp4', '/.env', '/.local/operator-code.txt', '/src/app.mjs']) assert.equal((await f.viewer(route)).status, 404);
  assert.equal((await f.viewer(`/api/requests/${r.id}/rehearse`, {})).status, 403);
  await f.login();
  assert.equal((await f.operator(`/api/requests/${r.id}/rehearse`, {})).status, 200);
  assert.equal((await f.operator(`/media/${r.id}`)).status, 403);
  const partial = await f.viewer(`/media/${r.id}`, undefined, { Range: 'bytes=2-5' });
  assert.equal(partial.status, 206); assert.equal(await partial.text(), '2345');
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal((await f.viewer(`/media/${r.id}`, undefined, { Range: 'bytes=-0' })).status, 416);
  assert.equal((await f.viewer(`/media/${r.id}`, undefined, { Range: 'bytes=20-' })).status, 416);
  assert.equal((await f.operator(`/api/requests/${r.id}/rehearse`, {})).status, 409);
  await f.operator(`/api/requests/${r.id}/revoke`, {});
  assert.equal((await f.viewer(`/media/${r.id}`)).status, 403);
});
test('denial, viewer cancellation, expiration, and a new demo all keep old media locked', async t => {
  const f = await fixture(t); await f.login();
  for (const action of ['deny', 'cancel']) {
    const r = await f.create();
    await (action === 'deny' ? f.operator : f.viewer)(`/api/requests/${r.id}/${action}`, {});
    assert.equal((await f.operator(`/api/requests/${r.id}/rehearse`, {})).status, 409);
    assert.equal((await f.viewer(`/media/${r.id}`)).status, 403);
  }
  let r = await f.create(); f.advance(300001);
  assert.equal((await f.operator(`/api/requests/${r.id}/rehearse`, {})).status, 409);
  r = await f.create(); await f.operator(`/api/requests/${r.id}/rehearse`, {}); f.advance(300001);
  assert.equal((await f.viewer(`/media/${r.id}`)).status, 403);
  r = await f.create(); await f.operator(`/api/requests/${r.id}/rehearse`, {}); await f.create();
  assert.equal((await f.viewer(`/media/${r.id}`)).status, 403);
});
test('cross-origin mutations, forged Host and unknown callbacks are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.viewer('/api/requests', {}, { Origin: 'https://attacker.example' })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${f.base}/api/session`, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await f.viewer('/auth/world/callback?state=forged&code=bad')).status, 400);
  assert.equal((await f.viewer('/api/operator/login', { code: 'wrong' })).status, 403);
});
test('World callback is session-bound, single-use; rehearsal endpoint is disabled in world mode', async t => {
  let transaction; let finishes = 0;
  const provider = { start: async tx => { transaction = tx; return 'https://issuer.example/authorize'; }, finish: async () => { finishes++; return { issuer: 'https://issuer.example', subject: 'operator' }; } };
  const f = await fixture(t, { mode: 'world', provider, allowedSubjects: ['operator'] });
  await f.login(); const r = await f.create();
  assert.equal((await f.operator(`/api/requests/${r.id}/rehearse`, {})).status, 404);
  await f.operator(`/api/requests/${r.id}/start`, {});
  const callback = `/auth/world/callback?state=${transaction.state}&code=code`;
  assert.equal((await f.viewer(callback)).status, 400);
  assert.equal((await f.operator(callback)).status, 303);
  assert.equal((await f.operator(callback)).status, 400);
  assert.equal(finishes, 1);
  assert.equal((await f.viewer(`/media/${r.id}`)).status, 200);
});
test('World error never opens media; concurrent cancellation wins over callback', async t => {
  let transaction, fail = true, resolve;
  const provider = { start: async tx => { transaction = tx; return 'https://issuer.example/authorize'; }, finish: async () => {
    if (fail) throw new Error('cancelled');
    return new Promise(r => { resolve = r; });
  } };
  const f = await fixture(t, { mode: 'world', provider }); await f.login();
  const r = await f.create(); await f.operator(`/api/requests/${r.id}/start`, {});
  await f.operator(`/auth/world/callback?state=${transaction.state}&error=access_denied`);
  assert.equal((await f.viewer(`/media/${r.id}`)).status, 403);
  fail = false; await f.operator(`/api/requests/${r.id}/start`, {});
  const pending = f.operator(`/auth/world/callback?state=${transaction.state}&code=code`);
  while (!resolve) await new Promise(r => setImmediate(r));
  await f.viewer(`/api/requests/${r.id}/cancel`, {});
  resolve({ issuer: 'issuer', subject: 'operator' }); await pending;
  assert.equal((await f.viewer(`/media/${r.id}`)).status, 403);
});
