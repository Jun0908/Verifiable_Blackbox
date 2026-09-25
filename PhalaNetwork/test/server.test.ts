import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evidenceToWire } from "../src/evidence.js";
import { serviceError } from "../src/errors.js";
import { createSecurityProvider } from "../src/security.js";
import { createServer } from "../src/server.js";
import { VerifierService } from "../src/verify.js";
import { config, evidence, snapshot } from "./helpers.js";
describe("HTTP API", () => {
  let server: ReturnType<typeof createServer>; let url: string;
  const chain = {getJobSnapshot: vi.fn()}; const log = vi.fn();
  beforeEach(async () => {
    chain.getJobSnapshot.mockReset().mockResolvedValue(snapshot()); log.mockClear();
    const s = await createSecurityProvider(config);
    server = createServer(config, new VerifierService(config, chain, s), s, log);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r()));});
  const post = (url: string, body: unknown) => fetch(`${url}/verify`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
  it("serves health, local attestation and Verdict without caching", async () => {
    const health = await fetch(`${url}/health`); expect(health.headers.get("cache-control")).toBe("no-store");
    expect((await health.json()).verifier).toMatchObject({mode: "LOCAL_DEV", attested: false, simulated: false});
    const att = await (await fetch(`${url}/attestation?nonce=fresh`)).json(); expect(att.attested).toBe(false); expect(att.quote).toBeUndefined();
    const r = await post(url, {evidence: evidenceToWire(evidence)}); expect(r.status).toBe(200); expect((await r.json()).signature).toMatch(/^0x[0-9a-f]{130}$/);
  });
  it.each(["", "bad%20nonce", "x".repeat(129), "a&nonce=b"])("rejects nonce %s", async (nonce) => expect((await fetch(`${url}/attestation?nonce=${nonce}`)).status).toBe(400));
  it.each([{}, {evidence: {}}, {evidence: evidenceToWire(evidence), extra: true}])("rejects malformed envelope %j", async (body) => expect((await post(url, body)).status).toBe(400));
  it("separates Policy failures from RPC outages without signatures", async () => {
    for (const [status, code] of [[422, "INVALID_EVIDENCE"], [503, "SERVICE_ERROR"]] as const) {
      if (status === 503) chain.getJobSnapshot.mockRejectedValue(serviceError("CHAIN_READ_FAILED"));
      const r = await post(url, {evidence: {...evidenceToWire(evidence), robotId: "wrong"}});
      const body = await r.json(); expect(r.status).toBe(status); expect(body.error.code).toBe(code);
      expect(body.error.retryable).toBe(status === 503); expect(body.signature).toBeUndefined(); expect(body.verdict).toBeUndefined();
      expect(body.requestId).toBe(r.headers.get("x-request-id"));
    }
  });
  it("rejects JSON, media type, declared and chunked byte overflows", async () => {
    expect((await fetch(`${url}/verify`, {method: "POST", headers:{"content-type":"application/json"}, body:"{"})).status).toBe(400);
    expect((await fetch(`${url}/verify`, {method: "POST", headers:{"content-type":"application/json-evil"}, body:"{}"})).status).toBe(400);
    expect((await post(url, {value:"あ".repeat(6000)})).status).toBe(400);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/verify`, {method:"POST", headers:{"content-type":"application/json", "transfer-encoding":"chunked"}}, res => {res.resume(); res.on("end",()=>resolve(res.statusCode));});
      req.on("error",reject); req.write("a".repeat(10000)); req.end("b".repeat(10000));
    });
    expect(status).toBe(400);
  });
  it("returns 404 and excludes unknown paths and query values from logs", async () => {
    expect((await fetch(`${url}/secret-token?nonce=secret-value`)).status).toBe(404);
    expect((await fetch(`${url}/verify`)).status).toBe(404);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});
