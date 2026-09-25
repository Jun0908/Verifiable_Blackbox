import {errorResponse} from "@/lib/server/response";
import {fetchAttestation, VerifierAdapterError} from "@/lib/server/verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await fetchAttestation(), {
      headers: {"Cache-Control": "no-store"},
    });
  } catch (error) {
    if (error instanceof VerifierAdapterError) {
      return Response.json(
        {ok: false, error: error.message},
        {status: error.status, headers: {"Cache-Control": "no-store"}},
      );
    }
    return errorResponse(error, "Attestation request failed");
  }
}
