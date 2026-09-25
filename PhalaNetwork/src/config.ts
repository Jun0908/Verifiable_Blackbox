import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const address = z.string().refine((v) => {
  try { return getAddress(v) !== "0x0000000000000000000000000000000000000000"; } catch { return false; }
});
const key = z.string().regex(/^0x[0-9a-fA-F]{64}$/).refine((v) => {
  try { privateKeyToAccount(v as Hex); return true; } catch { return false; }
});
const uint = z.string().regex(/^(0|[1-9][0-9]*)$/).refine((v) => BigInt(v) < 2n ** 256n);
const positive = z.coerce.number().int().safe().positive();
const envSchema = z.object({
  HOST: z.enum(["127.0.0.1", "0.0.0.0", "::1"]).default("127.0.0.1"),
  PORT: positive.max(65535).default(3100),
  MAX_BODY_BYTES: positive.max(16384).default(16384),
  RPC_URL: z.url().refine((v) => /^https?:\/\//.test(v)),
  CHAIN_ID: positive,
  ERC8183_ADDRESS: address, EVIDENCE_HOOK_ADDRESS: address, EVALUATOR_ADDRESS: address,
  EXPECTED_ROBOT_ID: z.string().min(1).max(128).default("rover-demo-001"),
  EXPECTED_CHECKPOINT: z.string().min(1).max(128).default("checkpoint-a"),
  EXPECTED_SEQUENCE: uint.default("1"),
  MAX_EVIDENCE_AGE_SECONDS: positive.max(86400).default(600),
  MAX_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(300).default(60),
  VERDICT_TTL_SECONDS: positive.max(900).default(300),
  VERIFIER_MODE: z.enum(["LOCAL_DEV", "PHALA_DSTACK"]).default("LOCAL_DEV"),
  VERDICT_SIGNING_KEY: key.optional(),
  DSTACK_KEY_PATH: z.string().min(1).max(200).default("verifiable-blackbox/verdict/secp256k1/v1"),
  DSTACK_SIMULATOR_ENDPOINT: z.url().refine((v) => /^https?:\/\//.test(v)).optional(),
}).superRefine((v, ctx) => {
  if (v.VERIFIER_MODE === "LOCAL_DEV" && !v.VERDICT_SIGNING_KEY)
    ctx.addIssue({ code: "custom", path: ["VERDICT_SIGNING_KEY"], message: "required" });
  if (v.VERIFIER_MODE === "PHALA_DSTACK" && v.VERDICT_SIGNING_KEY)
    ctx.addIssue({ code: "custom", path: ["VERDICT_SIGNING_KEY"], message: "not allowed" });
  if (v.VERIFIER_MODE === "LOCAL_DEV" && v.DSTACK_SIMULATOR_ENDPOINT)
    ctx.addIssue({ code: "custom", path: ["DSTACK_SIMULATOR_ENDPOINT"], message: "not allowed" });
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  const v = parsed.data;
  return {
    host: v.HOST, port: v.PORT, maxBodyBytes: v.MAX_BODY_BYTES,
    rpcUrl: v.RPC_URL, chainId: v.CHAIN_ID,
    erc8183Address: getAddress(v.ERC8183_ADDRESS) as Address,
    evidenceHookAddress: getAddress(v.EVIDENCE_HOOK_ADDRESS) as Address,
    evaluatorAddress: getAddress(v.EVALUATOR_ADDRESS) as Address,
    expectedRobotId: v.EXPECTED_ROBOT_ID, expectedCheckpoint: v.EXPECTED_CHECKPOINT,
    expectedSequence: BigInt(v.EXPECTED_SEQUENCE), maxEvidenceAgeSeconds: BigInt(v.MAX_EVIDENCE_AGE_SECONDS),
    maxClockSkewSeconds: BigInt(v.MAX_CLOCK_SKEW_SECONDS), verdictTtlSeconds: BigInt(v.VERDICT_TTL_SECONDS),
    verifierMode: v.VERIFIER_MODE,
    ...(v.VERDICT_SIGNING_KEY ? { verdictSigningKey: v.VERDICT_SIGNING_KEY as Hex } : {}),
    dstackKeyPath: v.DSTACK_KEY_PATH,
    ...(v.DSTACK_SIMULATOR_ENDPOINT ? { dstackSimulatorEndpoint: v.DSTACK_SIMULATOR_ENDPOINT } : {}),
  };
}
export type Config = ReturnType<typeof loadConfig>;
