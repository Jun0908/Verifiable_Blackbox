import {startRoverSession, stopRoverSession, recordForwardPress} from "@/lib/server/rover-session/run";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["jobId", "sessionId", "signature", "action"].includes(key)) || !["start", "stop", "press"].includes(String(body.action))) throw Error("INVALID_SESSION_REQUEST");
    return sessionResponse(await (body.action === "press" ? recordForwardPress : body.action === "stop" ? stopRoverSession : startRoverSession)(body.jobId, body.sessionId, body.signature));
  } catch (error) {return sessionFailure(error);}
}
