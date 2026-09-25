import {context, publicKey} from './signature.mjs';

export async function requestDevice({url, token, job, keyOnly = false, fetchImpl = fetch, timeoutMs = 20000}) {
  const base = new URL(url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('INVALID_DEVICE_URL');
  }
  if (!token) throw new Error('ROVER_API_TOKEN_REQUIRED');
  const signal = AbortSignal.timeout(timeoutMs);
  async function call(path, method = 'GET', body) {
    const response = await fetchImpl(new URL(path, base), {method, body, signal, redirect: 'error',
      headers: {'X-Rover-Token': token, ...(body ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})}});
    if (!response.ok) throw new Error(`DEVICE_HTTP_${response.status}`);
    const data = await response.json();
    if (!['busy', 'ready'].includes(data.state)) throw new Error('DEVICE_NOT_READY');
    return data;
  }
  const j = keyOnly ? null : context(job);
  const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  const body = keyOnly ? undefined : new URLSearchParams({chain_id: word(j.chainId), core: j.core, job_id: word(j.jobId)});
  let result = await call(keyOnly ? '/device-signature/key' : '/device-signature', 'POST', body);
  while (result.state === 'busy') {
    // Bounded polling of an async, stopped-device operation; no motor commands.
    await new Promise(resolve => setTimeout(resolve, 200));
    result = await call('/device-signature');
  }
  publicKey(result.publicKey);
  return result;
}
