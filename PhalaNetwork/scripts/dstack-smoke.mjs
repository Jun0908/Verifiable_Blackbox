import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { recoverTypedDataAddress } from 'viem';
import { loadConfig } from '../dist/config.js';
import { createSecurityProvider, verdictDomain } from '../dist/security.js';
import { verdictTypes } from '../dist/contracts.js';
const endpoint = process.env.DSTACK_SIMULATOR_ENDPOINT;
assert.ok(endpoint,'Set DSTACK_SIMULATOR_ENDPOINT explicitly');
const config = loadConfig({RPC_URL:'http://127.0.0.1:8545',CHAIN_ID:'31337',
  ERC8183_ADDRESS:'0x0000000000000000000000000000000000000001',EVIDENCE_HOOK_ADDRESS:'0x0000000000000000000000000000000000000002',
  EVALUATOR_ADDRESS:'0x0000000000000000000000000000000000000003',VERIFIER_MODE:'PHALA_DSTACK',DSTACK_SIMULATOR_ENDPOINT:endpoint});
const first = await createSecurityProvider(config); const second = await createSecurityProvider(config);
assert.equal(first.address,second.address);
const nonce = randomBytes(32).toString('hex');
const a = await first.getAttestation(nonce); const b = await second.getAttestation(randomBytes(32).toString('hex'));
assert.equal(a.claims.nonce,nonce); assert.notEqual(a.reportData,b.reportData); assert.ok(a.quote); assert.equal(a.attested,false); assert.equal(a.simulated,true);
const verdict = {jobId:1n,provider:config.erc8183Address,evidenceCommitment:`0x${'ab'.repeat(32)}`,outcome:1,issuedAt:1n,validUntil:2n,nonce:`0x${randomBytes(32).toString('hex')}`};
const signature = await first.signVerdict(verdict);
assert.equal(await recoverTypedDataAddress({domain:verdictDomain(config),types:verdictTypes,primaryType:'DemoVerdictV1',message:verdict,signature}),first.address);
console.log(JSON.stringify({ok:true,simulated:true,attested:false,hardwareQuoteVerified:false,deterministicSigner:true,signatureVerified:true,nonceBound:true,signerAddress:first.address}));
