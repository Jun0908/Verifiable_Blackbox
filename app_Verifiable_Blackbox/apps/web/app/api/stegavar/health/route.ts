import {health,json,failure,requireLocal} from "@/lib/server/stegavar";
export const runtime="nodejs";
export async function GET(request:Request) {
  try {requireLocal(request);return json(await health());}catch(error){return failure(error);}
}
