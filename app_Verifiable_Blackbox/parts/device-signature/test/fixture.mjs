import {p256} from '@noble/curves/p256';
import {bytesToHex, hexToBytes} from 'viem';
import {digestJob, SCHEMA} from '../signature.mjs';

// PUBLIC TEST KEY ONLY. Never enroll this key as a real device.
export const testPrivateKey = '01'.padStart(64, '0');
export const testJob = {chainId:'31337', core:'0x1111111111111111111111111111111111111111', jobId:'7'};
export function makeFixture(job = testJob, privateKey = testPrivateKey) {
  const digest = digestJob(job);
  return {version:1, schema:SCHEMA, testFixture:true, ...job,
    publicKey:bytesToHex(p256.getPublicKey(privateKey, false).slice(1)), digest,
    signature:bytesToHex(p256.sign(hexToBytes(digest), privateKey, {lowS:true, prehash:false}).toCompactRawBytes())};
}
