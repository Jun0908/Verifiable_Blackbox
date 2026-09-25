import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { claimsDigest } from "../src/attestation.js";
import { verifyAttestation, verifyHardwareQuote } from "../src/attestation-verifier.js";
import { config } from "./helpers.js";
function fixture() {
  const compose = '{"docker_compose_file":"image@sha256:pinned"}';
  const hash = createHash("sha256").update(compose).digest("hex");
  const measurements = {mrtd:"11".repeat(48),rtmr0:"22".repeat(48),rtmr1:"33".repeat(48),rtmr2:"44".repeat(48)};
  const expected = {signerAddress:config.erc8183Address,chainId:31337,evaluatorAddress:config.evaluatorAddress,composeHash:hash,measurements};
  const claims = {schema:"VBB_ATTESTATION_V1",signerAddress:expected.signerAddress,chainId:31337,evaluatorAddress:expected.evaluatorAddress,
    evidencePolicy:"DEMO_EVIDENCE_V1",composeHash:hash,appId:"aa",instanceId:"bb",nonce:"fresh"};
  const report = {ok:true,mode:"PHALA_DSTACK",keySource:"DSTACK_KMS",signerAddress:expected.signerAddress,attested:true,simulated:false,
    claims,reportData:claimsDigest(claims),quote:"abcd",appCompose:compose};
  const verified = {quote:{verified:true,body:{reportdata:report.reportData+"00".repeat(32),mr_config_id:"01"+hash+"00".repeat(15),...measurements}}};
  return {expected,report,verified};
}
describe("independent attestation verifier", () => {
  it("accepts a verified quote only with trusted claims, compose and OS measurements", async () => {
    const f = fixture(); const verifyQuote = vi.fn().mockResolvedValue(f.verified);
    expect(await verifyAttestation(f.report,f.expected,"fresh",{verifyQuote})).toMatchObject({hardwareQuoteVerified:true,composeMeasurementVerified:true,osMeasurementsVerified:true});
    expect(verifyQuote).toHaveBeenCalledWith(f.report.quote);
  });
  it.each(["nonce","signer","chain","evaluator","policy","digest","compose","composeContent","quote","reportdata","suffix","configId","configSuffix","measurement","missingMeasurement"])("rejects %s mismatch", async kind => {
    const f = fixture();
    switch(kind) {
      case "nonce":f.report.claims.nonce="old";break;
      case "signer":f.report.claims.signerAddress=config.evaluatorAddress;break;
      case "chain":f.report.claims.chainId=1;break;
      case "evaluator":f.report.claims.evaluatorAddress=config.erc8183Address;break;
      case "policy":f.report.claims.evidencePolicy="other";break;
      case "digest":f.report.claims.appId="modified";break;
      case "compose":f.expected.composeHash="ab".repeat(32);break;
      case "composeContent":f.report.appCompose="{}";break;
      case "quote":f.verified.quote.verified=false;break;
      case "reportdata":f.verified.quote.body.reportdata="ab".repeat(64);break;
      case "suffix":f.verified.quote.body.reportdata=f.report.reportData+"01".repeat(32);break;
      case "configId":f.verified.quote.body.mr_config_id="ab".repeat(48);break;
      case "configSuffix":f.verified.quote.body.mr_config_id="01"+f.expected.composeHash+"01".repeat(15);break;
      case "measurement":f.verified.quote.body.mrtd="ab".repeat(48);break;
      case "missingMeasurement":delete (f.expected as Partial<typeof f.expected>).measurements;break;
    }
    await expect(verifyAttestation(f.report,f.expected,"fresh",{verifyQuote:async()=>f.verified})).rejects.toThrow();
  });
  it("fails on verifier outages", async () => {
    const f = fixture(); await expect(verifyAttestation(f.report,f.expected,"fresh",{verifyQuote:async()=>{throw Error("offline");}})).rejects.toThrow("offline");
  });
  it("never treats simulator output as hardware proof", async () => {
    const f = fixture(); f.report.simulated=true; f.report.attested=false; const verifyQuote=vi.fn();
    await expect(verifyAttestation(f.report,f.expected,"fresh",{verifyQuote})).rejects.toThrow("SIMULATOR_NOT_ALLOWED");
    expect(await verifyAttestation(f.report,f.expected,"fresh",{verifyQuote,allowSimulator:true})).toMatchObject({simulated:true,hardwareQuoteVerified:false,composeMeasurementVerified:false});
    expect(verifyQuote).not.toHaveBeenCalled();
  });
  it("requires exact reportData length", async () => {
    const f = fixture(); f.verified.quote.body.reportdata=f.report.reportData;
    await expect(verifyAttestation(f.report,f.expected,"fresh",{verifyQuote:async()=>f.verified})).rejects.toThrow("HARDWARE_QUOTE_INVALID");
  });
  it("sanitizes remote verifier errors", async () => {
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(Error("secret response")));
    try {await expect(verifyHardwareQuote("abcd")).rejects.toThrow("QUOTE_VERIFIER_UNAVAILABLE");}
    finally {vi.unstubAllGlobals();}
  });
});
