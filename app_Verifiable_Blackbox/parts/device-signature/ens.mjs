import {createPublicClient, http} from 'viem';
import {sepolia} from 'viem/chains';
import {normalize} from 'viem/ens';
import {publicKey} from './signature.mjs';

export const ENS_RECORD = 'vbb.device.p256';
export const ENS_CHAIN_ID = sepolia.id;

export function normalizeRobotName(name) {
  try {
    if (typeof name !== 'string' || !name.trim()) throw new Error();
    const normalized = normalize(name.trim());
    if (!normalized.endsWith('.eth') || normalized.length > 255) throw new Error();
    return normalized;
  } catch { throw new Error('ENS_INVALID_NAME'); }
}

export function createEnsClient(rpcUrl) {
  if (!rpcUrl) throw new Error('ENS_RPC_REQUIRED');
  try {
    const url = new URL(rpcUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch { throw new Error('ENS_INVALID_RPC_URL'); }
  // This demo reads onchain text records only; never follows resolver-provided URLs.
  return createPublicClient({chain:sepolia, ccipRead:false,
    transport:http(rpcUrl, {timeout:5000, retryCount:0})});
}

export async function resolveEnsPublicKey({name, rpcUrl, client, timeoutMs = 12000}) {
  const normalized = normalizeRobotName(name);
  const reader = client ?? createEnsClient(rpcUrl);
  const universalResolver = sepolia.contracts.ensUniversalResolver.address;
  let timer;
  const lookup = async () => {
    if (await reader.getChainId() !== ENS_CHAIN_ID) throw new Error('ENS_CHAIN_MISMATCH');
    const blockNumber = await reader.getBlockNumber();
    const code = await reader.getCode({address:universalResolver, blockNumber});
    if (!code || code === '0x') throw new Error('ENS_RESOLVER_NOT_DEPLOYED');
    // Read through the canonical proxy supplied by viem, not the legacy registry
    // or a pinned ENSv2 implementation address.
    const value = await reader.getEnsText({name:normalized, key:ENS_RECORD, blockNumber, strict:true});
    if (!value) throw new Error('ENS_KEY_NOT_REGISTERED');
    let key;
    try { key = publicKey(value); } catch { throw new Error('ENS_INVALID_PUBLIC_KEY'); }
    return {version:1, source:'ens', name:normalized, chainId:ENS_CHAIN_ID,
      recordKey:ENS_RECORD, publicKey:key, universalResolver,
      blockNumber:blockNumber.toString(), resolvedAt:new Date().toISOString()};
  };
  try {
    return await Promise.race([lookup(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('ENS_LOOKUP_TIMEOUT')), timeoutMs);
    })]);
  } catch (error) {
    // RPC errors may contain credential-bearing URLs. Expose only our own codes.
    const known = ['ENS_CHAIN_MISMATCH','ENS_RESOLVER_NOT_DEPLOYED','ENS_KEY_NOT_REGISTERED',
      'ENS_INVALID_PUBLIC_KEY','ENS_LOOKUP_TIMEOUT'];
    throw new Error(known.includes(error.message) ? error.message : 'ENS_LOOKUP_FAILED');
  } finally { clearTimeout(timer); }
}
