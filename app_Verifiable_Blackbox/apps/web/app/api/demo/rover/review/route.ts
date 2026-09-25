import {NextRequest, NextResponse} from "next/server";
import {assertDemoAutomationEnabled} from "@/lib/server/config";
import {readDemoReview, updateDemoReview} from "@/lib/server/demo-review";

export const runtime = "nodejs";

function checkLocalRequest(request: NextRequest, mutation = false) {
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new Error("LOCAL_REQUEST_REQUIRED");
  if (mutation && request.headers.get("origin") !== `http://${host}`) throw new Error("SAME_ORIGIN_REQUIRED");
  assertDemoAutomationEnabled();
}

export async function GET(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const record = await readDemoReview(request.nextUrl.searchParams.get("jobId") ?? "");
    return NextResponse.json({ok: true, record}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return failure(error);}
}

export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request, true);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("JSON_REQUIRED");
    const body = await request.text();
    if (body.length > 4096) throw new Error("REQUEST_TOO_LARGE");
    const input = JSON.parse(body);
    if (typeof input.jobId !== "string" || !["prepare", "verify-and-pay"].includes(input.action)) throw new Error("INVALID_APPROVAL_REQUEST");
    const record = await updateDemoReview(input.jobId, input.action, input.signature);
    return NextResponse.json({ok: true, record}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return failure(error);}
}

function failure(error: unknown) {
  // Do not return RPC payloads or signing details to the UI.
  const reason = error instanceof Error ? error.message : "APPROVAL_REQUEST_FAILED";
  return NextResponse.json({ok: false, error: /^[A-Z_]+$/.test(reason) ? reason : "APPROVAL_REQUEST_FAILED"}, {status: 409});
}
