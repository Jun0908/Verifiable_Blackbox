import test from "node:test";
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {analyzeRecordedSession} from "../apps/web/lib/server/rover-session/analysis.ts";
import {roverHash, type RoverSessionRecord} from "../apps/web/lib/rover-session.ts";

const root = resolve(import.meta.dirname, "..");
process.chdir(resolve(root, "apps/web"));
const raw = Buffer.from("raw-recording-test");
const hash = createHash("sha256").update(raw).digest("hex");
const policy = JSON.parse(readFileSync(resolve(root, "services/stegavar/config/rover_motion.json"), "utf8"));
function record(): RoverSessionRecord {
  return {context: {version: 1, chainId: 31337, core: `0x${"1".repeat(40)}`, jobId: "1", sessionId: randomUUID(),
    options: {judgmentMode: "VIDEO"}, cameraUrl: "http://camera/stream", policyHash: roverHash({cameraUrl: "http://camera/stream", motion: policy})},
    phase: "CAPTURED", run: {recording: {sha256: hash}}} as RoverSessionRecord;
}
test("uploads Raw bytes with binding metadata and accepts only matching three-way results", async t => {
  const item = record();
  let sent = false;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    if (init.method !== "POST") return new Response(raw);
    const body = JSON.parse(init.body as string);
    assert.equal(Buffer.from(body.rawBase64, "base64").toString(), raw.toString());
    assert.equal(body.forwardPressed, undefined);
    sent = true;
    return Response.json({...body, judgment: "MOVING", execution: "ANALYZED", reason: null,
      executionId: randomUUID(), analyzedAt: new Date().toISOString(), frameCount: 12});
  });
  assert.equal((await analyzeRecordedSession(item)).judgment, "MOVING");
  assert.ok(sent);
});
test("another session result is inconclusive and never accepted as movement", async t => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => init.method !== "POST" ? new Response(raw)
    : Response.json({...JSON.parse(init.body as string), sessionId: randomUUID(), judgment: "MOVING"}));
  const result = await analyzeRecordedSession(record());
  assert.equal(result.judgment, "INCONCLUSIVE");
  assert.equal(result.reason, "ANALYSIS_CONTEXT_MISMATCH");
});
test("corrupted Raw recording and unavailable service cannot produce a successful judgment", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("corrupted"));
  assert.equal((await analyzeRecordedSession(record())).reason, "RECORDING_HASH_MISMATCH");
  mock.mock.mockImplementation(async () => {throw Error("offline");});
  const result = await analyzeRecordedSession(record());
  assert.equal(result.execution, "UNAVAILABLE");
  assert.equal(result.judgment, "INCONCLUSIVE");
});
test("skip mode runs without video services and preserves an existing result", async t => {
  t.mock.method(globalThis, "fetch", async () => {throw Error("must not call");});
  const item = record(); item.context.options.judgmentMode = "SKIP_VIDEO";
  const result = await analyzeRecordedSession(item);
  assert.equal(result.execution, "SKIPPED");
  assert.equal(result.judgment, "INCONCLUSIVE");
  item.analysis = {...result, execution: "ANALYZED", judgment: "STILL", reason: null};
  assert.deepEqual(await analyzeRecordedSession(item), item.analysis);
});
