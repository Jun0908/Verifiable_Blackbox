import {parseEther} from "viem";
import {
  assertDemoAutomationEnabled,
  getPublicClient,
  getWalletClient,
  toAddress,
} from "@/lib/server/config";
import {errorResponse} from "@/lib/server/response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const body = (await request.json()) as {address?: unknown};
    const recipient = toAddress(body.address, "address");
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
