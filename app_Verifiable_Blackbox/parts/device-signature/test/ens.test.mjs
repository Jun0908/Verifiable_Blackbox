import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRobotName, resolveEnsPublicKey, ENS_RECORD} from '../ens.mjs';
import {verifyDeviceSignature} from '../signature.mjs';
import {renderReport} from '../report.mjs';
import {makeFixture, testJob} from './fixture.mjs';

const fixture = makeFixture();
function fake(value = fixture.publicKey) {
  return {getChainId:async () => 11155111, getBlockNumber:async () => 42n,
    getCode:async () => '0x6000', getEnsText:async args => {
      assert.equal(args.name, 'rover.eth');
      assert.equal(args.key, ENS_RECORD);
      assert.equal(args.blockNumber, 42n);
      assert.equal(args.strict, true);
      return value;
    }};
}
const resolve = client => resolveEnsPublicKey({name:'ROVER.eth', client});

test('ENS name is normalized and onchain key is passed into existing signature verification', async () => {
  const ens = await resolve(fake());
  assert.equal(ens.name, 'rover.eth');
  assert.equal(ens.blockNumber, '42');
  assert.equal(ens.chainId, 11155111);
  assert.equal(verifyDeviceSignature(fixture, ens.publicKey, testJob).digest, fixture.digest);
  const otherKey = makeFixture(testJob, '02'.padStart(64, '0')).publicKey;
  const other = await resolve(fake(otherKey));
  assert.throws(() => verifyDeviceSignature(fixture, other.publicKey, testJob), /UNREGISTERED_DEVICE_KEY/);
});

test('wrong chain and missing resolver fail before reading a key', async () => {
  const noRead = async () => {assert.fail('unexpected lookup');};
  await assert.rejects(resolve({...fake(), getChainId:async () => 1, getEnsText:noRead}), /ENS_CHAIN_MISMATCH/);
  await assert.rejects(resolve({...fake(), getCode:async () => undefined, getEnsText:noRead}), /ENS_RESOLVER_NOT_DEPLOYED/);
});

test('missing or malformed ENS keys never fall back to the device response key', async () => {
  await assert.rejects(resolve(fake(null)), /ENS_KEY_NOT_REGISTERED/);
  await assert.rejects(resolve(fake('')), /ENS_KEY_NOT_REGISTERED/);
  for (const key of ['0x1234', '0x' + '00'.repeat(64), ' https://example.com/key ']) {
    await assert.rejects(resolve(fake(key)), /ENS_INVALID_PUBLIC_KEY/);
  }
});

test('ENS errors hide credential-bearing transport details and timeout is bounded', async () => {
  await assert.rejects(resolve({...fake(), getEnsText:async () => {throw new Error('https://rpc.example/SECRET');}}),
    error => error.message === 'ENS_LOOKUP_FAILED');
  await assert.rejects(resolveEnsPublicKey({name:'rover.eth', timeoutMs:10,
    client:{...fake(), getEnsText:() => new Promise(() => {})}}), /ENS_LOOKUP_TIMEOUT/);
});

test('invalid names are rejected before any network request', () => {
  for (const name of ['', undefined, 'https://rover.eth', 'rover', 'rover..eth', 'a'.repeat(256) + '.eth']) {
    assert.throws(() => normalizeRobotName(name), /ENS_INVALID_NAME/);
  }
});

test('report uses fresh ENS metadata and labels saved signature and partial RPC failure', async () => {
  const ens = await resolve(fake());
  const html = renderReport(fixture, null, {ens, signatureSource:'saved', rpcFailed:true});
  assert.match(html, /ENSから取得した公開鍵と機体署名が一致/);
  assert.match(html, /保存済み署名を再検証/);
  assert.match(html, /未確認（RPC照会または検証に失敗）/);
  assert.ok(!renderReport({...fixture, ens}).includes('ENSから取得した公開鍵と機体署名が一致'));
  assert.ok(!renderReport(fixture, null, {ens:{...ens, name:'<script>alert(1)</script>'}}).includes('<script>'));
});
