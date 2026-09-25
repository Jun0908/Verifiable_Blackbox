import {assertDemoAutomationEnabled} from "@/lib/server/config";
import {errorResponse} from "@/lib/server/response";
import {settleDemoVerdict} from "@/lib/server/settlement";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const body = (await request.json()) as {
      verdict?: unknown;
      signature?: unknown;
    };
    return Response.json({ok: true, ...await settleDemoVerdict(body.verdict, body.signature)});
  } catch (error) {
    return errorResponse(error, "Settlement failed");
  }
}
