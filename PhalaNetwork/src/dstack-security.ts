import { DstackClient } from "@phala/dstack-sdk";
import { toViemAccountSecure } from "@phala/dstack-sdk/viem";
import { hexToBytes, type LocalAccount, type Hex } from "viem";
import { claimsDigest } from "./attestation.js";
import type { Config } from "./config.js";
import { verdictTypes } from "./contracts.js";
import { invalidRequest, serviceError } from "./errors.js";
import { verdictDomain, type AttestationResponse, type SecurityProvider } from "./security.js";
import type { DemoVerdictV1 } from "./types.js";
export type DstackApi = Pick<DstackClient, "getKey" | "info" | "getQuote" | "attest">;
export class DstackSecurityProvider implements SecurityProvider {
  readonly mode = "PHALA_DSTACK";
  readonly attestationAvailable = true;
  readonly keySource = "DSTACK_KMS";
  readonly address;
  readonly simulated;
  readonly attested;
  constructor(private readonly config: Config, private readonly account: LocalAccount,
    private readonly client: DstackApi, private readonly info: Record<string, unknown>) {
    this.address = account.address; this.simulated = Boolean(config.dstackSimulatorEndpoint); this.attested = !this.simulated;
  }
  async signVerdict(verdict: DemoVerdictV1): Promise<Hex> {
    try {return await this.account.signTypedData({domain:verdictDomain(this.config),types:verdictTypes,primaryType:"DemoVerdictV1",message:verdict});}
    catch {throw serviceError("SIGNING_FAILED");}
  }
  async getAttestation(nonce?: string): Promise<AttestationResponse> {
    if (nonce !== undefined && !/^[A-Za-z0-9._~-]{1,128}$/.test(nonce)) throw invalidRequest("ATTESTATION_NONCE_INVALID");
    const claims = {schema:"VBB_ATTESTATION_V1",signerAddress:this.address,chainId:this.config.chainId,
      evaluatorAddress:this.config.evaluatorAddress,evidencePolicy:"DEMO_EVIDENCE_V1",composeHash:this.info.compose_hash,
      appId:this.info.app_id,instanceId:this.info.instance_id,nonce:nonce ?? null};
    const reportData = claimsDigest(claims);
    try {
      const [quote, versioned] = await Promise.all([
        this.client.getQuote(hexToBytes(reportData)),
        this.client.attest(hexToBytes(reportData)).catch(() => undefined),
      ]);
      if (!/^(?:0x)?(?:[a-fA-F0-9]{2})+$/.test(quote.quote)) throw Error("Invalid quote");
      let eventLog: unknown = quote.event_log;
      try {eventLog = JSON.parse(quote.event_log);} catch { /* Raw log for older agents. */ }
      const tcb = this.info.tcb_info as Record<string, unknown>;
      return {mode:this.mode,attested:this.attested,simulated:this.simulated,signerAddress:this.address,keySource:this.keySource,
        claims,reportData,quote:quote.quote,eventLog,replayedRtmrs:quote.replayRtmrs(),
        measurements:{mrtd:tcb.mrtd,rtmr0:tcb.rtmr0,rtmr1:tcb.rtmr1,rtmr2:tcb.rtmr2,rtmr3:tcb.rtmr3,composeHash:this.info.compose_hash},
        appCompose:tcb.app_compose as string,...(versioned ? {attestation:versioned.attestation} : {})};
    } catch {throw serviceError("ATTESTATION_UNAVAILABLE");}
  }
}
export async function createDstackSecurityProvider(config: Config, injectedClient?: DstackApi): Promise<SecurityProvider> {
  // An explicit socket prevents SDK environment auto-discovery from selecting a simulator in cloud mode.
  try {
    const client = injectedClient ?? new DstackClient(config.dstackSimulatorEndpoint ?? "/var/run/dstack.sock");
    const [key, raw] = await Promise.all([
      client.getKey(config.dstackKeyPath,"verifiable-blackbox-verdict","secp256k1"), client.info(),
    ]);
    const info = {...raw} as unknown as Record<string, unknown>;
    if (typeof info.tcb_info === "string") info.tcb_info = JSON.parse(info.tcb_info);
    const tcb = info.tcb_info as Record<string, unknown> | undefined;
    if (!info.app_id || !info.instance_id || !info.compose_hash || typeof tcb?.app_compose !== "string") throw Error("Missing identity");
    return new DstackSecurityProvider(config,toViemAccountSecure(key),client,info);
  } catch {throw serviceError("DSTACK_INITIALIZATION_FAILED");}
}
