import type { Address, Hex, LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { verdictTypes } from "./contracts.js";
import { serviceError } from "./errors.js";
import type { DemoVerdictV1, VerifierMode } from "./types.js";

export type AttestationResponse = {
  mode: VerifierMode; attested: boolean; simulated: boolean; signerAddress: Address;
  keySource: "ENVIRONMENT" | "DSTACK_KMS";
  claims?: Record<string, unknown>; reportData?: Hex; quote?: string; eventLog?: unknown;
  replayedRtmrs?: string[]; measurements?: Record<string, unknown>; appCompose?: string; attestation?: unknown;
};
export interface SecurityProvider {
  readonly mode: VerifierMode;
  readonly attested: boolean;
  readonly simulated: boolean;
  readonly attestationAvailable: boolean;
  readonly address: Address;
  readonly keySource: "ENVIRONMENT" | "DSTACK_KMS";
  signVerdict(verdict: DemoVerdictV1): Promise<Hex>;
  getAttestation(nonce?: string): Promise<AttestationResponse>;
}
export function verdictDomain(config: Config) {
  return { name: "VerifiableBlackboxDemo", version: "1", chainId: config.chainId, verifyingContract: config.evaluatorAddress } as const;
}
export class LocalSecurityProvider implements SecurityProvider {
  readonly mode = "LOCAL_DEV";
  readonly attested = false;
  readonly simulated = false;
  readonly attestationAvailable = false;
  readonly keySource = "ENVIRONMENT";
  readonly address: Address;
  private readonly account: LocalAccount;
  constructor(private readonly config: Config) {
    if (!config.verdictSigningKey) throw Error("Invalid configuration: VERDICT_SIGNING_KEY");
    this.account = privateKeyToAccount(config.verdictSigningKey);
    this.address = this.account.address;
  }
  async signVerdict(verdict: DemoVerdictV1): Promise<Hex> {
    try { return await this.account.signTypedData({ domain: verdictDomain(this.config), types: verdictTypes, primaryType: "DemoVerdictV1", message: verdict }); }
    catch { throw serviceError("SIGNING_FAILED"); }
  }
  async getAttestation(): Promise<AttestationResponse> {
    return { mode: this.mode, attested: false, simulated: false, signerAddress: this.address, keySource: this.keySource };
  }
}
export async function createSecurityProvider(config: Config): Promise<SecurityProvider> {
  if (config.verifierMode === "LOCAL_DEV") return new LocalSecurityProvider(config);
  const { createDstackSecurityProvider } = await import("./dstack-security.js");
  return createDstackSecurityProvider(config);
}
