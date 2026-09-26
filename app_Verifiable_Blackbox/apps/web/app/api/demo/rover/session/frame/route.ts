import {ownedSession} from "@/lib/server/rover-session/run";
import {recordedBytes} from "@/lib/server/rover-session/analysis";
import {sessionFailure, sessionRequest} from "@/lib/server/rover-session/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["jobId", "sessionId", "signature", "index"].includes(key))
      || !Number.isSafeInteger(body.index) || Number(body.index) < 0) throw Error("INVALID_FRAME_REQUEST");
    const record = await ownedSession(body.jobId, body.sessionId, body.signature);
    if (!["CAPTURED", "ERROR"].includes(record.phase)) throw Error("RECORDING_NOT_FINISHED");
    return new Response(new Uint8Array(await recordedBytes(record, Number(body.index))),
      {headers: {"Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
  } catch (error) {return sessionFailure(error);}
}
