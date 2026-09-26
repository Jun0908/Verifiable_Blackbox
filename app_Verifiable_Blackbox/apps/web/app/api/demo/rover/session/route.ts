import {roverSessions} from "@/lib/server/rover-session/index";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["action", "access", "signature", "jobId", "sessionId"].includes(key))) throw Error("INVALID_SESSION_REQUEST");
    const sessions = roverSessions();
    if (body.action === "prepare") return sessionResponse(await sessions.prepare(body.access, body.signature));
    if (body.action === "authorize") return sessionResponse(await sessions.authorize(body.jobId, body.sessionId, body.signature));
    throw Error("INVALID_SESSION_ACTION");
  } catch (error) {return sessionFailure(error);}
}
