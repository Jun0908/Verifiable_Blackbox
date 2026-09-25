import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evidenceCommitment, evidenceToWire, parseEvidence } from "../src/evidence.js";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/demo-evidence-v1.json", import.meta.url), "utf8"));
export const commitment = "0xd6d4bcf5e475d8245babcb9f5b6f37d8066c591476ae8acffd77ac0f5850248d";
describe("Evidence V1", () => {
  it("matches the app/Solidity vector and roundtrips decimal strings", () => {
    const parsed = parseEvidence(fixture);
    expect(evidenceCommitment(parsed)).toBe(commitment);
    expect(evidenceToWire(parsed)).toEqual(fixture);
  });
  it.each([
    { jobId: "0" }, { jobId: "01" }, { jobId: "-1" }, { jobId: (2n ** 256n).toString() },
    { sequence: -1 }, { sequence: 1.5 }, { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { sequence: (2n ** 256n).toString() }, { capturedAt: (2n ** 64n).toString() },
    { imageHash: "0xab" }, { scenario: "unknown" }, { unknown: true },
    { robotId: "" }, { robotId: "x".repeat(129) }, { challenge: "x".repeat(257) },
    { checkpoint: "" }, { jobId: undefined }, { sequence: true },
  ])("rejects invalid input %j", (patch) => expect(() => parseEvidence({ ...fixture, ...patch })).toThrow());
  it("accepts exact maximum integers and safe numeric input", () => {
    expect(parseEvidence({ ...fixture, sequence: (2n ** 256n - 1n).toString(), capturedAt: (2n ** 64n - 1n).toString() }).sequence).toBe(2n ** 256n - 1n);
    expect(evidenceToWire(parseEvidence({ ...fixture, jobId: 1, sequence: 1, capturedAt: 1800000000 }))).toEqual(fixture);
  });
  it.each([
    { jobId: "2" }, { robotId: "other" }, { challenge: "other" }, { capturedAt: "1800000001" },
    { imageHash: `0x${"ab".repeat(32)}` }, { checkpoint: "other" }, { sequence: "2" },
  ])("commits every encoded field %j", (patch) => expect(evidenceCommitment(parseEvidence({ ...fixture, ...patch }))).not.toBe(commitment));
  it("scenario is carried by challenge rather than encoded separately", () => {
    expect(evidenceCommitment(parseEvidence({ ...fixture, scenario: "tampered" }))).toBe(commitment);
  });
});
