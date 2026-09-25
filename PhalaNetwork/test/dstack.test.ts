import { describe, expect, it, vi } from "vitest";
import { recoverTypedDataAddress, hexToBytes } from "viem";
import { createHash } from "node:crypto";
import { claimsDigest } from "../src/attestation.js";
import { createDstackSecurityProvider, type DstackApi } from "../src/dstack-security.js";
import { verdictTypes } from "../src/contracts.js";
import { verdictDomain } from "../src/security.js";
import { config, LOCAL_PRIVATE_KEY } from "./helpers.js";
const {verdictSigningKey: _key, ...withoutKey} = config;
const teeConfig = {...withoutKey,verifierMode:"PHALA_DSTACK" as const,dstackSimulatorEndpoint:"http://127.0.0.1:8091"};
function api() {
  return {
    getKey:vi.fn().mockResolvedValue({__name__:"GetKeyResponse",key:hexToBytes(LOCAL_PRIVATE_KEY),signature_chain:[]}),
    info:vi.fn().mockResolvedValue({app_id:"aa",instance_id:"bb",compose_hash:createHash("sha256").update("{}").digest("hex"),tcb_info:{app_compose:"{}"}}),
    getQuote:vi.fn().mockResolvedValue({quote:"abcd",event_log:"[]",replayRtmrs:()=>[]}),
    attest:vi.fn().mockRejectedValue(Error("unsupported guest agent")),
  };
}
describe("dstack provider", () => {
  it("derives stable secp256k1 signer and binds nonce and configuration", async () => {
    const client = api(); const first = await createDstackSecurityProvider(teeConfig,client as unknown as DstackApi);
    const second = await createDstackSecurityProvider(teeConfig,client as unknown as DstackApi);
    expect(first.address).toBe(second.address);
    expect(client.getKey).toHaveBeenCalledWith(config.dstackKeyPath,"verifiable-blackbox-verdict","secp256k1");
    const a = await first.getAttestation("first"); const b = await first.getAttestation("second");
    expect(a).toMatchObject({attested:false,simulated:true,keySource:"DSTACK_KMS"});
    expect(a.reportData).toBe(claimsDigest(a.claims!)); expect(a.reportData).not.toBe(b.reportData);
    expect(client.getQuote).toHaveBeenCalledWith(hexToBytes(a.reportData!));
    const verdict = {jobId:1n,provider:config.erc8183Address,evidenceCommitment:`0x${"ab".repeat(32)}` as const,outcome:1 as const,issuedAt:1n,validUntil:2n,nonce:`0x${"cd".repeat(32)}` as const};
    const signature = await first.signVerdict(verdict);
    expect(await recoverTypedDataAddress({domain:verdictDomain(config),types:verdictTypes,primaryType:"DemoVerdictV1",message:verdict,signature})).toBe(first.address);
  });
  it("fails initialization without falling back to the development key", async () => {
    const client = api(); client.getKey.mockRejectedValue(Error("kms secret endpoint"));
    await expect(createDstackSecurityProvider(teeConfig,client as unknown as DstackApi)).rejects.toMatchObject({code:"SERVICE_ERROR",reason:"DSTACK_INITIALIZATION_FAILED"});
  });
  it("returns 503 on mandatory quote failure", async () => {
    const client = api(); const provider = await createDstackSecurityProvider(teeConfig,client as unknown as DstackApi);
    client.getQuote.mockRejectedValue(Error("quote failed"));
    await expect(provider.getAttestation("fresh")).rejects.toMatchObject({status:503,reason:"ATTESTATION_UNAVAILABLE"});
  });
});
