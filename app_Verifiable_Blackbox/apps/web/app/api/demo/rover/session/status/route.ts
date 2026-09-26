import {roverSessions} from "@/lib/server/rover-session/index";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["access", "signature"].includes(key))) throw Error("INVALID_SESSION_REQUEST");
    return sessionResponse(await roverSessions().status(body.access, body.signature));
  } catch (error) {return sessionFailure(error);}
}
