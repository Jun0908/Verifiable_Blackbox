import assert from 'node:assert/strict';
import {readJobHistory, saveJobToHistory} from '../apps/web/lib/job-history.ts';
import {canLeaveWithoutStop} from '../apps/web/lib/rover-exit.ts';

const storage = new Map();
globalThis.localStorage = {getItem:key=>storage.get(key)??null, setItem:(key,value)=>storage.set(key,value)};
const wallet='0x'+'a'.repeat(40), core='0x'+'b'.repeat(40);
const scope={wallet,core,chainId:11155111};
const job=(id,char,status=1)=>({version:3,walletAddress:wallet,verified:false,
  job:{jobId:id,source:'rover',scenario:'success',createTransactionHash:'0x'+char.repeat(64),fundTransactionHash:'0x'+char.repeat(64)},
  status:{jobId:id,status,escrowBalance:'100000000',clientBalance:'0',providerBalance:'0'}});
localStorage.setItem('vbb-demo-state-v3','unchanged');
saveJobToHistory(scope,job('14','c'));
saveJobToHistory(scope,job('15','d'));
assert.deepEqual(readJobHistory(scope).map(entry=>entry.job.jobId),['15','14']);
assert.equal(readJobHistory(scope)[1].status.escrowBalance,'100000000');
assert.equal(localStorage.getItem('vbb-demo-state-v3'),'unchanged','Saving history must not select or complete a job');
assert.deepEqual(readJobHistory({...scope,wallet:'0x'+'e'.repeat(40)}),[]);
assert.deepEqual(readJobHistory({...scope,chainId:31337}),[]);
assert.deepEqual(readJobHistory({...scope,core:'0x'+'f'.repeat(40)}),[]);
assert.throws(()=>saveJobToHistory({...scope,wallet:'0x'+'e'.repeat(40)},job('14','c')),/WALLET_MISMATCH/);
saveJobToHistory(scope,{...job('14','c',3),completeTransactionHash:'0x'+'1'.repeat(64)});
assert.equal(readJobHistory(scope).length,2);
assert.equal(readJobHistory(scope)[0].status.status,3);
assert.equal(readJobHistory(scope)[0].completeTransactionHash,'0x'+'1'.repeat(64));
saveJobToHistory(scope,job('14','2'));
assert.equal(readJobHistory(scope).length,3,'Different creation transactions must not collide');
const before=[...storage];
globalThis.localStorage.setItem=()=>{throw Error('Quota exceeded');};
assert.throws(()=>saveJobToHistory(scope,job('16','3')),/Quota exceeded/);
assert.deepEqual([...storage],before,'Storage errors must preserve prior jobs');
for(const state of ['idle','error','offline']) assert.equal(canLeaveWithoutStop('old-session',state),true);
for(const state of ['ready','commanding','stopping',undefined]) assert.equal(canLeaveWithoutStop('owned-session',state),false);
assert.equal(canLeaveWithoutStop(undefined,'ready'),true,'An unowned session must not trap the page or be stopped');
console.log('PASS: history retention, wallet/chain/core isolation, receipt updates, storage failure, disconnected return, active stop still required.');
