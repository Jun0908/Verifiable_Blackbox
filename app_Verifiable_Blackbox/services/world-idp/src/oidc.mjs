import * as oidc from 'openid-client';

const WORLD_ACR = 'https://world.org/oidc/acr/orb-v3';

// World pilot details are configured from the portal, never guessed from IDKit APIs.
export function worldProvider(settings) {
  let pending;
  const configuration = () => pending ??= discover().catch(error => { pending = undefined; throw error; });
  async function discover() {
    const issuer = new URL(settings.issuer);
    if (issuer.protocol !== 'https:') throw new Error('World issuer must use HTTPS');
    const methods = {
      client_secret_basic: () => oidc.ClientSecretBasic(settings.secret),
      client_secret_post: () => oidc.ClientSecretPost(settings.secret),
      none: () => oidc.None(),
    };
    if (!methods[settings.auth]) throw new Error('Unsupported client authentication');
    if (!settings.clientId || (settings.auth !== 'none' && !settings.secret)) throw new Error('World credentials missing');
    return oidc.discovery(issuer, settings.clientId, undefined, methods[settings.auth](), {
      timeout: 10, execute: [oidc.enableNonRepudiationChecks],
    });
  }
  return {
    ready: async () => { await configuration(); },
    async start(transaction, callback) {
      return authorizationUrl(await configuration(), transaction, callback, settings.scope);
    },
    async finish(transaction, url) {
      return verifyCallback(await configuration(), transaction, url);
    },
  };
}

export async function authorizationUrl(config, tx, callback, scope = 'openid') {
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: callback, scope, response_type: 'code', response_mode: 'query',
    state: tx.state, nonce: tx.nonce, code_challenge_method: 'S256',
    code_challenge: await oidc.calculatePKCECodeChallenge(tx.verifier),
    // A fresh interaction is required for each disclosure; no cached login approval.
    prompt: 'login', max_age: '0', acr_values: WORLD_ACR,
  }).href;
}

export async function verifyCallback(config, tx, url) {
  const tokens = await oidc.authorizationCodeGrant(config, url, {
    pkceCodeVerifier: tx.verifier, expectedState: tx.state,
    expectedNonce: tx.nonce, idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error('Missing subject');
  // A fresh proof belongs to this attempt; it need not be literally zero seconds
  // old after the browser round trip. Allow only bounded clock skew (30 seconds).
  const now = Date.now();
  if (!Number.isFinite(tx.startedAt) || !Number.isFinite(tx.expires)
    || tx.startedAt > now || now >= tx.expires || tx.expires - tx.startedAt > 300_000
    || !Number.isInteger(claims.auth_time) || claims.auth_time * 1000 < tx.startedAt - 30_000
    || claims.auth_time * 1000 > now + 30_000) throw new Error('Fresh authentication required');
  if (claims.acr !== WORLD_ACR || !Array.isArray(claims.amr) || !claims.amr.includes('pop')) {
    throw new Error('World authentication class not satisfied');
  }
  return { issuer: claims.iss, subject: claims.sub };
}
