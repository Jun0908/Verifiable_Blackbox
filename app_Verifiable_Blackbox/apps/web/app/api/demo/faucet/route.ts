import {parseEther} from "viem";
import {
  assertDemoAutomationEnabled,
  getDeployment,
  getPublicClient,
  getWalletClient,
  toAddress,
} from "@/lib/server/config";
import {errorResponse} from "@/lib/server/response";
import {claimGas, gasStatus} from "@/lib/server/gas-faucet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origin(request: Request) {
  const url = new URL(request.url);
  // Next may normalize request.url to localhost; Host retains the browser's loopback origin.
  const host = request.headers.get("host") ?? url.host;
  const publicOrigin = `${url.protocol}//${host}`;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    || (request.headers.get("origin") && request.headers.get("origin") !== publicOrigin)
    || request.headers.get("sec-fetch-site") === "cross-site") throw Error("LOCAL_SAME_ORIGIN_REQUIRED");
  return publicOrigin;
}

export async function GET(request: Request) {
  try {
    const requestOrigin = origin(request);
    const address = toAddress(new URL(request.url).searchParams.get("address"), "address");
    return Response.json(await gasStatus(address, requestOrigin), {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return errorResponse(error, "GAS_STATUS_UNAVAILABLE");}
}

export async function POST(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const requestOrigin = origin(request);
    const raw = await request.text();
    if (raw.length > 4096) throw Error("GAS_REQUEST_TOO_LARGE");
    const body = JSON.parse(raw) as {address?: unknown; day?: unknown; signature?: unknown};
    const recipient = toAddress(body.address, "address");
    if (getDeployment().chainId === 11155111) {
      return Response.json({ok: true, ...await claimGas(recipient, body.day, body.signature, requestOrigin)}, {headers: {"Cache-Control": "no-store"}});
    }
    if (getDeployment().chainId !== 31337) {
      throw new Error("GAS_CHAIN_UNSUPPORTED");
    }
    const publicClient = getPublicClient();
    const nativeBalance = await publicClient.getBalance({address: recipient});

    const deployerWallet = getWalletClient("deployer");
    let gasTransactionHash = null;
    if (nativeBalance < parseEther("0.1")) {
      gasTransactionHash = await deployerWallet.sendTransaction({
        to: recipient,
        value: parseEther("1"),
      });
      await publicClient.waitForTransactionReceipt({hash: gasTransactionHash});
    }

    return Response.json({
      ok: true,
      minted: "0",
      transactionHash: null,
      gasTransactionHash,
    });
  } catch (error) {
    return errorResponse(error, "Demo gas faucet failed");
  }
}
