import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {importAsset} from './assets.mjs';

const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const minutes = 60_000;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function createApp({ root, base, mode, operatorCode, clip, bytes, provider,
  internalToken, allowedOwners = [], returnUrl = "/", allowedSubjects = [], sandbox = false, now = Date.now, requestTtl = 5 * minutes, grantTtl = 5 * minutes }) {
  const sessions = new Map(), requests = new Map(), transactions = new Map();
  const argumentsClip = clip, argumentsBytes = bytes;
  const assets = new Map();
  const ownerAllowed = owner => allowedOwners.includes(owner?.toLowerCase());
  const secure = base.startsWith('https:');
  const publicFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ]);
  let loginFailures = 0, loginWindow = 0;
  const status = r => {
    if (r.status === 'pending' && r.deadline <= now()) r.status = 'expired';
    if (r.status === 'approved' && r.grantUntil <= now()) r.status = 'expired';
    return r.status;
  };
  const event = (r, name) => r.events.push({ name, at: now() });
  const requirePending = r => { if (status(r) !== 'pending') throw new HttpError(409, 'この依頼は終了しています。新しい開示依頼を作成してください。'); };
  const disclose = (r, identity) => {
    requirePending(r);
    r.status = 'approved'; r.grantUntil = now() + grantTtl;
    r.approver = { issuer: identity.issuer, subjectHash: hash(identity.subject), mode };
    event(r, mode === 'world' ? 'world_verified' : 'rehearsal_approved');
    event(r, 'access_granted');
  };
  const view = r => ({ id: r.id, status: status(r), deadline: r.deadline,
    grantUntil: r.grantUntil, viewer: hash(r.viewer).slice(0, 8), clip: r.asset?.clip ?? clip, scope: 'view:one-clip',
    seconds: grantTtl / 1000, mode, events: r.events,
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const redirect = url => { res.writeHead(303, { Location: url }); res.end(); };
    try {
      const url = new URL(req.url, base);
      if (url.pathname === '/internal/assets' && req.method === 'POST') {
        if (!internalToken || req.headers.origin || !equal(req.headers.authorization || '', `Bearer ${internalToken}`)) throw new HttpError(403, 'INTERNAL_AUTH_REQUIRED');
        let size = 0; const chunks = [];
        for await (const chunk of req) {size += chunk.length; if (size > 91_000_000) throw new HttpError(413, 'ASSET_TOO_LARGE'); chunks.push(chunk);}
        let asset;
        try { asset = importAsset(JSON.parse(Buffer.concat(chunks).toString())); } catch {throw new HttpError(400, 'INVALID_RECORDING');}
        if (!ownerAllowed(asset.clip.owner)) throw new HttpError(403, 'APPROVER_OWNER_NOT_CONFIGURED');
        const same = [...assets.values()].find(item => ['chainId','core','jobId','sessionId','owner','sha256','receiptId','transactionHash'].every(key => item.clip[key] === asset.clip[key]));
        if (same) asset = same;
        else {
          if (assets.size >= 20 || [...assets.values()].reduce((n,a)=>n+a.bytes.length,0) + asset.bytes.length > 128 * 1024 * 1024) throw new HttpError(503, 'ASSET_CAPACITY_REACHED');
          assets.set(asset.clip.assetId, asset);
        }
        return send(201, {assetId: asset.clip.assetId, sha256: asset.clip.sha256, invitationUrl: `${base}/?asset=${asset.clip.assetId}`});
      }
      if (req.headers.host !== new URL(base).host) throw new HttpError(403, 'Open the configured BASE_URL.');
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
      const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')));
      // Bound memory and discard expired browser sessions / authorization transactions.
      for (const [key, s] of sessions) if (s.expires <= now()) sessions.delete(key);
      for (const [key, tx] of transactions) if (tx.expires <= now()) transactions.delete(key);
      for (const [key, r] of requests) if (Math.max(r.deadline, r.grantUntil || 0) + 30 * minutes <= now()) requests.delete(key);
      let sid = cookies.vbb_session, session = sessions.get(sid);
      if (!session) {
        if (sessions.size >= 1000) throw new HttpError(503, 'Demo session limit reached. Restart the demo.');
        sid = random(); session = { expires: now() + 8 * 60 * minutes, operator: false };
        sessions.set(sid, session);
        res.setHeader('Set-Cookie', `vbb_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? '; Secure' : ''}`);
      }
      let body = {};
      if (req.method === 'POST') {
        if (req.headers.origin !== base || req.headers['content-type'] !== 'application/json') throw new HttpError(403, 'Invalid request origin');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new HttpError(413, 'Request too large'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request');
      }
      const needOperator = () => { if (!session.operator) throw new HttpError(403, '承認者コードでログインしてください。'); };
      const requestFor = id => { const r = requests.get(id); if (!r) throw new HttpError(404, '依頼がありません。新しい依頼を作成してください。'); return r; };

      if (req.method === 'GET' && url.pathname === '/api/session') {
        const asset = assets.get(url.searchParams.get('asset'));
        if (url.searchParams.has('asset') && !asset) throw new HttpError(404, 'ASSET_NOT_FOUND');
        return send(200, { mode, sandbox, operator: session.operator, clip: asset?.clip ?? clip ?? null, returnUrl, callback: `${base}/auth/world/callback` });
      }
      if (req.method === 'POST' && url.pathname === '/api/operator/login') {
        if (loginWindow + minutes < now()) { loginFailures = 0; loginWindow = now(); }
        if (loginFailures >= 10) throw new HttpError(429, '承認者コードを確認し、1分後に再試行してください。');
        if (typeof body.code !== 'string' || !equal(body.code, operatorCode)) { loginFailures++; throw new HttpError(403, '承認者コードが違います。'); }
        session.operator = true; return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/requests') {
        const asset = assets.get(body.assetId);
        if (!asset && !clip) throw new HttpError(404, 'ASSET_NOT_FOUND');
        if (asset && !ownerAllowed(asset.clip.owner)) throw new HttpError(403, 'APPROVER_OWNER_NOT_CONFIGURED');
        if (requests.size >= 1000) throw new HttpError(503, 'Demo request limit reached. Restart the demo.');
        // Repeating a demo revokes this viewer's old grant instead of leaving invisible access.
        for (const r of requests.values()) if (r.viewer === sid && ['pending', 'approved'].includes(status(r))) { r.status = 'revoked'; event(r, 'revoked'); }
        const r = { asset, id: random(), viewer: sid, status: 'pending', deadline: now() + requestTtl, events: [] };
        event(r, 'requested'); requests.set(r.id, r); return send(201, view(r));
      }
      const apiMatch = /^\/api\/requests\/([\w-]+)(?:\/(start|rehearse|deny|revoke|cancel))?$/.exec(url.pathname);
      if (apiMatch) {
        const r = requestFor(apiMatch[1]);
        if (r.asset && !ownerAllowed(r.asset.clip.owner)) throw new HttpError(403, 'JOB_PERMISSION_REQUIRED');
        const action = apiMatch[2];
        if (req.method === 'GET' && !action) {
          if (r.viewer !== sid) needOperator();
          return send(200, view(r));
        }
        if (req.method !== 'POST' || !action) throw new HttpError(405, 'Method not allowed');
        if (action === 'cancel') {
          if (r.viewer !== sid) throw new HttpError(403, 'Wrong viewer');
          requirePending(r); r.status = 'cancelled'; event(r, 'cancelled'); return send(200, view(r));
        }
        needOperator();
        if (action === 'revoke') {
          if (status(r) !== 'approved') throw new HttpError(409, 'No active grant');
          r.status = 'revoked'; event(r, 'revoked'); return send(200, view(r));
        }
        requirePending(r);
        if (action === 'deny') { r.status = 'denied'; event(r, 'denied'); return send(200, view(r)); }
        if (action === 'rehearse') {
          if (mode !== 'rehearsal') throw new HttpError(404, 'Not found');
          disclose(r, { issuer: 'local-rehearsal', subject: 'demo-operator' }); return send(200, view(r));
        }
        if (action === 'start') {
          if (mode !== 'world') throw new HttpError(409, '公式接続は未設定です。リハーサルを使用してください。');
          // At most one outstanding authorization per request. Retry gets fresh PKCE/state/nonce.
          for (const [state, tx] of transactions) if (tx.requestId === r.id) transactions.delete(state);
          const tx = { state: random(), nonce: random(), verifier: random(), sid, requestId: r.id, startedAt: now(), expires: Math.min(r.deadline, now() + 5 * minutes) };
          const location = await provider.start(tx, `${base}/auth/world/callback`);
          requirePending(r); transactions.set(tx.state, tx); event(r, 'world_started');
          return send(200, { location });
        }
      }
      if (url.pathname === '/auth/world/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state'); const tx = transactions.get(state);
        if (mode !== 'world' || !tx || tx.sid !== sid || !session.operator || tx.expires <= now()) throw new HttpError(400, '承認の有効期限切れ、または無効な戻り先です。依頼画面から再試行してください。');
        transactions.delete(state); // One attempt; replay can never grant access.
        const r = requestFor(tx.requestId); requirePending(r);
        if (r.asset && !ownerAllowed(r.asset.clip.owner)) throw new HttpError(403, 'JOB_PERMISSION_REQUIRED');
        try {
          const identity = await provider.finish(tx, url);
          if (allowedSubjects.length && !allowedSubjects.includes(identity.subject)) throw new Error('Subject not allowed');
          disclose(r, identity);
          return redirect(`/?approve=${r.id}&result=approved`);
        } catch {
          // Cancel/error leaves media locked. Network errors can be retried with a fresh transaction.
          event(r, 'world_incomplete');
          return redirect(`/?approve=${r.id}&result=incomplete`);
        }
      }
      const mediaMatch = /^\/media\/([\w-]+)(?:\/frame\/(\d+))?$/.exec(url.pathname);
      if (mediaMatch && ['GET', 'HEAD'].includes(req.method)) {
        const r = requestFor(mediaMatch[1]);
        if (r.viewer !== sid || status(r) !== 'approved') throw new HttpError(403, '映像は開示されていません。');
        const clip = r.asset?.clip ?? argumentsClip;
        let bytes = r.asset?.bytes ?? argumentsBytes;
        if (mediaMatch[2] !== undefined) {
          bytes = r.asset?.frames[Number(mediaMatch[2])];
          if (!bytes) throw new HttpError(404, 'FRAME_NOT_FOUND');
        }
        let start = 0, end = bytes.length - 1, code = 200;
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!range || (!range[1] && !range[2])) { res.setHeader('Content-Range', `bytes */${bytes.length}`); throw new HttpError(416, 'Invalid range'); }
          if (!range[1]) start = Math.max(0, bytes.length - Number(range[2]));
          else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) { res.setHeader('Content-Range', `bytes */${bytes.length}`); throw new HttpError(416, 'Invalid range'); }
          code = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
        }
        if (req.method === 'GET' && !r.viewed) { r.viewed = true; event(r, 'viewed'); }
        res.writeHead(code, { 'Content-Type': mediaMatch[2] !== undefined ? 'image/jpeg' : clip.mime || 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
        res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1)); return;
      }
      if (publicFiles.has(url.pathname) && ['GET', 'HEAD'].includes(req.method)) {
        const [name, type] = publicFiles.get(url.pathname);
        const content = await readFile(path.join(root, 'public', name));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      if (!res.headersSent) send(error.status || 503, { error: error.status ? error.message : '接続できませんでした。映像は非公開のままです。再試行してください。' });
      else res.destroy();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
