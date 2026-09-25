import test from 'node:test';
import assert from 'node:assert/strict';
import {p256} from '@noble/curves/p256';
import {context, digestJob, encodeJob, verifyDeviceSignature, verifyERC7913, MAGIC} from '../signature.mjs';
import {makeFixture, testJob} from './fixture.mjs';
import {renderReport} from '../report.mjs';

const fixture = makeFixture();
const verify = (value, key = fixture.publicKey, job = testJob) => verifyDeviceSignature(value, key, job);
test('a fixed four-word ABI message is signed once, without rehashing the digest', () => {
  assert.equal(encodeJob(testJob).length, 2 + 128 * 2);
  assert.equal(verify(fixture).digest, digestJob(testJob));
});
test('another job, chain or core cannot reuse this signature', () => {
  for (const replacement of [{jobId:'8'}, {chainId:'1'}, {core:'0x2222222222222222222222222222222222222222'}]) {
    const other = {...testJob, ...replacement};
    assert.throws(() => verify(fixture, fixture.publicKey, other), /JOB_CONTEXT_MISMATCH/);
    assert.throws(() => verify({...fixture, ...other, digest:digestJob(other)}, fixture.publicKey, other), /INVALID_DEVICE_SIGNATURE/);
  }
});
test('caller must pin a trusted key, independently of the response', () => {
  assert.throws(() => verify(makeFixture(testJob, '02'.padStart(64, '0'))), /UNREGISTERED_DEVICE_KEY/);
});
test('corrupted digest, signature and high-S encoding fail', () => {
  assert.throws(() => verify({...fixture, digest:'0x' + '00'.repeat(32)}), /DIGEST_MISMATCH/);
  assert.throws(() => verify({...fixture, signature:'0x' + '00'.repeat(64)}), /INVALID_DEVICE_SIGNATURE/);
  const sig = p256.Signature.fromCompact(fixture.signature.slice(2));
  const high = new p256.Signature(sig.r, p256.CURVE.n - sig.s).toCompactHex();
  assert.throws(() => verify({...fixture, signature:`0x${high}`}), /INVALID_DEVICE_SIGNATURE/);
});
test('zero, unsafe number, overflow and malformed identifiers fail before signing', () => {
  for (const jobId of ['0', 7, '-1', '7junk', (1n << 256n).toString()]) {
    assert.throws(() => context({...testJob, jobId}));
  }
  assert.throws(() => context({...testJob, core:'0x' + '00'.repeat(20)}));
  assert.throws(() => verify({...fixture, version:2}), /UNSUPPORTED_SCHEMA/);
});
test('firmware hex words normalize to the expected decimal Job context', () => {
  assert.equal(verify({...fixture, chainId:'0x00007a69', jobId:'0x0007'}).jobId, '7');
});
test('RPC result must come from the expected chain, code and magic value', async () => {
  const fake = {getChainId:async () => 31337, getCode:async () => '0x6000', readContract:async () => MAGIC};
  const address = '0x2222222222222222222222222222222222222222';
  assert.equal((await verifyERC7913(fake, address, fixture)).persistedOnChain, false);
  await assert.rejects(verifyERC7913({...fake, getChainId:async () => 1}, address, fixture), /RPC_CHAIN_MISMATCH/);
  await assert.rejects(verifyERC7913({...fake, getCode:async () => undefined}, address, fixture), /VERIFIER_NOT_DEPLOYED/);
  await assert.rejects(verifyERC7913({...fake, readContract:async () => '0xffffffff'}, address, fixture), /ERC7913_REJECTED/);
});
test('report never presents local-only verification as onchain verification or payment', () => {
  const html = renderReport(verify(fixture));
  assert.match(html, /未実施（ローカル署名確認のみ）/);
  assert.match(html, /支払い：このツールでは実行・照会していません/);
  assert.ok(!renderReport({...fixture, jobId:'<script>'}).includes('<script>'));
});
