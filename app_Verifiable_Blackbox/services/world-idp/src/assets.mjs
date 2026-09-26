import {createHash, randomBytes} from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const hex32 = value => value == null || /^0x[0-9a-f]{64}$/i.test(value);
export function importAsset(input) {
  if (!input || Object.keys(input).some(key => !['chainId','core','jobId','sessionId','owner','rawSha256','rawBase64','frames','receiptId','transactionHash'].includes(key))
    || !Number.isSafeInteger(input.chainId) || input.chainId <= 0 || !address(input.core) || !address(input.owner)
    || typeof input.jobId !== 'string' || !/^[1-9][0-9]{0,77}$/.test(input.jobId)
    || typeof input.sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.sessionId)
    || !digest(input.rawSha256) || !Array.isArray(input.frames) || !input.frames.length || input.frames.length > 200
    || !hex32(input.receiptId) || !hex32(input.transactionHash)
    || typeof input.rawBase64 !== 'string' || input.rawBase64.length > 90_000_000) throw Error('INVALID_ASSET');
  const bytes = Buffer.from(input.rawBase64, 'base64');
  if (!bytes.length || bytes.length > 64 * 1024 * 1024 || sha(bytes) !== input.rawSha256) throw Error('ASSET_HASH_MISMATCH');
  const frames = []; let start = 0, previous = -Infinity;
  for (const frame of input.frames) {
    if (!digest(frame.sha256) || !Number.isFinite(frame.capturedAt) || frame.capturedAt < previous) throw Error('INVALID_FRAMES');
    previous = frame.capturedAt;
    if (bytes[start] !== 255 || bytes[start + 1] !== 216) throw Error('INVALID_JPEG');
    let end = start + 2, found = false;
    while ((end = bytes.indexOf(Buffer.from([255,217]), end)) !== -1 && end - start <= 2_000_000) {
      end += 2;
      if (sha(bytes.subarray(start, end)) === frame.sha256) { found = true; break; }
    }
    if (!found) throw Error('FRAME_HASH_MISMATCH');
    frames.push(bytes.subarray(start, end)); start = end;
  }
  if (start !== bytes.length) throw Error('UNBOUND_RECORDING_BYTES');
  const assetId = randomBytes(24).toString('base64url');
  return {bytes, frames, clip: {assetId, chainId: input.chainId, core: input.core.toLowerCase(), jobId: input.jobId,
    sessionId: input.sessionId, owner: input.owner.toLowerCase(), title: `Rover recording / Job ${input.jobId}`,
    mime: 'video/x-motion-jpeg', sha256: input.rawSha256, rawSha256: input.rawSha256,
    frameCount: frames.length, capturedAt: input.frames.map(frame => frame.capturedAt),
    receiptId: input.receiptId ?? null, transactionHash: input.transactionHash ?? null,
    commitmentScope: 'receipt-reference-only', sample: false}};
}
