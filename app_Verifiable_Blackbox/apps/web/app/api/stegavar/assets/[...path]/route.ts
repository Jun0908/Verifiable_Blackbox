import {asset,failure,requireLocal} from "@/lib/server/stegavar";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{path:string[]}>}) {
  try {requireLocal(request);return await asset((await params).path);}catch(error){return failure(error);}
}
