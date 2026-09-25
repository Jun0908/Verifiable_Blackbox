import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 200_000;
const RETRIES_PER_UPSTREAM = 2;
const REQUEST_TIMEOUT_MS = 10_000;
const SEPOLIA_PUBLIC_FALLBACKS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://eth-sepolia.g.alchemy.com/v2/demo",
] as const;

type JsonRpcCall = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

function isAllowedCall(value: unknown): value is JsonRpcCall {
  if (!value || typeof value !== "object") return false;
  const method = (value as JsonRpcCall).method;
  return typeof method === "string" && new Set([
    "eth_chainId", "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice",
    "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getBalance", "eth_getCode",
    "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt",
    "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs", "eth_sendRawTransaction",
    "net_version", "web3_clientVersion",
  ]).has(method);
}

function upstreams() {
  const configured = process.env.DEMO_RPC_URL || process.env.SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  const candidates = [
    configured,
    ...(process.env.NEXT_PUBLIC_CHAIN_ID === "11155111" ? SEPOLIA_PUBLIC_FALLBACKS : []),
  ];
  return [...new Set(candidates.filter((value): value is string => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return !url.pathname.endsWith("/api/demo/rpc");
    } catch {
      return false;
    }
  }))];
}

function jsonRpcError(message: string, status: number) {
  return Response.json(
    {jsonrpc: "2.0", id: null, error: {code: -32_603, message}},
    {status, headers: {"Cache-Control": "no-store"}},
  );
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return jsonRpcError("RPC request is too large", 413);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return jsonRpcError("RPC request is too large", 413);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonRpcError("Invalid JSON-RPC payload", 400);
  }
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.some((call) => !isAllowedCall(call))) {
    return jsonRpcError("RPC method is not allowed", 400);
  }

  const availableUpstreams = upstreams();
  if (availableUpstreams.length === 0) return jsonRpcError("No RPC upstream configured", 503);

  let lastError = "RPC upstream unavailable";
  for (const upstream of availableUpstreams) {
    for (let attempt = 1; attempt <= RETRIES_PER_UPSTREAM; attempt++) {
      try {
        const response = await fetch(upstream, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: rawBody,
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) {
          return new Response(await response.text(), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "X-Demo-Rpc-Upstream": new URL(upstream).hostname,
            },
          });
        }
        lastError = `RPC upstream returned ${response.status}`;
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "RPC fetch failed";
      }
      if (attempt < RETRIES_PER_UPSTREAM) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }
  return jsonRpcError(lastError, 502);
}
