import { describe, expect, it, vi } from "vitest";
import { ViemChainReader, type ReadClient } from "../src/chain.js";
import { config, evidence, snapshot } from "./helpers.js";
function client() {
  return { getChainId: vi.fn().mockResolvedValue(31337),
    getBlock: vi.fn().mockResolvedValue({ number: 123n, timestamp: 1700000100n }),
    readContract: vi.fn().mockImplementation(async (p) => p.functionName === "getJob" ? snapshot() : snapshot().evidenceCommitment) };
}
describe("chain reads", () => {
  it("pins every contract read to the block supplying issuedAt", async () => {
    const rpc = client();
    expect(await new ViemChainReader(config, rpc as unknown as ReadClient).getJobSnapshot(evidence.jobId)).toEqual(snapshot());
    expect(rpc.readContract.mock.calls).toHaveLength(2);
    for (const [p] of rpc.readContract.mock.calls) expect(p.blockNumber).toBe(123n);
  });
  it("rejects another chain before reading contracts", async () => {
    const rpc = client(); rpc.getChainId.mockResolvedValue(1);
    await expect(new ViemChainReader(config, rpc as unknown as ReadClient).getJobSnapshot(42n)).rejects.toMatchObject({code: "SERVICE_ERROR", reason: "CHAIN_ID_MISMATCH", retryable: true});
    expect(rpc.readContract).not.toHaveBeenCalled();
  });
  it("sanitizes RPC failures", async () => {
    const rpc = client(); rpc.readContract.mockRejectedValue(Error("secret RPC credential"));
    await expect(new ViemChainReader(config, rpc as unknown as ReadClient).getJobSnapshot(42n)).rejects.toMatchObject({code: "SERVICE_ERROR", reason: "CHAIN_READ_FAILED"});
  });
});
