import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
export const env = {
  RPC_URL: "http://127.0.0.1:8545", CHAIN_ID: "31337",
  ERC8183_ADDRESS: "0x0000000000000000000000000000000000000001",
  EVIDENCE_HOOK_ADDRESS: "0x0000000000000000000000000000000000000002",
  EVALUATOR_ADDRESS: "0x0000000000000000000000000000000000000003",
  VERDICT_SIGNING_KEY: `0x${"0".repeat(63)}1`,
};
describe("configuration", () => {
  it("defaults to local loopback and accepts uint256 sequence", () => {
    const c = loadConfig({ ...env, EXPECTED_SEQUENCE: (2n ** 256n - 1n).toString() });
    expect(c.host).toBe("127.0.0.1"); expect(c.expectedSequence).toBe(2n ** 256n - 1n);
  });
  it.each(["901", "0", "-1", "1.5", "9007199254740992"])("rejects TTL %s", (v) => {
    expect(() => loadConfig({ ...env, VERDICT_TTL_SECONDS: v })).toThrow("VERDICT_TTL_SECONDS");
  });
  it("reports names only", () => {
    expect(() => loadConfig({ ...env, RPC_URL: "secret-value", VERDICT_SIGNING_KEY: "secret-key" }))
      .toThrow(/^Invalid configuration: RPC_URL, VERDICT_SIGNING_KEY$/);
  });
  it("requires valid scalar development key and rejects it in TEE mode", () => {
    expect(() => loadConfig({ ...env, VERDICT_SIGNING_KEY: undefined })).toThrow("VERDICT_SIGNING_KEY");
    expect(() => loadConfig({ ...env, VERDICT_SIGNING_KEY: `0x${"0".repeat(64)}` })).toThrow("VERDICT_SIGNING_KEY");
    expect(() => loadConfig({ ...env, VERIFIER_MODE: "PHALA_DSTACK" })).toThrow("VERDICT_SIGNING_KEY");
  });
});
