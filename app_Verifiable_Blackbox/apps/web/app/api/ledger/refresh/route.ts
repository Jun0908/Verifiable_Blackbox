import {ledgerState} from "@/lib/server/curvegrid/state";
import {json, failure, requireLocal} from "@/lib/server/curvegrid/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireLocal(request,true);
    const state = await ledgerState();
    await state.refresh();
    return json(state.publicState());
  } catch (e) {return failure(e);}
}
