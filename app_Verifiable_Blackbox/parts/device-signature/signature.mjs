import {p256} from '@noble/curves/p256';
import {encodeAbiParameters, hexToBytes, sha256, stringToHex} from 'viem';

export const SCHEMA = 'DeviceJobSignatureV1';
export const SCHEMA_HASH = sha256(stringToHex(SCHEMA));
export const MAGIC = '0x024ad318';
export const verifierAbi = [{type: 'function', name: 'verify', stateMutability: 'view',
  inputs: [{name: 'key', type: 'bytes'}, {name: 'hash', type: 'bytes32'}, {name: 'signature', type: 'bytes'}],
  outputs: [{type: 'bytes4'}]}];

function hex(value, size, name) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  return value.toLowerCase();
}

function uint(value, name) {
  if (typeof value !== 'string' || !/^(?:[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  const n = BigInt(value);
  if (n <= 0n || n >= 1n << 256n) throw new Error(`INVALID_${name}`);
  return n.toString();
}

export function context(input) {
  const core = hex(input.core, 20, 'CORE');
  if (BigInt(core) === 0n) throw new Error('INVALID_CORE');
  return {chainId: uint(input.chainId, 'CHAIN_ID'), core, jobId: uint(input.jobId, 'JOB_ID')};
}

export function encodeJob(input) {
  const job = context(input);
  return encodeAbiParameters([{type: 'bytes32'}, {type: 'uint256'}, {type: 'address'}, {type: 'uint256'}],
    [SCHEMA_HASH, BigInt(job.chainId), job.core, BigInt(job.jobId)]);
}

export function digestJob(input) { return sha256(encodeJob(input)); }

export function publicKey(input) {
  const key = hex(input, 64, 'PUBLIC_KEY');
  // Check the point rather than accepting arbitrary 64-byte identifiers.
  p256.ProjectivePoint.fromHex(`04${key.slice(2)}`).assertValidity();
  return key;
}

export function verifyDeviceSignature(record, trustedKey, expectedJob) {
  if (record.version !== 1 || record.schema !== SCHEMA) throw new Error('UNSUPPORTED_SCHEMA');
  const expected = context(expectedJob);
  const actual = context(record);
  if (Object.keys(expected).some(key => actual[key] !== expected[key])) throw new Error('JOB_CONTEXT_MISMATCH');
  const key = publicKey(trustedKey);
  if (publicKey(record.publicKey) !== key) throw new Error('UNREGISTERED_DEVICE_KEY');
  const digest = digestJob(expected);
  if (hex(record.digest, 32, 'DIGEST') !== digest) throw new Error('DIGEST_MISMATCH');
  const signature = hex(record.signature, 64, 'SIGNATURE');
  if (!p256.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(`0x04${key.slice(2)}`),
    {lowS: true, prehash: false})) throw new Error('INVALID_DEVICE_SIGNATURE');
  return {version: 1, schema: SCHEMA, ...expected, publicKey: key, digest, signature,
    ...(record.testFixture === true ? {testFixture:true} : {})};
}

export async function verifyERC7913(client, verifier, record) {
  const address = hex(verifier, 20, 'VERIFIER');
  if (BigInt(await client.getChainId()) !== BigInt(record.chainId)) throw new Error('RPC_CHAIN_MISMATCH');
  const code = await client.getCode({address});
  if (!code || code === '0x') throw new Error('VERIFIER_NOT_DEPLOYED');
  const value = await client.readContract({address, abi: verifierAbi, functionName: 'verify',
    args: [record.publicKey, record.digest, record.signature]});
  if (value.toLowerCase() !== MAGIC) throw new Error('ERC7913_REJECTED');
  return {status: 'verified', address, method: 'eth_call', persistedOnChain: false};
}
