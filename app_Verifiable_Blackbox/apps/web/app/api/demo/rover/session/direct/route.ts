import {prepareButtonSession} from "@/lib/server/rover-session/direct";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["jobId", "skipVideo"].includes(key))) throw Error("INVALID_SESSION_REQUEST");
    return sessionResponse(await prepareButtonSession(request, body.jobId, body.skipVideo));
  } catch (error) {return sessionFailure(error);}
}
