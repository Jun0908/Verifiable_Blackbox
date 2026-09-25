import {expectedChallenge} from "@/lib/contracts";
import {assertDemoAutomationEnabled} from "@/lib/server/config";
import {getFundedDemoJob} from "@/lib/server/provider";
import {errorResponse} from "@/lib/server/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const rawJobId = new URL(request.url).searchParams.get("jobId") ?? "";
    if (!/^[1-9][0-9]*$/.test(rawJobId)) throw new Error("jobId must be positive");
    const jobId = BigInt(rawJobId);
    const job = await getFundedDemoJob(jobId);
    return Response.json({
      ok: true,
      jobId: job.id.toString(),
      status: "Funded",
      client: job.client,
      challenge: expectedChallenge(job.id, "success"),
    }, {
      headers: {"Cache-Control": "no-store"},
    });
  } catch (error) {
    return errorResponse(error, "Rover Job lookup failed");
  }
}

export async function POST() {
  // A drive command or motor setpoint is not evidence of physical movement.
  // Keep robot settlement closed until a physical-work verifier is implemented.
  return Response.json({ok: false, error: "PHYSICAL_MOVEMENT_NOT_VERIFIED", message: "Robot payment is paused: physical movement has not been verified."}, {status: 409});
}
