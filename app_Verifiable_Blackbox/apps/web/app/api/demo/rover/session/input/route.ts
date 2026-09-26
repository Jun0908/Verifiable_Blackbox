import {inputRoverSession} from "@/lib/server/rover-session/run";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["jobId", "sessionId", "signature", "action", "sequence"].includes(key))) throw Error("INVALID_SESSION_REQUEST");
    return sessionResponse(await inputRoverSession(body.jobId, body.sessionId, body.signature, body.action, body.sequence));
  } catch (error) {return sessionFailure(error);}
}
