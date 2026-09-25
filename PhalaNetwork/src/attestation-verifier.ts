import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { z } from "zod";
import { claimsDigest } from "./attestation.js";

export const QUOTE_VERIFIER_URL = "https://cloud-api.phala.com/api/v1/attestations/verify";
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/);
const measurement = z.string().regex(/^(?:0x)?[0-9a-fA-F]{96}$/);
const nonceSchema = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/);
const measurementsSchema = z.object({mrtd:measurement,rtmr0:measurement,rtmr1:measurement,rtmr2:measurement}).strict();
export const expectationsSchema = z.object({
  signerAddress:address,chainId:z.number().int().positive().safe(),evaluatorAddress:address,composeHash:hash,
  measurements:measurementsSchema.optional(),
}).strict();
export type AttestationExpectations = z.infer<typeof expectationsSchema>;
const reportSchema = z.object({
  ok:z.literal(true),mode:z.literal("PHALA_DSTACK"),keySource:z.literal("DSTACK_KMS"),
  signerAddress:address,attested:z.boolean(),simulated:z.boolean(),reportData:hash,
  quote:z.string().regex(/^(?:0x)?(?:[a-fA-F0-9]{2})+$/).max(1048576),appCompose:z.string().max(262144),
  claims:z.object({schema:z.literal("VBB_ATTESTATION_V1"),signerAddress:address,chainId:z.number().int().positive().safe(),
    evaluatorAddress:address,evidencePolicy:z.literal("DEMO_EVIDENCE_V1"),composeHash:hash,
    appId:z.string().min(1).max(128),instanceId:z.string().min(1).max(128),nonce:nonceSchema}).strict(),
});
const hex = (v: string) => v.replace(/^0x/, "").toLowerCase();
function requireMatch(condition: boolean, reason: string): asserts condition { if (!condition) throw Error(reason); }
export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw Error("HTTP_RESPONSE_FAILED");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      length += value.length; if (length > 2_097_152) throw Error("RESPONSE_TOO_LARGE"); chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
  } finally {await reader.cancel();}
}
export async function verifyHardwareQuote(quote: string): Promise<unknown> {
  try {
    return await boundedJson(await fetch(QUOTE_VERIFIER_URL,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({hex:quote}),signal:AbortSignal.timeout(30000),redirect:"error"}));
  } catch {throw Error("QUOTE_VERIFIER_UNAVAILABLE");}
}
export async function verifyAttestation(input: unknown, expectedInput: AttestationExpectations, nonce: string,
  options: {allowSimulator?:boolean; verifyQuote?:(quote:string)=>Promise<unknown>} = {}) {
  const parsed = reportSchema.safeParse(input); const expected = expectationsSchema.safeParse(expectedInput);
  requireMatch(parsed.success,"ATTESTATION_SCHEMA_INVALID"); requireMatch(expected.success,"EXPECTATIONS_INVALID");
  requireMatch(nonceSchema.safeParse(nonce).success,"NONCE_REQUIRED");
  const r = parsed.data; const e = expected.data; const c = r.claims;
  requireMatch(c.nonce === nonce,"NONCE_MISMATCH");
  requireMatch(getAddress(c.signerAddress) === getAddress(e.signerAddress) && getAddress(r.signerAddress) === getAddress(e.signerAddress),"SIGNER_MISMATCH");
  requireMatch(c.chainId === e.chainId,"CHAIN_MISMATCH");
  requireMatch(getAddress(c.evaluatorAddress) === getAddress(e.evaluatorAddress),"EVALUATOR_MISMATCH");
  requireMatch(hex(r.reportData) === hex(claimsDigest(c)),"CLAIMS_DIGEST_MISMATCH");
  const composeHash = createHash("sha256").update(r.appCompose).digest("hex");
  requireMatch(composeHash === hex(c.composeHash) && composeHash === hex(e.composeHash),"COMPOSE_MISMATCH");
  if (r.simulated) {
    requireMatch(options.allowSimulator === true && r.attested === false,"SIMULATOR_NOT_ALLOWED");
    return {ok:true,simulated:true,claimsBound:true,hardwareQuoteVerified:false,composeMeasurementVerified:false,signerAddress:e.signerAddress,composeHash};
  }
  requireMatch(r.attested === true,"ATTESTATION_REQUIRED");
  requireMatch(e.measurements !== undefined,"EXPECTED_MEASUREMENTS_REQUIRED");
  const verified = await (options.verifyQuote ?? verifyHardwareQuote)(r.quote);
  const result = z.object({quote:z.object({verified:z.literal(true),body:z.object({
    reportdata:z.string().regex(/^(?:0x)?[a-fA-F0-9]{128}$/),mr_config_id:measurement,
    mrtd:measurement,rtmr0:measurement,rtmr1:measurement,rtmr2:measurement,
  })})}).safeParse(verified);
  requireMatch(result.success,"HARDWARE_QUOTE_INVALID");
  const body = result.data.quote.body;
  requireMatch(hex(body.reportdata) === hex(r.reportData) + "00".repeat(32),"QUOTE_REPORT_DATA_MISMATCH");
  // dstack config-id v1: version byte 01, SHA256(app-compose), fifteen zero bytes.
  requireMatch(hex(body.mr_config_id) === "01" + composeHash + "00".repeat(15),"QUOTE_COMPOSE_MISMATCH");
  for (const key of ["mrtd","rtmr0","rtmr1","rtmr2"] as const)
    requireMatch(hex(body[key]) === hex(e.measurements[key]),"QUOTE_MEASUREMENT_MISMATCH");
  return {ok:true,simulated:false,claimsBound:true,hardwareQuoteVerified:true,composeMeasurementVerified:true,
    osMeasurementsVerified:true,signerAddress:e.signerAddress,composeHash,quoteVerifier:QUOTE_VERIFIER_URL};
}
