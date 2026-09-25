import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {createPublicClient, http} from 'viem';
import {context, publicKey, verifyDeviceSignature, verifyERC7913} from './signature.mjs';
import {requestDevice} from './device.mjs';
import {renderReport} from './report.mjs';
import {resolveEnsPublicKey} from './ens.mjs';

const usage = `node cli.mjs key --device http://ROVER_IP --out device-key.json
node cli.mjs sign --device http://ROVER_IP --key device-key.json --chain-id 31337 --core 0x... --job-id 7 --out signature.json
node cli.mjs verify --input signature.json --key device-key.json --chain-id 31337 --core 0x... --job-id 7 [--rpc http://127.0.0.1:8545 --verifier 0x...] [--report report.html]
node cli.mjs ens --ens YOUR_NAME.eth [--ens-rpc URL] [--out ens-key.json]
For sign/verify, replace --key with --ens YOUR_NAME.eth to read the key from ENSv2 on Sepolia.
ENS RPC: --ens-rpc, ENS_RPC_URL, or --rpc (in that order). Keys are never silently substituted.
Device access uses ROVER_API_TOKEN from the environment. No motor, Phala or payment calls are made.`;

async function save(path, value) {
  await mkdir(dirname(resolve(path)), {recursive: true});
  // Never silently replace an enrolled key or an earlier signed record.
  await writeFile(path, value, {flag: 'wx'});
}

try {
  const {values: args, positionals} = parseArgs({allowPositionals: true, options: Object.fromEntries(
    ['device','out','key','chain-id','core','job-id','input','rpc','verifier','report','ens','ens-rpc'].map(name => [name, {type:'string'}]))});
  const command = positionals[0];
  if (!command || command === 'help') { console.log(usage); }
  else {
    if (positionals.length !== 1 || !['key','sign','verify','ens'].includes(command)) throw new Error('INVALID_COMMAND');
    if (args.ens && args.key) throw new Error('CHOOSE_ENS_OR_KEY_FILE');
    if (args['ens-rpc'] && !args.ens) throw new Error('ENS_NAME_REQUIRED');
    if (command === 'key') {
      if (args.ens) throw new Error('ENS_NOT_SUPPORTED_FOR_DEVICE_KEY_EXPORT');
      if (!args.device || !args.out) throw new Error('DEVICE_AND_OUT_REQUIRED');
      const response = await requestDevice({url: args.device, token: process.env.ROVER_API_TOKEN, keyOnly: true});
      await save(args.out, JSON.stringify({version:1, publicKey:publicKey(response.publicKey)}, null, 2) + '\n');
      console.log('Public key saved. Confirm this is your device before using this file as the trusted key.');
    } else if (command === 'ens') {
      if (!args.ens) throw new Error('ENS_NAME_REQUIRED');
      const ens = await resolveEnsPublicKey({name:args.ens,
        rpcUrl:args['ens-rpc'] ?? process.env.ENS_RPC_URL ?? args.rpc});
      if (args.out) await save(args.out, JSON.stringify(ens, null, 2) + '\n');
      console.log(JSON.stringify({...ens, deviceSignature:'not_checked', payment:'not_checked_or_changed'}, null, 2));
    } else {
      if (!args.key && !args.ens) throw new Error('TRUSTED_KEY_REQUIRED');
      if (Boolean(args.rpc) !== Boolean(args.verifier)) throw new Error('RPC_AND_VERIFIER_REQUIRED_TOGETHER');
      const job = context({chainId:args['chain-id'], core:args.core, jobId:args['job-id']});
      const ens = args.ens ? await resolveEnsPublicKey({name:args.ens,
        rpcUrl:args['ens-rpc'] ?? process.env.ENS_RPC_URL ?? args.rpc}) : null;
      const key = ens ? ens.publicKey : publicKey(JSON.parse(await readFile(args.key, 'utf8')).publicKey);
      let raw;
      if (command === 'sign') {
        if (!args.device || !args.out) throw new Error('DEVICE_AND_OUT_REQUIRED');
        raw = await requestDevice({url:args.device, token:process.env.ROVER_API_TOKEN, job});
      } else {
        if (!args.input) throw new Error('INPUT_REQUIRED');
        raw = JSON.parse(await readFile(args.input, 'utf8'));
      }
      const record = verifyDeviceSignature(raw, key, job);
      // Preserve a valid device response even when RPC is temporarily unavailable.
      if (command === 'sign') await save(args.out, JSON.stringify({...record, ...(ens ? {ens} : {})}, null, 2) + '\n');
      let rpc = null, rpcFailed = false;
      if (args.rpc) {
        try { rpc = await verifyERC7913(createPublicClient({transport:http(args.rpc, {timeout:10000, retryCount:0})}), args.verifier, record); }
        catch { rpcFailed = true; }
      }
      if (args.report) await save(args.report, renderReport(record, rpc, {ens,
        signatureSource:command === 'verify' ? 'saved' : 'device', rpcFailed}));
      console.log(JSON.stringify({job, deviceSignature:'verified', erc7913:rpc ?? {status:'not_checked'},
        ens:ens ?? {status:'not_used'}, signatureSource:command === 'verify' ? 'saved' : 'device',
        payment:'not_checked_or_changed'}, null, 2));
      if (rpcFailed) throw new Error('ERC7913_CHECK_FAILED');
    }
  }
} catch (error) {
  // Do not print HTTP request headers or environment values on errors.
  const code = error.message;
  console.error(/^[A-Z][A-Z0-9_]+$/.test(code) ? code : 'DEVICE_SIGNATURE_COMMAND_FAILED');
  process.exitCode = 1;
}
