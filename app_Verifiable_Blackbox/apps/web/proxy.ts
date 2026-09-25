import {NextResponse, type NextRequest} from "next/server";

// This application holds local signing roles and robot control credentials.
// It is deliberately served on loopback; reject remote Host/Origin requests.
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "");
  const origin = request.headers.get("origin");
  const allowedHost = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const sameOrigin = !origin || origin === `http://${host}` || origin === `https://${host}`;
  const crossSite = request.headers.get("sec-fetch-site") === "cross-site";
  if (!allowedHost || !sameOrigin || crossSite) {
    return NextResponse.json({ok:false, error:"LOCAL_SAME_ORIGIN_REQUIRED"}, {status:403});
  }
  return NextResponse.next();
}

export const config = {matcher: "/api/demo/:path*"};
