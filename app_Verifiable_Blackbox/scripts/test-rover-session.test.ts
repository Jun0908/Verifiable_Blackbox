import test, {type TestContext} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {resolve, sep} from "node:path";
import {privateKeyToAccount} from "viem/accounts";
import {toHex, type Address} from "viem";
import {RoverSessions} from "../apps/web/lib/server/rover-session/service.ts";
import {RoverSessionStore} from "../apps/web/lib/server/rover-session/store.ts";
import {roverAccessMessage, roverAuthorizationMessage, roverRunRequest, roverSkipAuthorizationMessage,
  type RoverAccess, type RoverOptions, type RoverRun} from "../apps/web/lib/rover-session.ts";

const owner = privateKeyToAccount(toHex(111n, {size: 32}));
const stranger = privateKeyToAccount(toHex(222n, {size: 32}));
const address = (n: number) => toHex(n, {size: 20}) as Address;
const skip: RoverOptions = {judgmentMode: "SKIP_VIDEO", operation: "FORWARD", durationMs: 3000, speed: 35};
async function fixture(t: TestContext) {
  const base = resolve("tmp");
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(resolve(base, "rover-session-"));
  t.after(async () => {assert.ok(root.startsWith(base + sep)); await rm(root, {recursive: true, force: true});});
  let now = 1790380800, videoCalls = 0;
  const scope = {chainId: 31337, core: address(1)};
  const store = new RoverSessionStore(root, scope);
  const job = {id: 1n, client: owner.address, provider: address(2), budget: 100000000n, expiredAt: BigInt(now + 3600), evaluator: address(3), hook: address(4)};
  const service = new RoverSessions({store, evaluator: address(3), token: address(5), now: () => now,
    fundedJob: async id => {if (id !== "1") throw Error("JOB_NOT_FOUND"); return job;},
    videoPolicy: async () => {videoCalls++; return {version: "test-motion", roi: [0, 0, 1, 1], cameraUrl: "http://camera:81/stream"};}});
  const access = (options = skip): RoverAccess => ({action: "prepare", ...scope, jobId: "1", requestId: randomUUID(), issuedAt: now, options});
  const prepare = async (input = access()) => service.prepare(input, await owner.signMessage({message: roverAccessMessage(input)}));
  return {root, scope, store, job, service, access, prepare, videoCalls: () => videoCalls, advance: (seconds: number) => {now += seconds;}};
}

test("owner-signed SKIP_VIDEO preparation and conditional authorization persist without video service", async t => {
  const f = await fixture(t);
  f.service.deps.videoPolicy = async () => {throw Error("CAMERA_UNAVAILABLE");};
  const prepared = await f.prepare();
  assert.equal(prepared.phase, "PREPARED");
  assert.equal(prepared.context.camera, null);
  assert.match(roverAuthorizationMessage(prepared.context), /VIDEO RECOGNITION IS SKIPPED/);
  const signature = await owner.signMessage({message: roverAuthorizationMessage(prepared.context)});
  const authorized = await f.service.authorize("1", prepared.context.sessionId, signature);
  assert.equal(authorized.phase, "AUTHORIZED");
  const reloaded = await new RoverSessionStore(f.root, f.scope).read("1");
  assert.equal(reloaded?.kind, "rover-session-v1");
  assert.equal(reloaded?.sessions[0].authorizationSignature, signature);
  assert.equal(f.videoCalls(), 0);
  await assert.rejects(f.service.authorize("1", prepared.context.sessionId, signature), /SESSION_AUTHORIZATION_USED/);
  await assert.rejects(f.prepare(), /SESSION_ALREADY_AUTHORIZED/);
});

test("VIDEO preparation binds policy and external fixed camera", async t => {
  const f = await fixture(t);
  const session = await f.prepare(f.access({...skip, judgmentMode: "VIDEO"}));
  assert.equal(f.videoCalls(), 1);
  assert.equal(session.context.camera, "external-fixed");
  assert.match(roverAuthorizationMessage(session.context), /MOVING/);
  const altered = {...session.context, options: {...session.context.options, judgmentMode: "SKIP_VIDEO" as const}};
  await assert.rejects(f.service.authorize("1", session.context.sessionId,
    await owner.signMessage({message: roverAuthorizationMessage(altered)})), /OWNER_SIGNATURE_REQUIRED/);
});

test("another wallet cannot prepare, read or authorize a session", async t => {
  const f = await fixture(t), input = f.access();
  await assert.rejects(f.service.prepare(input, await stranger.signMessage({message: roverAccessMessage(input)})), /OWNER_SIGNATURE_REQUIRED/);
  assert.equal(await f.store.read("1"), null);
  const session = await f.prepare();
  await assert.rejects(f.service.authorize("1", session.context.sessionId,
    await stranger.signMessage({message: roverAuthorizationMessage(session.context)})), /OWNER_SIGNATURE_REQUIRED/);
  const {options: _, ...access} = f.access();
  const read: RoverAccess = {...access, action: "status"};
  await assert.rejects(f.service.status(read, await stranger.signMessage({message: roverAccessMessage(read)})), /OWNER_SIGNATURE_REQUIRED/);
  assert.equal((await f.service.status(read, await owner.signMessage({message: roverAccessMessage(read)})))?.context.sessionId, session.context.sessionId);
});

test("prepare retries are idempotent and changed request nonces are rejected", async t => {
  const f = await fixture(t), input = f.access();
  const first = await f.prepare(input), retry = await f.prepare(input);
  assert.equal(first.context.sessionId, retry.context.sessionId);
  const changed = {...input, options: {...skip, speed: 10}};
  await assert.rejects(f.prepare(changed), /SESSION_REQUEST_CHANGED/);
  assert.equal((await f.store.read("1"))?.sessions.length, 1);
});

test("replaced sessions reject signed authorization and fresh sessions have fresh nonce", async t => {
  const f = await fixture(t), first = await f.prepare(), next = await f.prepare();
  assert.notEqual(first.context.nonce, next.context.nonce);
  const signature = await owner.signMessage({message: roverAuthorizationMessage(first.context)});
  await assert.rejects(f.service.authorize("1", first.context.sessionId, signature), /SESSION_AUTHORIZATION_USED/);
  await assert.rejects(f.service.authorize("1", next.context.sessionId, signature), /OWNER_SIGNATURE_REQUIRED/);
  await assert.rejects(f.service.authorize("2", first.context.sessionId, signature), /SESSION_NOT_FOUND/);
});

test("expired access and conditional authorization cannot be consumed", async t => {
  const f = await fixture(t), input = f.access(), session = await f.prepare(input);
  f.advance(901);
  await assert.rejects(f.prepare(input), /SESSION_ACCESS_EXPIRED_OR_INVALID/);
  await assert.rejects(f.service.authorize("1", session.context.sessionId,
    await owner.signMessage({message: roverAuthorizationMessage(session.context)})), /SESSION_EXPIRED/);
  const {options: _, ...inputRead} = f.access();
  const read: RoverAccess = {...inputRead, action: "status"};
  assert.equal((await f.service.status(read, await owner.signMessage({message: roverAccessMessage(read)})))?.phase, "EXPIRED");
  assert.equal((await f.prepare()).phase, "PREPARED");
});

test("chain, Job and execution condition changes invalidate access or authorization", async t => {
  const f = await fixture(t), input = f.access();
  const signature = await owner.signMessage({message: roverAccessMessage(input)});
  for (const change of [{chainId: 1}, {core: address(99)}, {jobId: "../../.env"}, {options: {...skip, speed: 90}}, {options: {...skip, durationMs: 6000}}]) {
    await assert.rejects(f.service.prepare({...input, ...change}, signature));
  }
  await assert.rejects(f.service.prepare({...input, options: {...skip, speed: 10}}, signature), /OWNER_SIGNATURE_REQUIRED/);
  const session = await f.prepare();
  f.job.budget = 999n;
  await assert.rejects(f.service.authorize("1", session.context.sessionId,
    await owner.signMessage({message: roverAuthorizationMessage(session.context)})), /SESSION_CONTEXT_CHANGED/);
});

test("cross-worker lock prevents concurrent writers and damaged storage never creates a replacement", async t => {
  const f = await fixture(t);
  let release!: () => void, acquired!: () => void;
  const held = new Promise<void>(r => {acquired = r;});
  const task = f.store.update("1", async () => {acquired(); await new Promise<void>(r => {release = r;});});
  await held;
  await assert.rejects(new RoverSessionStore(f.root, f.scope).update("1", async () => {}), /SESSION_BUSY/);
  release(); await task;
  const path = resolve(f.root, `${f.scope.chainId}-${f.scope.core.toLowerCase()}`, "1.json");
  await writeFile(path, "{broken");
  await assert.rejects(f.prepare(), /SESSION_RECORD_INVALID/);
  assert.equal(await readFile(path, "utf8"), "{broken");
});

async function stoppedFixture(t: TestContext) {
  const f = await fixture(t);
  const prepared = await f.prepare(f.access({...skip, judgmentMode: "VIDEO"}));
  const signature = await owner.signMessage({message: roverAuthorizationMessage(prepared.context)});
  const session = await f.service.authorize("1", prepared.context.sessionId, signature);
  const now = session.context.issuedAt;
  const run: RoverRun = {version: 1, request: roverRunRequest(session.context), phase: "CAPTURED", forwardPressed: true,
    commands: [{sessionId: session.context.sessionId, sequence: 1, sentAt: now + 1, x: 0, y: 1, z: 0, speed: 35, deadman: true, result: "SENT"}],
    stop: {requestedAt: now + 3, confirmed: true, confirmedAt: now + 4},
    operationStartedAt: now + 1, operationEndedAt: now + 3, operationHash: "ab".repeat(32),
    recording: {state: "ERROR", frames: [], error: "RECORDING_UNAVAILABLE"}};
  const mutate = async (change: (value: typeof session) => void) => f.store.update("1", async job => {change(job.sessions.at(-1)!);});
  await mutate(value => {value.run = run; value.phase = "CAPTURED";});
  f.advance(5);
  const prepareSkip = () => f.service.prepareSkip("1", session.context.sessionId, signature);
  return {...f, session, signature, mutate, prepareSkip};
}

test("additional skip approval binds the stopped operation and preserves the signed session and recording", async t => {
  const f = await stoppedFixture(t);
  f.service.deps.videoPolicy = async () => {throw Error("ANALYSIS_OFFLINE");};
  const before = (await f.store.read("1"))!.sessions.at(-1)!;
  const prepared = await f.prepareSkip(), context = prepared.skipApproval!.context;
  assert.equal(context.purpose, "SKIP_VIDEO_AFTER_STOP");
  assert.equal(context.budget, before.context.budget);
  assert.equal(context.provider, before.context.provider);
  assert.equal(context.sessionId, before.context.sessionId);
  assert.match(roverSkipAuthorizationMessage(context), /INCONCLUSIVE or STILL/);
  assert.deepEqual((await f.prepareSkip()).skipApproval, prepared.skipApproval);
  const signature = await owner.signMessage({message: roverSkipAuthorizationMessage(context)});
  const approved = await f.service.authorizeSkip("1", context.sessionId, signature);
  const retry = await f.service.authorizeSkip("1", context.sessionId, signature);
  assert.deepEqual(approved, retry);
  assert.deepEqual(approved.context, before.context);
  assert.equal(approved.authorizationSignature, before.authorizationSignature);
  assert.deepEqual(approved.run, before.run);
  assert.equal(approved.phase, before.phase);
  assert.equal(approved.skipApproval!.signature, signature);
  assert.equal((await new RoverSessionStore(f.root, f.scope).read("1"))!.sessions.at(-1)!.skipApproval!.signature, signature);
});

test("skip approval rejects missing or false forward presses, failed commands and unconfirmed stops", async t => {
  const f = await stoppedFixture(t);
  const good = structuredClone((await f.store.read("1"))!.sessions.at(-1)!);
  const cases: Array<[(run: RoverRun) => void, RegExp]> = [
    [run => {delete run.forwardPressed;}, /FORWARD_PRESS_REQUIRED/],
    [run => {run.forwardPressed = false;}, /FORWARD_PRESS_REQUIRED/],
    [run => {run.forwardPressed = null;}, /FORWARD_PRESS_REQUIRED/],
    [run => {run.commands[0].result = "FAILED";}, /DRIVE_NOT_SENT/],
    [run => {run.commands[0].sessionId = randomUUID();}, /DRIVE_NOT_SENT/],
    [run => {run.stop!.confirmed = false;}, /STOP_UNCONFIRMED/],
    [run => {run.stop!.confirmedAt = run.commands[0].sentAt - 1;}, /STOP_UNCONFIRMED/],
    [run => {delete run.operationEndedAt;}, /RUN_NOT_COMPLETED/],
    [run => {run.request.speed = 50;}, /RUN_CONTEXT_MISMATCH/],
  ];
  for (const [change, reason] of cases) {
    await f.mutate(record => {Object.assign(record, structuredClone(good)); change(record.run!);});
    await assert.rejects(f.prepareSkip(), reason);
    assert.equal((await f.store.read("1"))!.sessions.at(-1)!.skipApproval, undefined);
  }
});

test("skip approval permits a recording failure after completed control but rejects interrupted control", async t => {
  const f = await stoppedFixture(t);
  await f.mutate(record => {record.phase = record.run!.phase = "ERROR"; record.error = record.run!.error = "RUN_CANCELLED";});
  await assert.rejects(f.prepareSkip(), /RUN_NOT_COMPLETED/);
  await f.mutate(record => {record.error = record.run!.error = "RECORDING_INCOMPLETE";});
  assert.ok((await f.prepareSkip()).skipApproval);
});

test("additional approval requires its owner signature and cannot be moved to another Job or session", async t => {
  const f = await stoppedFixture(t);
  await assert.rejects(f.service.prepareSkip("1", f.session.context.sessionId,
    await stranger.signMessage({message: roverAuthorizationMessage(f.session.context)})), /OWNER_SIGNATURE_REQUIRED/);
  const prepared = await f.prepareSkip(), context = prepared.skipApproval!.context;
  await assert.rejects(f.service.authorizeSkip("1", context.sessionId,
    await stranger.signMessage({message: roverSkipAuthorizationMessage(context)})), /OWNER_SIGNATURE_REQUIRED/);
  await assert.rejects(f.service.authorizeSkip("1", context.sessionId, f.signature), /OWNER_SIGNATURE_REQUIRED/);
  for (const change of [{budget: "1"}, {provider: address(77)}, {sessionId: randomUUID()}, {chainId: 1}, {jobId: "2"}]) {
    await assert.rejects(f.service.authorizeSkip("1", context.sessionId,
      await owner.signMessage({message: roverSkipAuthorizationMessage({...context, ...change})})), /OWNER_SIGNATURE_REQUIRED/);
  }
  const signature = await owner.signMessage({message: roverSkipAuthorizationMessage(context)});
  await assert.rejects(f.service.authorizeSkip("2", context.sessionId, signature), /SESSION_NOT_FOUND/);
  await assert.rejects(f.service.authorizeSkip("1", randomUUID(), signature), /SESSION_NOT_FOUND/);
});

test("record changes between preparation and signature reject the additional approval", async t => {
  const f = await stoppedFixture(t);
  const prepared = await f.prepareSkip(), context = prepared.skipApproval!.context;
  const signature = await owner.signMessage({message: roverSkipAuthorizationMessage(context)});
  await f.mutate(record => {record.run!.commands[0].speed = 20;});
  await assert.rejects(f.service.authorizeSkip("1", context.sessionId, signature), /SKIP_APPROVAL_CONTEXT_CHANGED/);
  await assert.rejects(f.prepareSkip(), /SKIP_APPROVAL_CONTEXT_CHANGED/);
});

test("expired or no longer funded Jobs reject additional approval", async t => {
  const f = await stoppedFixture(t);
  const prepared = await f.prepareSkip(), context = prepared.skipApproval!.context;
  const signature = await owner.signMessage({message: roverSkipAuthorizationMessage(context)});
  f.job.budget = 1n;
  await assert.rejects(f.service.authorizeSkip("1", context.sessionId, signature), /SESSION_CONTEXT_CHANGED/);
  f.service.deps.fundedJob = async () => {throw Error("JOB_NOT_FUNDED");};
  await assert.rejects(f.service.authorizeSkip("1", context.sessionId, signature), /JOB_NOT_FUNDED/);
  f.advance(900);
  await assert.rejects(f.service.authorizeSkip("1", context.sessionId, signature), /SKIP_APPROVAL_EXPIRED_OR_INVALID/);
});
