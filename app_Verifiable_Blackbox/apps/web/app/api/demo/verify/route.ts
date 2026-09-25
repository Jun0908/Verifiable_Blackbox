import {parseDemoEvidence} from "@/lib/contracts";
import {assertDemoAutomationEnabled} from "@/lib/server/config";
import {errorResponse} from "@/lib/server/response";
import {VerifierAdapterError, verifyEvidence} from "@/lib/server/verifier";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const body = (await request.json()) as {evidence?: unknown};
    return Response.json(await verifyEvidence(parseDemoEvidence(body.evidence)), {
      headers: {"Cache-Control": "no-store"},
    });
  } catch (error) {
    if (error instanceof VerifierAdapterError) {
      return Response.json(
        {ok: false, error: error.message},
        {status: error.status, headers: {"Cache-Control": "no-store"}},
      );
    }
    return errorResponse(error, "Evidence verification failed");
  }
}
