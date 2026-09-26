import {analyzeRoverSession} from "@/lib/server/rover-session/analysis";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["jobId", "sessionId", "signature"].includes(key))) throw Error("INVALID_SESSION_REQUEST");
    return sessionResponse(await analyzeRoverSession(body.jobId, body.sessionId, body.signature));
  } catch (error) {return sessionFailure(error);}
}
