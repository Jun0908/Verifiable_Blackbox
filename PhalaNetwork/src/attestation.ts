import { createHash } from "node:crypto";
import type { Hex } from "viem";
export const CLAIM_KEYS = ["schema", "signerAddress", "chainId", "evaluatorAddress", "evidencePolicy", "composeHash", "appId", "instanceId", "nonce"] as const;
export function claimsDigest(claims: Record<string, unknown>): Hex {
  const ordered = Object.fromEntries(CLAIM_KEYS.map(key => [key, claims[key]]));
  return `0x${createHash("sha256").update(JSON.stringify(ordered)).digest("hex")}`;
}
