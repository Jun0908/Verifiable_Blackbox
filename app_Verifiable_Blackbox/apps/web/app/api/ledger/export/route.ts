import {monthlyCsv} from "@/lib/ledger/monthly-demo";
import {sampleRows, period} from "@/lib/server/curvegrid/monthly";
import {json, requireLocal, failure} from "@/lib/server/curvegrid/http";
import {publicPreview} from "@/lib/public-preview";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    if (!publicPreview) requireLocal(request);
    const month = period(request);
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "summary" && kind !== "details") return json({error:"INVALID_KIND"},400);
    return new Response(monthlyCsv(sampleRows,month,kind),{headers:{"Content-Type":"text/csv; charset=utf-8","Cache-Control":"no-store",
      "Content-Disposition":`attachment; filename="sample-${month}-${kind}.csv"`}});
  } catch (e) {if (e instanceof Error && e.message === "INVALID_PERIOD") return json({error:e.message},400);return failure(e);}
}
