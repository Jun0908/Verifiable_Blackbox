import {getDeployment, getVerifierConfig} from "@/lib/server/config";
import {errorResponse} from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const verifier = getVerifierConfig();
    return Response.json({
      ...getDeployment(),
      verifier: {
        mode: verifier.mode,
        attestationAvailable: verifier.mode === "PHALA",
      },
    }, {
      headers: {"Cache-Control": "no-store"},
    });
  } catch (error) {
    return errorResponse(error, "Demo contracts are not deployed");
  }
}
