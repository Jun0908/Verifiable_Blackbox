import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import { PASS_OUTCOME } from "./contracts.js";
import { invalidEvidence } from "./errors.js";
import { parseEvidence } from "./evidence.js";
import { validateEvidence } from "./policy.js";
import type { ChainReader } from "./chain.js";
import type { Config } from "./config.js";
import type { SecurityProvider } from "./security.js";
import type { DemoVerdictV1, DemoVerdictWire } from "./types.js";

export class VerifierService {
  constructor(
    private readonly config: Config,
    private readonly chain: ChainReader,
    private readonly security: SecurityProvider,
  ) {}

  async verify(input: unknown): Promise<{
    verdict: DemoVerdictWire;
    signature: Hex;
    verifier: {
      mode: "LOCAL_DEV" | "PHALA_DSTACK";
      attested: boolean;
      signerAddress: `0x${string}`;
      attestationPath: string | null;
      simulated: boolean;
    };
  }> {
    const evidence = parseEvidence(input);
    const snapshot = await this.chain.getJobSnapshot(evidence.jobId);
    const commitment = validateEvidence(evidence, snapshot, this.config);
    const issuedAt = snapshot.blockTimestamp;
    const configuredExpiry = issuedAt + this.config.verdictTtlSeconds;
    const jobExpiry = snapshot.expiredAt - 1n;
    const validUntil = configuredExpiry < jobExpiry ? configuredExpiry : jobExpiry;
    if (validUntil <= issuedAt || issuedAt < 0n || validUntil >= 2n ** 64n ||
        this.config.verdictTtlSeconds <= 0n || this.config.verdictTtlSeconds > 900n) {
      throw invalidEvidence("VERDICT_WINDOW_INVALID");
    }

    const verdict: DemoVerdictV1 = {
      jobId: evidence.jobId,
      provider: snapshot.provider,
      evidenceCommitment: commitment,
      outcome: PASS_OUTCOME,
      issuedAt,
      validUntil,
      nonce: `0x${randomBytes(32).toString("hex")}`,
    };
    const signature = await this.security.signVerdict(verdict);

    return {
      verdict: {
        jobId: verdict.jobId.toString(),
        provider: verdict.provider,
        evidenceCommitment: verdict.evidenceCommitment,
        outcome: verdict.outcome,
        issuedAt: verdict.issuedAt.toString(),
        validUntil: verdict.validUntil.toString(),
        nonce: verdict.nonce,
      },
      signature,
      verifier: {
        mode: this.security.mode,
        attested: this.security.attested,
        signerAddress: this.security.address,
        attestationPath: this.security.attestationAvailable ? "/attestation" : null,
        simulated: this.security.simulated,
      },
    };
  }
}
