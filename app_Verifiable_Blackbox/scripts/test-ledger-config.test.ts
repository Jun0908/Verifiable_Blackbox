import test from "node:test";
import assert from "node:assert/strict";
import {settings, contracts, selection} from "../apps/web/lib/server/curvegrid/config.ts";
import {jobKey, validateSelection, withinCutoff} from "../apps/web/lib/ledger/types.ts";
import {eventKey} from "../apps/web/lib/ledger/payment-ledger.ts";

test("one selected Job and three transactions; September 26 included in JST", () => {
  assert.equal(selection.jobs.length, 1);
  assert.equal(validateSelection(contracts, selection).length, 3);
  assert.ok(withinCutoff("2026-09-26T14:59:59Z", selection));
  assert.equal(withinCutoff("2026-09-26T15:00:00Z", selection), false);
  assert.equal(withinCutoff("invalid", selection), false);
});
test("chain/core identifiers and transaction limits", () => {
  assert.notEqual(jobKey(1, contracts.core, "1"), jobKey(11155111, contracts.core, "1"));
  const e = {txHash:"0x123", logIndex:1} as Parameters<typeof eventKey>[0];
  assert.notEqual(eventKey(e, 1), eventKey(e, 11155111));
  assert.throws(() => validateSelection(contracts, {...selection, jobs:[...selection.jobs, ...selection.jobs]}));
  assert.throws(() => validateSelection(contracts, {...selection, chainId:1}));
  assert.deepEqual(validateSelection(contracts, {...selection, jobs:[]}), []);
});
test("server configuration excludes credentials from fingerprint", () => {
  const env = {MULTIBAAS_URL:"https://test.multibaas.com", MULTIBAAS_API_KEY:"secret"};
  const config = settings(env);
  assert.equal(config.baseUrl,"https://test.multibaas.com/api/v0");
  assert.equal(config.confirmations,12);
  assert.equal(config.fingerprint,settings({...env,MULTIBAAS_API_KEY:"rotated"}).fingerprint);
  assert.notEqual(config.fingerprint,settings({...env,MULTIBAAS_URL:"https://second.multibaas.com"}).fingerprint);
  assert.equal(settings({}).configured,false);
  assert.throws(() => settings({...env,MULTIBAAS_URL:"https://secret@test.multibaas.com"}));
  assert.throws(() => settings({...env,MULTIBAAS_URL:"https://test.multibaas.com.multibaas.com"}));
  assert.throws(() => settings({...env,LEDGER_CONFIRMATIONS:"0"}));
});
