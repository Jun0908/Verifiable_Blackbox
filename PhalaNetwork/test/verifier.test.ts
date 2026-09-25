import { describe, expect, it, vi } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { verdictTypes } from "../src/contracts.js";
import { evidenceToWire } from "../src/evidence.js";
import { serviceError } from "../src/errors.js";
import { createSecurityProvider, verdictDomain } from "../src/security.js";
import { VerifierService } from "../src/verify.js";
import { config, evidence, snapshot } from "./helpers.js";
describe("Verdict signing", () => {
  it("recovers signer and binds provider, chain, evaluator and commitment", async () => {
    const security = await createSecurityProvider(config);
    const service = new VerifierService(config, {getJobSnapshot: async () => snapshot()}, security);
    const result = await service.verify(evidenceToWire(evidence));
    const message = {...result.verdict, jobId: BigInt(result.verdict.jobId), issuedAt: BigInt(result.verdict.issuedAt), validUntil: BigInt(result.verdict.validUntil)};
    const data = {domain: verdictDomain(config), types: verdictTypes, primaryType: "DemoVerdictV1" as const, message, signature: result.signature};
    expect(await recoverTypedDataAddress(data)).toBe(security.address);
    expect(await recoverTypedDataAddress({...data, domain: {...data.domain, chainId: 1}})).not.toBe(security.address);
    expect(await recoverTypedDataAddress({...data, domain: {...data.domain, verifyingContract: config.erc8183Address}})).not.toBe(security.address);
    expect(result.verdict.provider).toBe(snapshot().provider);
    expect(result.verdict.evidenceCommitment).toBe(snapshot().evidenceCommitment);
    expect(result.verdict.issuedAt).toBe("1700000100"); expect(result.verdict.validUntil).toBe("1700000400");
    expect(result.verifier).toMatchObject({mode: "LOCAL_DEV", attested: false, simulated: false, attestationPath: null});
    expect((await service.verify(evidenceToWire(evidence))).verdict.nonce).not.toBe(result.verdict.nonce);
  });
  it("caps validity below the Job deadline", async () => {
    const s = await createSecurityProvider(config);
    const r = await new VerifierService(config, {getJobSnapshot: async () => snapshot({expiredAt: 1700000110n})}, s).verify(evidenceToWire(evidence));
    expect(r.verdict.validUntil).toBe("1700000109");
  });
  it.each(["invalid", "rpc", "window", "ttl"])("does not sign on %s failure", async (kind) => {
    const s = await createSecurityProvider(config); const sign = vi.spyOn(s, "signVerdict");
    const chain = {getJobSnapshot: async () => {
      if(kind === "rpc") throw serviceError("CHAIN_READ_FAILED");
      return snapshot(kind === "window" ? {expiredAt: 1700000101n} : {});
    }};
    const svc = new VerifierService(kind === "ttl" ? {...config, verdictTtlSeconds: 901n} : config, chain, s);
    await expect(svc.verify({...evidenceToWire(evidence), ...(kind === "invalid" ? {robotId: "other"} : {})})).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
});
