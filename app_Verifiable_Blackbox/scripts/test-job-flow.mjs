import assert from 'node:assert/strict';
import {readActiveRobotJob,recordControlEnded,controlHasEnded} from '../apps/web/lib/job-flow.ts';
import {activeJobKey,storeDemoState,loadDemoState} from '../apps/web/lib/active-job.ts';
const data=new Map();
globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
const scope={wallet:'0x'+'1'.repeat(40),core:'0x'+'2'.repeat(40),chainId:31337};
const job={jobId:13n,source:'rover',scenario:'success',createTransactionHash:'0x'+'a'.repeat(64),fundTransactionHash:'0x'+'a'.repeat(64)};
assert.equal(readActiveRobotJob(scope),undefined);
storeDemoState(scope,job,{verified:false});
assert.equal(readActiveRobotJob(scope).jobId,'13');
for(const alternate of [{...scope,wallet:'0x'+'9'.repeat(40)},{...scope,chainId:11155111},{...scope,core:'0x'+'9'.repeat(40)}]) {
  assert.equal(readActiveRobotJob(alternate),undefined);
  storeDemoState(alternate,{...job,jobId:14n},{verified:false});
  assert.equal(loadDemoState(scope).job.jobId,'13');
  assert.equal(loadDemoState(alternate).job.jobId,'14');
}
const active=readActiveRobotJob(scope);
assert.equal(controlHasEnded(active),false);recordControlEnded(active);assert.equal(controlHasEnded(active),true);
for(const alternate of [{...active,jobId:'14'},{...active,chainId:11155111},{...active,core:'0x'+'9'.repeat(40)},{...active,wallet:'0x'+'9'.repeat(40)}])assert.equal(controlHasEnded(alternate),false);
assert.equal(loadDemoState(scope).verified,false,'Operation must not set verified');
storeDemoState(scope,{...job,source:'fixture'},{verified:false});assert.equal(readActiveRobotJob(scope),undefined);
storeDemoState(scope,job,{verified:true});assert.equal(readActiveRobotJob(scope),undefined,'Paid job cannot become active rover work');
localStorage.setItem(activeJobKey(scope),'broken');assert.equal(readActiveRobotJob(scope),undefined);
console.log('PASS: selected-job wallet/chain/core isolation, sample/paid exclusion, scoped operation markers and malformed storage.');
