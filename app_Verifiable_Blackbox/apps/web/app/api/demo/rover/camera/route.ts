import {isLocalBridgeRequest, bridgeUrl} from "@/lib/server/bridge-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isLocal = isLocalBridgeRequest;

async function camera(path: "camera" | "camera/frame" | "camera/power", body?: unknown) {
  const token = process.env.VBB_BRIDGE_TOKEN;
  if (!token) return Response.json({error: "Camera unavailable"}, {status: 503});
  try {
    const response = await fetch(bridgeUrl(path), {
      method: body === undefined ? "GET" : "POST",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    const headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
    if (path === "camera/frame" && response.ok) {
      if (response.status === 204) return new Response(null, {status: 204, headers});
      if (response.headers.get("content-type") !== "image/jpeg") throw Error("Invalid image");
      const data = await response.arrayBuffer();
      if (data.byteLength > 2_000_000) throw Error("Image too large");
      return new Response(data, {headers: {...headers, "Content-Type": "image/jpeg",
        "X-Camera-Frame": response.headers.get("x-camera-frame") ?? ""}});
    }
    return Response.json(await response.json(), {status: response.status, headers});
  } catch {
    return Response.json({error: "Camera unavailable"}, {status: 503});
  }
}

export async function GET(request: Request) {
  if (!isLocal(request)) return Response.json({error: "Local dashboard only"}, {status: 403});
  return camera(new URL(request.url).searchParams.get("frame") === "1" ? "camera/frame" : "camera");
}

export async function POST(request: Request) {
  if (!isLocal(request, true)) return Response.json({error: "Same-origin request required"}, {status: 403});
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw Error();
    const text = await request.text();
    if (text.length > 2048) throw Error();
    const body = JSON.parse(text);
    if (body.action === "power" && typeof body.enabled === "boolean") return camera("camera/power", {enabled: body.enabled});
    if (body.action === "configure" && typeof body.url === "string" && body.url.length <= 1024) return camera("camera", {url: body.url});
  } catch { /* Invalid input never reaches the bridge. */ }
  return Response.json({error: "Invalid camera settings"}, {status: 400});
}
