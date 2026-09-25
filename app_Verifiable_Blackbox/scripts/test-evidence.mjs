import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDemoEvidence, evidenceCommitment, demoEvidenceToWire} from '../apps/web/lib/contracts.ts';

const fixture = JSON.parse(readFileSync(new URL('../packages/contracts/test/evidence.fixture.json', import.meta.url), 'utf8'));
const evidence = parseDemoEvidence(fixture);
const hash = evidenceCommitment(evidence);
assert.deepEqual(demoEvidenceToWire(evidence), fixture);
assert.notEqual(evidenceCommitment({...evidence, imageHash: '0x' + 'ab'.repeat(32)}), hash);
for (const patch of [{jobId:'0'}, {sequence:-1}, {sequence:Number.MAX_SAFE_INTEGER + 1}, {capturedAt:'18446744073709551616'}, {imageHash:'0xab'}, {unknown:true}, {scenario:'unexpected'}]) {
  assert.throws(() => parseDemoEvidence({...fixture,...patch}));
}
const solidity = readFileSync(new URL('../packages/contracts/test/EvidenceEncoding.t.sol', import.meta.url), 'utf8');
assert.ok(solidity.includes(hash), 'Solidity must assert the identical commitment fixture');
console.log('PASS: evidence wire roundtrip, tamper divergence, malformed input rejection and shared Solidity hash vector', hash);
