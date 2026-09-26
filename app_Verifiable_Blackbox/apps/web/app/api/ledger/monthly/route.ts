import {summarize} from "@/lib/ledger/monthly-demo";
import {sampleRows, period} from "@/lib/server/curvegrid/monthly";
import {json, requireLocal, failure} from "@/lib/server/curvegrid/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {requireLocal(request);return json(summarize(sampleRows,period(request)));}
  catch (e) {if (e instanceof Error && e.message === "INVALID_PERIOD") return json({error:e.message},400);return failure(e);}
}
