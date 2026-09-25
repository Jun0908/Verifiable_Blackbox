import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDevice} from '../device.mjs';
import {makeFixture, testJob} from './fixture.mjs';

test('request uses auth, fixed Job words and polls only signature endpoints', async () => {
  const calls = [];
  const result = await requestDevice({url:'http://127.0.0.1', token:'test-only', job:testJob,
    fetchImpl:async (url, options) => {
      calls.push({path:url.pathname, options});
      return {ok:true, json:async () => calls.length === 1 ? {state:'busy'} : {...makeFixture(), state:'ready'}};
    }});
  assert.equal(result.state, 'ready');
  assert.deepEqual(calls.map(call => call.path), ['/device-signature', '/device-signature']);
  assert.equal(calls[0].options.headers['X-Rover-Token'], 'test-only');
  assert.equal(calls[0].options.body.get('job_id'), '0x' + '7'.padStart(64, '0'));
  assert.equal(calls[0].options.redirect, 'error');
});
test('armed device refusal is surfaced, without disarming it or retrying commands', async () => {
  let count = 0;
  await assert.rejects(requestDevice({url:'http://127.0.0.1', token:'test-only', job:testJob,
    fetchImpl:async () => { count++; return {ok:false,status:409}; }}), /DEVICE_HTTP_409/);
  assert.equal(count, 1);
});
test('missing authentication fails before HTTP', async () => {
  await assert.rejects(requestDevice({url:'http://127.0.0.1', job:testJob,
    fetchImpl:async () => {throw new Error('HTTP must not run');}}), /ROVER_API_TOKEN_REQUIRED/);
});
