import {analyze,json,failure,requireLocal,StegavarError} from "@/lib/server/stegavar";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    requireLocal(request,true);
    if(!request.headers.get("content-type")?.startsWith("application/json"))throw new StegavarError("INVALID_INPUT",400);
    const body=await request.text();
    if(body.length>1024)throw new StegavarError("INVALID_INPUT",400);
    let input:unknown;try{input=JSON.parse(body);}catch{throw new StegavarError("INVALID_INPUT",400);}
    return json(await analyze(input));
  }catch(error){return failure(error);}
}
