// Starts its own disposable local chain. Never reads testnet env or uses a real wallet.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPublicClient, createWalletClient, http} from 'viem';
import {makeFixture, testJob} from './test/fixture.mjs';
import {verifyDeviceSignature, verifyERC7913} from './signature.mjs';
import {renderReport} from './report.mjs';

const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const binary = fileURLToPath(new URL('../../.tools/foundry-v1.7.1/anvil.exe', import.meta.url));
const processHandle = spawn(binary, ['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--hardfork','cancun','--silent'],
  {stdio:'ignore', windowsHide:true});
let startupError;
processHandle.on('error', error => {startupError = error;});
try {
  const transport = http(`http://127.0.0.1:${port}`, {timeout:1000, retryCount:0});
  const client = createPublicClient({transport});
  let started = false;
  for (let i = 0; i < 50; i++) {
    if (startupError) throw startupError;
    try { await client.getChainId(); started = true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!started) throw new Error('LOCAL_ANVIL_START_FAILED');
  const artifact = JSON.parse(await readFile(new URL('./out/DeviceSignatureVerifier.sol/DeviceSignatureVerifier.json', import.meta.url)));
  const wallet = createWalletClient({transport});
  const [account] = await wallet.getAddresses();
  const transaction = await wallet.deployContract({account, chain:null, abi:artifact.abi, bytecode:artifact.bytecode.object});
  const receipt = await client.waitForTransactionReceipt({hash:transaction});
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('LOCAL_DEPLOY_FAILED');
  const fixture = makeFixture();
  const record = verifyDeviceSignature(fixture, fixture.publicKey, testJob);
  const rpcResult = await verifyERC7913(client, receipt.contractAddress, record);
  const solidityDigest = await client.readContract({address:receipt.contractAddress, abi:artifact.abi,
    functionName:'hashJob', args:[BigInt(testJob.chainId), testJob.core, BigInt(testJob.jobId)]});
  if (solidityDigest !== record.digest) throw new Error('CROSS_LANGUAGE_DIGEST_MISMATCH');
  const local = new URL('./local/', import.meta.url);
  await mkdir(local, {recursive:true});
  await writeFile(new URL('test-fixture.json', local), JSON.stringify(fixture, null, 2));
  await writeFile(new URL('test-key.json', local), JSON.stringify({publicKey:fixture.publicKey}, null, 2));
  await writeFile(new URL('test-report.html', local), renderReport({...record, testFixture:true}, rpcResult));
  console.log(JSON.stringify({fixtureOnly:true, deviceUsed:false, p256:'passed', solidityDigest:'matched',
    erc7913:rpcResult, phala:'untouched', payment:'untouched', chain:'disposable local Anvil'}, null, 2));
} finally {
  if (processHandle.exitCode === null && !processHandle.killed) {
    processHandle.kill();
    await new Promise(resolve => processHandle.once('exit', resolve));
  }
}
