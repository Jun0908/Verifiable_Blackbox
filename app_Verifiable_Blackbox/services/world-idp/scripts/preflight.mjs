const required = ['WORLD_CLIENT_ID', 'WORLD_CLIENT_SECRET', 'WORLD_INTERNAL_TOKEN', 'OPERATOR_CODE', 'WORLD_APPROVER_OWNERS'];
for (const key of required) console.log(`${key}: ${process.env[key] ? 'configured' : 'missing'}`);
if (required.some(key => !process.env[key])) process.exitCode = 1;
const base = new URL(process.env.BASE_URL || 'http://localhost:8787');
console.log(`Callback to register in World Portal: ${base.origin}/auth/world/callback`);
try {
  const issuer = process.env.WORLD_ISSUER || 'https://sandbox.auth.world.org';
  if (!issuer.startsWith('https://')) throw Error('HTTPS issuer required');
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {signal: AbortSignal.timeout(10000)});
  const config = await response.json();
  if (!response.ok || config.issuer !== issuer || !config.code_challenge_methods_supported?.includes('S256')
    || !config.token_endpoint_auth_methods_supported?.includes(process.env.WORLD_CLIENT_AUTH || 'client_secret_basic')) throw Error('Discovery mismatch');
  console.log('Official discovery: OK (issuer, PKCE S256, client authentication)');
  console.log('Browser authentication and disclosure: requires human verification');
} catch { console.error('Official discovery: unavailable or incompatible'); process.exitCode = 1; }
