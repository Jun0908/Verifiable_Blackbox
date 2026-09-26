import {worldConnectionStatus} from "@/lib/server/world-status";
export const runtime = "nodejs";
export async function GET() {
  return Response.json(await worldConnectionStatus(), {headers:{"Cache-Control":"no-store"}});
}
