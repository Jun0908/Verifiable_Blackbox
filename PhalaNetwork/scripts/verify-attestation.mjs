import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { boundedJson, expectationsSchema, verifyAttestation } from '../dist/attestation-verifier.js';
const [endpoint,expectedFile,...flags] = process.argv.slice(2);
try {
  if(!endpoint || !expectedFile || flags.some(f => f !== '--allow-simulator')) throw Error('Usage: verify:attestation -- <https-endpoint> <expected.json> [--allow-simulator]');
  const url = new URL(endpoint); const allowSimulator = flags.includes('--allow-simulator');
  if(url.username || url.password || url.search || url.hash) throw Error('ENDPOINT_INVALID');
  if(url.protocol !== 'https:' && !(allowSimulator && url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw Error('HTTPS_REQUIRED');
  const parsed = expectationsSchema.safeParse(JSON.parse(await readFile(expectedFile,'utf8')));
  if(!parsed.success) throw Error('EXPECTATIONS_INVALID');
  const nonce = randomBytes(32).toString('hex');
  url.pathname = `${url.pathname.replace(/\/$/,'')}/attestation`; url.searchParams.set('nonce',nonce);
  const report = await boundedJson(await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'}));
  console.log(JSON.stringify(await verifyAttestation(report,parsed.data,nonce,{allowSimulator})));
} catch(error) {
  // No endpoint, RPC credential or raw server response in CLI errors.
  const reason = /^[A-Z_]+$/.test(error.message) || error.message.startsWith('Usage:') ? error.message : 'ATTESTATION_VERIFICATION_FAILED';
  console.error(JSON.stringify({ok:false,reason})); process.exitCode=1;
}
