import "server-only";
import {assertDemoAutomationEnabled} from "../config";
import {isLocalBridgeRequest} from "../bridge-config";

export async function sessionRequest(request: Request): Promise<Record<string, unknown>> {
  if (!isLocalBridgeRequest(request, true)) throw Error("LOCAL_SAME_ORIGIN_REQUIRED");
  assertDemoAutomationEnabled();
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw Error("JSON_REQUIRED");
  const text = await request.text();
  if (text.length > 8192) throw Error("REQUEST_TOO_LARGE");
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("INVALID_SESSION_REQUEST");
  return body;
}
export function sessionResponse(record: unknown) {
  return Response.json({ok: true, record}, {headers: {"Cache-Control": "no-store"}});
}
export function sessionFailure(error: unknown) {
  const reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "SESSION_REQUEST_FAILED";
  const status = ["OWNER_SIGNATURE_REQUIRED", "LOCAL_SAME_ORIGIN_REQUIRED"].includes(reason) ? 403 : 409;
  return Response.json({ok: false, error: reason}, {status, headers: {"Cache-Control": "no-store"}});
}
