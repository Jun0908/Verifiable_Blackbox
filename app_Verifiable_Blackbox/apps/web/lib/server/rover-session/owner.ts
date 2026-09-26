import "server-only";
import {createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey} from "jose";
import type {Address} from "viem";
import {getDeployment, getPublicClient} from "../config";

const keys = new Map<string, JWTVerifyGetKey>();
export async function verifyPrivyOwner(token: string, appId: string, owner: Address,
  key?: JWTVerifyGetKey, fetcher: typeof fetch = fetch, identityToken?: string) {
  if (!token || token.length > 16384) throw Error("LOGIN_REQUIRED");
  if (!/^[a-z0-9_-]+$/i.test(appId)) throw Error("PRIVY_CONFIGURATION_REQUIRED");
  if (!key) {
    key = keys.get(appId);
    if (!key) {key = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`)); keys.set(appId, key);}
  }
  let subject: string;
  try {
    const {payload} = await jwtVerify(token, key, {issuer: "privy.io", audience: appId, algorithms: ["ES256"], requiredClaims: ["sub", "exp", "iat"]});
    if (!payload.sub?.startsWith("did:privy:")) throw Error();
    subject = payload.sub;
  } catch {
    throw Error("LOGIN_TOKEN_INVALID");
  }
  if (identityToken) {
    if (identityToken.length > 32768) throw Error("LOGIN_IDENTITY_INVALID");
    let accounts: unknown;
    try {
      const {payload} = await jwtVerify(identityToken, key, {issuer: "privy.io", audience: appId, algorithms: ["ES256"], requiredClaims: ["sub", "exp", "iat"]});
      if (payload.sub !== subject) throw Error();
      accounts = typeof payload.linked_accounts === "string" ? JSON.parse(payload.linked_accounts) : payload.linked_accounts;
    } catch {throw Error("LOGIN_IDENTITY_INVALID");}
    if (!Array.isArray(accounts) || !accounts.some(account => account?.type === "wallet" && account.chain_type === "ethereum"
      && typeof account.address === "string" && account.address.toLowerCase() === owner.toLowerCase())) throw Error("JOB_OWNER_REQUIRED");
    return;
  }
  // The same authenticated user endpoint is used by the installed Privy React SDK.
  let response: Response;
  try {response = await fetcher("https://auth.privy.io/api/v1/users/me", {headers: {Authorization: `Bearer ${token}`, "privy-app-id": appId,
    ...(process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ? {"privy-client-id": process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID} : {})},
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000)});} catch {throw Error("LOGIN_CHECK_UNAVAILABLE");}
  if (!response.ok) throw Error("LOGIN_LOOKUP_REJECTED");
  const {user} = await response.json();
  if (user?.id !== subject || !Array.isArray(user.linked_accounts)
    || !user.linked_accounts.some((account: {type?: string; chain_type?: string; address?: string}) => account.type === "wallet"
      && account.chain_type === "ethereum" && account.address?.toLowerCase() === owner.toLowerCase())) throw Error("JOB_OWNER_REQUIRED");
}

export async function requireJobOwner(request: Request, owner: Address) {
  const deployment = getDeployment();
  if (process.env.NEXT_PUBLIC_LOCAL_DEMO === "true" && deployment.chainId === 31337
    && new URL(deployment.rpcUrl).hostname === "127.0.0.1" && await getPublicClient().getChainId() === 31337) {
    if (owner.toLowerCase() !== "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266") throw Error("JOB_OWNER_REQUIRED");
    return;
  }
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw Error("LOGIN_TOKEN_MISSING");
  await verifyPrivyOwner(token, process.env.NEXT_PUBLIC_PRIVY_APP_ID || "", owner, undefined, fetch, request.headers.get("x-privy-identity-token") ?? undefined);
}
