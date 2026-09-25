import {
  EXPECTED_IMAGE_HASH,
  demoEvidenceToWire,
  expectedChallenge,
  type DemoEvidenceV1,
} from "@/lib/contracts";
import {assertDemoAutomationEnabled, getPublicClient} from "@/lib/server/config";
import {setDemoJobBudget, submitDemoEvidence} from "@/lib/server/provider";
import {errorResponse} from "@/lib/server/response";

export const runtime = "nodejs";

type ProviderRequest = {
  action?: "setBudget" | "submit";
  jobId?: string;
  scenario?: DemoEvidenceV1["scenario"];
};

export async function POST(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const body = (await request.json()) as ProviderRequest;
    const jobId = BigInt(body.jobId ?? "0");
    if (jobId <= 0n) throw new Error("jobId must be positive");

    const publicClient = getPublicClient();

    if (body.action === "setBudget") {
      return Response.json({ok: true, ...await setDemoJobBudget(jobId)});
    }

    if (body.action === "submit") {
      const scenario = body.scenario;
      if (scenario !== "success" && scenario !== "tampered") {
        throw new Error("scenario must be success or tampered");
      }
      const block = await publicClient.getBlock();
      const evidence: DemoEvidenceV1 = {
        jobId,
        scenario,
        robotId: "rover-demo-001",
        challenge: expectedChallenge(jobId, scenario),
        capturedAt: block.timestamp,
        imageHash: EXPECTED_IMAGE_HASH,
        checkpoint: "checkpoint-a",
        sequence: 1n,
      };
      const submitted = await submitDemoEvidence(evidence);
      return Response.json({ok: true, ...submitted, evidence: demoEvidenceToWire(evidence)});
    }

    throw new Error("Unknown provider action");
  } catch (error) {
    return errorResponse(error, "Provider automation failed");
  }
}
