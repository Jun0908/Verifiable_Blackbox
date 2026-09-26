// Public fixtures only. No hardware, RPC, wallets or payment calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const app=resolve(process.env.VBB_APP_ROOT || resolve(root,'../app_Verifiable_Blackbox'));
const python=resolve(root,'rover-python/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
mkdirSync(resolve(root,'.tools'),{recursive:true});
const exe=resolve(root,'.tools/host_signature'+(process.platform==='win32'?'.exe':''));
const compile=spawnSync(python,['-m','ziglang','c++','-std=c++17','-I',resolve(root,'m5stick-rover/include'),resolve(root,'m5stick-rover/test/host_signature.cpp'),'-o',exe],{stdio:'inherit',windowsHide:true});
assert.equal(compile.status,0);
const {SCHEMA_HASH,encodeJob,digestJob,verifyDeviceSignature}=await import(pathToFileURL(resolve(app,'parts/device-signature/signature.mjs')));
const {makeFixture,testJob}=await import(pathToFileURL(resolve(app,'parts/device-signature/test/fixture.mjs')));
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
for(const job of [testJob,{chainId:'11155111',core:'0x1234567890123456789012345678901234567890',jobId:((1n<<256n)-1n).toString()}]) {
  const result=spawnSync(exe,[SCHEMA_HASH,word(job.chainId),job.core,word(job.jobId)],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  const hex=result.stdout.trim();
  assert.equal('0x'+hex,encodeJob(job));
  assert.equal('0x'+createHash('sha256').update(Buffer.from(hex,'hex')).digest('hex'),digestJob(job));
}
const fixture=makeFixture();
verifyDeviceSignature(fixture,fixture.publicKey,testJob);
assert.throws(()=>verifyDeviceSignature({...fixture,jobId:'999'},fixture.publicKey,testJob));
console.log('PASS: Firmware ABI bytes and digest match Blackbox; public P-256 fixture verified, wrong Job rejected. No hardware used.');
