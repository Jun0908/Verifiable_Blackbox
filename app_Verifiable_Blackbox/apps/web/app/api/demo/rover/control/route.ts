import {isLocalBridgeRequest, bridgeUrl} from "@/lib/server/bridge-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localRequest(request: Request, mutation: boolean) {
  if (!isLocalBridgeRequest(request, mutation)) throw Error("Local same-origin dashboard only");
}

async function bridge(path: string, body?: unknown) {
  const token = process.env.VBB_BRIDGE_TOKEN;
  if (!token) return Response.json({error: "Control bridge unavailable. Restart the web launcher."}, {status: 503});
  try {
    const response = await fetch(bridgeUrl(path), {
      method: body ? "POST" : "GET",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(path === "activate" ? 15000 : 5000),
    });
    return Response.json(await response.json(), {status: response.status, headers: {"Cache-Control": "no-store"}});
  } catch {
    return Response.json({error: "Control bridge unavailable. Restart the web launcher."}, {status: 503});
  }
}

export async function GET(request: Request) {
  try {
    localRequest(request, false);
    return await bridge("status");
  } catch {
    return Response.json({error: "Local dashboard only"}, {status: 403});
  }
}

export async function POST(request: Request) {
  try {
    localRequest(request, true);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw Error("JSON required");
    const text = await request.text();
    if (text.length > 2048) throw Error("Request too large");
    const body = JSON.parse(text) as Record<string, unknown>;
    if (body.action === "activate") {
      return await bridge("activate", {});
    }
    if (typeof body.session !== "string" || body.session.length < 16 || body.session.length > 128) throw Error("Invalid session");
    if (body.action === "stop") return await bridge("stop", {session: body.session});
    if (body.action === "release") {
      if (!Number.isSafeInteger(body.sequence) || Number(body.sequence) < 0) throw Error("Invalid sequence");
      return await bridge("release", {session: body.session, sequence: body.sequence});
    }
    if (body.action === "gripper") {
      if (!Number.isSafeInteger(body.sequence) || Number(body.sequence) < 0) throw Error("Invalid sequence");
      if (body.gripperAction !== "open" && body.gripperAction !== "close") throw Error("Invalid gripper action");
      return await bridge("gripper", {session: body.session, sequence: body.sequence, action: body.gripperAction});
    }
    if (body.action === "drive") {
      if (!Number.isSafeInteger(body.sequence) || Number(body.sequence) < 0) throw Error("Invalid sequence");
      if (!["forward", "back", "left", "right", "turn-left", "turn-right"].includes(String(body.direction))) throw Error("Invalid direction");
      if (![35, 60, 85].includes(body.speed as number)) throw Error("Invalid speed");
      return await bridge("drive", {session: body.session, sequence: body.sequence, direction: body.direction, speed: body.speed});
    }
    throw Error("Unknown action");
  } catch (error) {
    return Response.json({error: error instanceof Error ? error.message : "Rover control failed"}, {status: 400});
  }
}
