import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, unlink, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeFunctionData, encodeFunctionResult, parseAbi} from 'viem';
import {sepolia} from 'viem/chains';
import {namehash} from 'viem/ens';
import {MAGIC} from '../signature.mjs';
import {makeFixture} from './fixture.mjs';

const resolveAbi = parseAbi(['function resolveWithGateways(bytes name, bytes data, string[] gateways) view returns (bytes, address)']);
const textAbi = parseAbi(['function text(bytes32 node, string key) view returns (string)']);
const verifyAbi = parseAbi(['function verify(bytes key, bytes32 hash, bytes signature) view returns (bytes4)']);
const job = {chainId:'11155111', core:'0x1111111111111111111111111111111111111111', jobId:'7'};
const fixture = makeFixture(job);
const verifier = '0x2222222222222222222222222222222222222222';

test('CLI resolves via Universal Resolver, verifies with ENS key, and distinguishes failures and file mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vbb-ens-cli-'));
  const input = join(dir, 'signature.json'), keyFile = join(dir, 'key.json');
  const report = join(dir, 'report.html'), partial = join(dir, 'partial.html'), fileReport = join(dir, 'file.html');
  // Deliberately embed untrusted provenance; --key must never promote it to ENS proof.
  await writeFile(input, JSON.stringify({...fixture, ens:{name:'untrusted.eth'}}));
  await writeFile(keyFile, JSON.stringify({publicKey:fixture.publicKey}));
  let registeredKey = fixture.publicKey, magic = MAGIC;
  const calls = [], rpcErrors = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw); calls.push(request);
    try {
      let result;
      if (request.method === 'eth_chainId') result = '0xaa36a7';
      else if (request.method === 'eth_blockNumber') result = '0xb71b00';
      else if (request.method === 'eth_getCode') result = '0x6000';
      else if (request.method === 'eth_call') {
        const tx = request.params[0];
        if (tx.to.toLowerCase() === sepolia.contracts.ensUniversalResolver.address.toLowerCase()) {
          const call = decodeFunctionData({abi:resolveAbi, data:tx.data});
          assert.equal(request.params[1], '0xb71b00');
          const text = decodeFunctionData({abi:textAbi, data:call.args[1]});
          assert.deepEqual(text.args, [namehash('rover.eth'), 'vbb.device.p256']);
          result = encodeFunctionResult({abi:resolveAbi, functionName:'resolveWithGateways',
            result:[encodeFunctionResult({abi:textAbi, functionName:'text', result:registeredKey}),verifier]});
        } else {
          assert.equal(tx.to.toLowerCase(), verifier);
          const verify = decodeFunctionData({abi:verifyAbi, data:tx.data});
          assert.equal(verify.args[0], fixture.publicKey);
          result = encodeFunctionResult({abi:verifyAbi, functionName:'verify', result:magic});
        }
      } else throw new Error(`Unexpected RPC: ${request.method}`);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({jsonrpc:'2.0', id:request.id, result}));
    } catch (error) {
      rpcErrors.push(error.message);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({jsonrpc:'2.0', id:request.id, error:{code:-32603,message:error.message}}));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const base = ['verify','--input',input,'--chain-id',job.chainId,'--core',job.core,'--job-id',job.jobId];
  const ens = ['--ens','ROVER.eth','--ens-rpc',url,'--rpc',url,'--verifier',verifier];
  function run(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)),...args],
        {windowsHide:true, env:{...process.env,ENS_RPC_URL:''}});
      let out='', err=''; child.stdout.on('data', data => out+=data); child.stderr.on('data', data => err+=data);
      child.on('error', reject); child.on('close', code => resolve({code,out,err}));
    });
  }
  try {
    const ok = await run([...base,...ens,'--report',report]);
    assert.equal(ok.code, 0, JSON.stringify({stderr:ok.err,rpcErrors,methods:calls.map(c=>c.method)}));
    assert.equal(JSON.parse(ok.out).ens.name, 'rover.eth');
    assert.equal(JSON.parse(ok.out).erc7913.status, 'verified');
    assert.match(await readFile(report,'utf8'), /ENSから取得した公開鍵と機体署名が一致/);

    registeredKey = makeFixture(job, '02'.padStart(64,'0')).publicKey;
    const mismatch = await run([...base,...ens]);
    assert.equal(mismatch.code, 1); assert.match(mismatch.err,/UNREGISTERED_DEVICE_KEY/);
    registeredKey = ''; const missing = await run([...base,...ens]);
    assert.equal(missing.code, 1); assert.match(missing.err,/ENS_KEY_NOT_REGISTERED/);

    registeredKey = fixture.publicKey; magic='0xffffffff';
    const failed = await run([...base,...ens,'--report',partial]);
    assert.equal(failed.code, 1); assert.match(failed.err,/ERC7913_CHECK_FAILED/);
    assert.match(await readFile(partial,'utf8'),/未確認（RPC照会または検証に失敗）/);

    const file = await run([...base,'--key',keyFile,'--report',fileReport]);
    assert.equal(file.code,0,file.err);
    assert.match(await readFile(fileReport,'utf8'),/ENS：未使用/);
    assert.ok(!calls.some(call => /send|sign/i.test(call.method)));
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const path of [input,keyFile,report,partial,fileReport]) await unlink(path).catch(() => {});
    await rmdir(dir);
  }
});
