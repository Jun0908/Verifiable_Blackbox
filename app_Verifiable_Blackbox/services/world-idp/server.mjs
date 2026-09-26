import {fileURLToPath} from 'node:url';
import {createApp} from './src/app.mjs';
import {worldProvider} from './src/oidc.mjs';
const root = fileURLToPath(new URL('./', import.meta.url));
const mode = process.env.MODE || 'world';
const base = new URL(process.env.BASE_URL || 'http://localhost:8787');
if (!['world','rehearsal'].includes(mode) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw Error('Invalid MODE or BASE_URL');
const local = ['localhost','127.0.0.1'].includes(base.hostname);
if ((!local && base.protocol !== 'https:') || (mode === 'rehearsal' && !local)) throw Error('HTTPS required; rehearsal is local only');
for (const key of ['OPERATOR_CODE','WORLD_INTERNAL_TOKEN']) if ((process.env[key] || '').length < 32) throw Error(`${key}: generate at least 32 random characters`);
const allowedOwners = (process.env.WORLD_APPROVER_OWNERS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
if (!allowedOwners.length || allowedOwners.some(s=>!/^0x[0-9a-f]{40}$/.test(s))) throw Error('Configure WORLD_APPROVER_OWNERS with authorized wallet addresses');
const provider = mode === 'world' ? worldProvider({issuer: process.env.WORLD_ISSUER || '', clientId: process.env.WORLD_CLIENT_ID,
  secret: process.env.WORLD_CLIENT_SECRET, auth: process.env.WORLD_CLIENT_AUTH || 'client_secret_basic', scope: 'openid'}) : null;
if (provider) await provider.ready();
const returnUrl = new URL(process.env.APP_RETURN_URL || 'http://localhost:3000');
if (!['https:','http:'].includes(returnUrl.protocol) || returnUrl.username || returnUrl.password) throw Error('Invalid APP_RETURN_URL');
const server = createApp({root, base: base.origin, mode, operatorCode: process.env.OPERATOR_CODE,
  internalToken: process.env.WORLD_INTERNAL_TOKEN, allowedOwners, returnUrl: returnUrl.href, provider,
  sandbox: mode === 'world' && process.env.WORLD_ISSUER === 'https://sandbox.auth.world.org',
  allowedSubjects: (process.env.WORLD_APPROVER_SUBS || '').split(',').map(s=>s.trim()).filter(Boolean)});
server.on('error', () => {console.error('World service could not listen on the configured port'); process.exitCode = 1;});
server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log(`World disclosure ready: ${base.origin} (${mode})`));
