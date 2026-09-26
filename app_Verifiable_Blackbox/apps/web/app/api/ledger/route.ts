import {ledgerState} from "@/lib/server/curvegrid/state";
import {json, failure, requireLocal} from "@/lib/server/curvegrid/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {requireLocal(request); return json((await ledgerState()).publicState());} catch (e) {return failure(e);}
}
