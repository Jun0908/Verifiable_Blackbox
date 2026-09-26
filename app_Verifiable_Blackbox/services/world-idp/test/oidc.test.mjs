import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import * as oidc from 'openid-client';
import { authorizationUrl, verifyCallback, worldProvider } from '../src/oidc.mjs';

// A test-only signed issuer exercises the actual library, not the World service.
test('OIDC adapter verifies signatures, claims, PKCE, state and nonce against a local signed issuer', async t => {
  const good = await generateKeyPair('RS256'), wrong = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(good.publicKey), kid: 'key-1', alg: 'RS256', use: 'sig' };
  let variant = '', tokenRequests = 0, base;
  const tx = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(), startedAt: Date.now() - 90_000, expires: Date.now() + 200_000 };
  const callback = 'http://localhost:8787/auth/world/callback';
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    if (req.url !== '/token') { res.writeHead(404); return res.end('{}'); }
    tokenRequests++;
    let raw = ''; for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    if (form.get('code_verifier') !== tx.verifier || form.get('redirect_uri') !== callback || form.get('code') !== 'test-code') {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
    const seconds = Math.floor(Date.now() / 1000);
    const claims = { iss: base, aud: 'test-client', sub: 'operator-1', iat: seconds, exp: seconds + 300, nonce: tx.nonce, auth_time: seconds - 70, acr: 'https://world.org/oidc/acr/orb-v3', amr: ['pop'] };
    if (variant === 'nonce') claims.nonce = 'wrong';
    if (variant === 'issuer') claims.iss = 'https://other.example';
    if (variant === 'audience') claims.aud = 'other-client';
    if (variant === 'expired') claims.exp = seconds - 300;
    if (variant === 'stale-login') claims.auth_time = seconds - 600;
    if (variant === 'missing-auth-time') delete claims.auth_time;
    if (variant === 'future-auth-time') claims.auth_time = seconds + 120;
    if (variant === 'wrong-acr') claims.acr = 'other';
    if (variant === 'missing-amr') delete claims.amr;
    const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'key-1' }).sign(variant === 'signature' ? wrong.privateKey : good.privateKey);
    res.end(JSON.stringify({ access_token: 'not-a-real-token', token_type: 'Bearer', id_token: token }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const config = new oidc.Configuration({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks`, id_token_signing_alg_values_supported: ['RS256'] }, 'test-client', undefined, oidc.None());
  oidc.allowInsecureRequests(config); // Test-only: production adapter always requires HTTPS.
  oidc.enableNonRepudiationChecks(config);
  const authorize = new URL(await authorizationUrl(config, tx, callback));
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('code_challenge'), await oidc.calculatePKCECodeChallenge(tx.verifier));
  assert.equal(authorize.searchParams.get('nonce'), tx.nonce);
  const responseUrl = () => new URL(`${callback}?code=test-code&state=${tx.state}`);
  assert.deepEqual(await verifyCallback(config, tx, responseUrl()), { issuer: base, subject: 'operator-1' });
  for (const failure of ['signature', 'nonce', 'issuer', 'audience', 'expired', 'stale-login', 'missing-auth-time', 'future-auth-time', 'wrong-acr', 'missing-amr']) {
    await t.test(`rejects ${failure}`, async () => { variant = failure; await assert.rejects(verifyCallback(config, tx, responseUrl())); });
  }
  variant = '';
  await assert.rejects(verifyCallback(config, { ...tx, expires: Date.now() - 1 }, responseUrl()));
  const before = tokenRequests;
  await assert.rejects(verifyCallback(config, tx, new URL(`${callback}?code=test-code&state=forged`)));
  assert.equal(tokenRequests, before, 'Wrong state is rejected before code exchange');
  await assert.rejects(verifyCallback(config, tx, new URL(`${callback}?error=access_denied&state=${tx.state}`)));
  await assert.rejects(verifyCallback(config, { ...tx, verifier: 'wrong-pkce' }, responseUrl()));
});
test('production provider refuses insecure issuer and missing official credentials', async () => {
  await assert.rejects(worldProvider({ issuer: 'http://localhost:1234', clientId: 'test', auth: 'none' }).ready());
  await assert.rejects(worldProvider({ issuer: 'https://auth.worldcoin.dev', clientId: '', auth: 'none' }).ready());
});
