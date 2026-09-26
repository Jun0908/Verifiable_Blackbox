import {registerWorldRecording} from "@/lib/server/world-disclosure";
import {sessionRequest, sessionFailure} from "@/lib/server/rover-session/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const result = await registerWorldRecording(request, await sessionRequest(request));
    return Response.json(result, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return sessionFailure(error);}
}
