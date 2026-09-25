import "server-only";

import {readFileSync} from "node:fs";
import {basename, resolve} from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  isHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import type {DemoDeployment} from "@/lib/contracts";

const LOCAL_KEYS = {
  deployer:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
  provider: toHex(0xb0bn, {size: 32}),
  relayer: toHex(0xd00dn, {size: 32}),
  tee: toHex(0xa11cen, {size: 32}),
};

type DeploymentFile = Omit<DemoDeployment, "rpcUrl" | "explorerUrl">;

export type VerifierConfig =
  | {mode: "MOCK_TEE"}
  | {
      mode: "PHALA";
      baseUrl: string;
      timeoutMs: number;
      bearerToken?: string;
    };

export function getDeployment(): DemoDeployment {
  const deploymentFile = process.env.DEMO_DEPLOYMENT_FILE ?? "demo.web.json";
  if (
    basename(deploymentFile) !== deploymentFile
    || !/^demo\.[a-z0-9.-]+\.json$/i.test(deploymentFile)
  ) {
    throw new Error("DEMO_DEPLOYMENT_FILE must be a demo.*.json filename");
  }
  const deploymentPath = resolve(process.cwd(), "../../deployments", deploymentFile);
  let file: Partial<DeploymentFile> = {};

  try {
    file = JSON.parse(readFileSync(deploymentPath, "utf8")) as Partial<DeploymentFile>;
  } catch {
    // Environment variables may supply addresses on hosted deployments.
  }

  const deployment = {
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? file.chainId ?? 31337),
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545",
    explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL || undefined,
    mockUsdc: process.env.MOCK_USDC_ADDRESS ?? file.mockUsdc,
    erc8183: process.env.ERC8183_ADDRESS ?? file.erc8183,
    evidenceHook: process.env.EVIDENCE_HOOK_ADDRESS ?? file.evidenceHook,
    evaluator: process.env.EVALUATOR_ADDRESS ?? file.evaluator,
    provider: process.env.DEMO_PROVIDER_ADDRESS ?? file.provider,
    relayer: process.env.DEMO_RELAYER_ADDRESS ?? file.relayer,
    mockTeeSigner: process.env.DEMO_TEE_SIGNER_ADDRESS ?? file.mockTeeSigner,
  };

  for (const [name, value] of Object.entries(deployment)) {
    if (name.endsWith("Url") || name === "chainId") continue;
    if (typeof value !== "string" || !isAddress(value)) {
      throw new Error(`Missing or invalid ${name}`);
    }
  }

  return deployment as DemoDeployment;
}

export function getDemoChain() {
  const deployment = getDeployment();
  return defineChain({
    id: deployment.chainId,
    name:
      deployment.chainId === 31337
        ? "Anvil"
        : deployment.chainId === 11155111
          ? "Ethereum Sepolia"
          : "VBB Demo Chain",
    nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: [deployment.rpcUrl]}},
    blockExplorers: deployment.explorerUrl
      ? {default: {name: "Explorer", url: deployment.explorerUrl}}
      : undefined,
  });
}

export function getPublicClient() {
  const deployment = getDeployment();
  return createPublicClient({chain: getDemoChain(), transport: http(deployment.rpcUrl)});
}

export function getServerAccount(role: keyof typeof LOCAL_KEYS) {
  const deployment = getDeployment();
  const envNames: Record<keyof typeof LOCAL_KEYS, string> = {
    deployer: "DEPLOYER_PRIVATE_KEY",
    provider: "DEMO_PROVIDER_PRIVATE_KEY",
    relayer: "DEMO_RELAYER_PRIVATE_KEY",
    tee: "DEMO_TEE_PRIVATE_KEY",
  };
  const configured = process.env[envNames[role]];
  const key = configured ?? (deployment.chainId === 31337 ? LOCAL_KEYS[role] : undefined);
  if (!key || !isHex(key) || key.length !== 66) {
    throw new Error(`${envNames[role]} must be a 32-byte private key`);
  }
  return privateKeyToAccount(key as Hex);
}

export function getWalletClient(role: "deployer" | "provider" | "relayer") {
  const deployment = getDeployment();
  const account = getServerAccount(role);
  return createWalletClient({
    account,
    chain: getDemoChain(),
    transport: http(deployment.rpcUrl),
  });
}

export function assertDemoAutomationEnabled() {
  const deployment = getDeployment();
  if (deployment.chainId !== 31337 && process.env.ALLOW_PUBLIC_DEMO_AUTOMATION !== "true") {
    throw new Error("Demo automation is disabled for this chain");
  }
}

export function getVerifierConfig(): VerifierConfig {
  const mode = (process.env.DEMO_VERIFIER_MODE ?? "MOCK_TEE").trim().toUpperCase();
  if (mode === "MOCK_TEE") return {mode};
  if (mode !== "PHALA") {
    throw new Error("DEMO_VERIFIER_MODE must be MOCK_TEE or PHALA");
  }

  const configuredUrl = process.env.PHALA_VERIFIER_URL;
  if (!configuredUrl) throw new Error("PHALA_VERIFIER_URL is required in PHALA mode");
  const url = new URL(configuredUrl);
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("PHALA_VERIFIER_URL must use HTTPS (HTTP is allowed only for loopback)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("PHALA_VERIFIER_URL must not contain credentials, query, or fragment");
  }

  const timeoutMs = Number(process.env.PHALA_VERIFIER_TIMEOUT_MS ?? 10_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("PHALA_VERIFIER_TIMEOUT_MS must be an integer from 1000 to 30000");
  }

  return {
    mode,
    baseUrl: url.toString().replace(/\/$/, ""),
    timeoutMs,
    ...(process.env.PHALA_VERIFIER_BEARER_TOKEN
      ? {bearerToken: process.env.PHALA_VERIFIER_BEARER_TOKEN}
      : {}),
  };
}

export function toAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} must be an address`);
  }
  return value;
}
