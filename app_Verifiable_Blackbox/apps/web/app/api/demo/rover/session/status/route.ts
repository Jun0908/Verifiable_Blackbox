import {roverSessions} from "@/lib/server/rover-session/index";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";
import {roverRunStatus} from "@/lib/server/rover-session/run";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["access", "signature", "jobId", "sessionId"].includes(key))) throw Error("INVALID_SESSION_REQUEST");
    if (body.sessionId !== undefined) return sessionResponse(await roverRunStatus(body.jobId, body.sessionId, body.signature));
    return sessionResponse(await roverSessions().status(body.access, body.signature));
  } catch (error) {return sessionFailure(error);}
}
