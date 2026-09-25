import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../apps/web/app/api/demo/rover/control/route.ts';

const session = 'test-gripper-session-1234';
function request(body, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/demo/rover/control', {
    method:'POST', headers:{host:'localhost:3000', origin, 'content-type':'application/json'}, body:JSON.stringify(body),
  });
}

test('open, gradual close, release and stop preserve the bridge session and sequence', async t => {
  const saved = process.env.VBB_BRIDGE_TOKEN;
  process.env.VBB_BRIDGE_TOKEN = 'test-token';
  t.after(() => {if (saved === undefined) delete process.env.VBB_BRIDGE_TOKEN; else process.env.VBB_BRIDGE_TOKEN = saved;});
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    calls.push([url, JSON.parse(init.body)]);
    return Response.json({state:'ready'});
  });
  for (const body of [
    {action:'gripper', session, sequence:1, gripperAction:'open'},
    {action:'gripper', session, sequence:2, gripperAction:'close'},
    {action:'release', session, sequence:3},
    {action:'stop', session},
  ]) assert.equal((await POST(request(body))).status, 200);
  assert.deepEqual(calls, [
    ['http://127.0.0.1:8765/gripper', {session, sequence:1, action:'open'}],
    ['http://127.0.0.1:8765/gripper', {session, sequence:2, action:'close'}],
    ['http://127.0.0.1:8765/release', {session, sequence:3}],
    ['http://127.0.0.1:8765/stop', {session}],
  ]);
});

test('invalid gripper commands and foreign origins never reach the robot', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => {throw Error('Unexpected actuator call');});
  const valid = {action:'gripper', session, sequence:1, gripperAction:'open'};
  for (const changed of [{session:''}, {sequence:-1}, {sequence:1.5}, {sequence:'1'}, {gripperAction:'arbitrary-angle'}]) {
    assert.equal((await POST(request({...valid,...changed}))).status, 400);
  }
  assert.equal((await POST(request(valid, 'https://other.example'))).status, 400);
  assert.equal(upstream.mock.callCount(), 0);
});
