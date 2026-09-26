import "server-only";
import {readFile} from "node:fs/promises";
import {resolve,relative,isAbsolute} from "node:path";
import {existsSync} from "node:fs";
import {createHash} from "node:crypto";
import type {Catalog,Scene} from "@/lib/stegavar/types";
import {matchesAnalysis} from "@/lib/stegavar/types";

export class StegavarError extends Error {
  constructor(public code: string,public status: number) {super(code);}
}
export function config(env:NodeJS.ProcessEnv=process.env) {
  const base=new URL(env.STEGAVAR_URL||"http://127.0.0.1:4178");
  if(base.protocol!=="http:" || !["127.0.0.1","localhost"].includes(base.hostname) || base.username || base.password || base.pathname!=="/" || base.search || base.hash)throw new StegavarError("CONFIG",503);
  const timeout=Number(env.STEGAVAR_TIMEOUT_MS||20000);
  if(!Number.isInteger(timeout)||timeout<100||timeout>300000)throw new StegavarError("CONFIG",503);
  return {base:base.origin,timeout};
}
export function dataRoot() {
  const cwd=process.cwd();
  const app=existsSync(resolve(/* turbopackIgnore: true */ cwd,"apps/web"))?cwd:resolve(/* turbopackIgnore: true */ cwd,"../..");
  return resolve(/* turbopackIgnore: true */ app,process.env.STEGAVAR_DATA_ROOT||"apps/web/public/stegavar");
}
export async function catalog():Promise<Catalog> {
  try {
    const data=JSON.parse(await readFile(resolve(/* turbopackIgnore: true */ dataRoot(),"catalog.json"),"utf8")) as Catalog;
    if(data.version!==1 || !Array.isArray(data.cases) || data.cases.length!==2)throw Error();
    for(const row of data.cases) {
      if(!["rover-moving","rover-still"].includes(row.id)||!Array.isArray(row.scenes)||row.scenes.length!==3)throw Error();
      for(const scene of row.scenes) {
        if(!["surf","hike","camp"].includes(scene.id)||scene.manifest.case!==row.id||scene.manifest.scene!==scene.id||!matchesAnalysis(scene.savedAnalysis,scene))throw Error();
      }
    }
    return data;
  }catch {throw new StegavarError("DATA_UNAVAILABLE",503);}
}
export async function selected(value:unknown):Promise<Scene> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new StegavarError("INVALID_INPUT",400);
  const row=value as Record<string,unknown>;
  if(Object.keys(row).sort().join(",")!=="case,scene"||typeof row.case!=="string"||typeof row.scene!=="string")throw new StegavarError("INVALID_INPUT",400);
  const data=await catalog();
  const scene=data.cases.find(item=>item.id===row.case)?.scenes.find(item=>item.id===row.scene);
  if(!scene)throw new StegavarError("INVALID_INPUT",400);
  return scene;
}
export async function upstream(path:"health"|"analyze",input?:unknown,fetcher:typeof fetch=fetch,settings=config()) {
  try {
    const response=await fetcher(`${settings.base}/${path}`,{method:input?"POST":"GET",headers:input?{"Content-Type":"application/json"}:undefined,
      body:input?JSON.stringify(input):undefined,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(settings.timeout)});
    if(!response.ok) {
      const status=[409,422,503,504].includes(response.status)?response.status:502;
      throw new StegavarError(({409:"BUSY",422:"INPUT_INTEGRITY",503:"UNAVAILABLE",504:"TIMEOUT"} as Record<number,string>)[status]||"ANALYSIS_FAILED",status);
    }
    return await response.json();
  }catch(error) {
    if(error instanceof StegavarError)throw error;
    if(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name))throw new StegavarError("TIMEOUT",504);
    throw new StegavarError("UNAVAILABLE",503);
  }
}
export async function analyze(value:unknown) {
  const scene=await selected(value);
  const result=await upstream("analyze",value);
  if(!matchesAnalysis(result,scene)||result.execution!=="live"||typeof result.request_id!=="string"||!result.request_id||!Number.isFinite(Date.parse(result.analyzed_at||""))||!Number.isFinite(result.total_seconds)||result.total_seconds!<0)throw new StegavarError("RESULT_MISMATCH",502);
  return result;
}
export async function health() {
  const data=await upstream("health");
  if(data?.application!=="vbb-stegavar"||data.version!==1||typeof data.busy!=="boolean"||typeof data.model_loaded!=="boolean"||typeof data.model_available!=="boolean")throw new StegavarError("SERVICE_MISMATCH",503);
  return {state:data.busy?"busy":"ready",modelLoaded:data.model_loaded,modelAvailable:data.model_available,device:"cpu"};
}
export const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export function failure(error:unknown) {return error instanceof StegavarError?json({error:error.code},error.status):json({error:"UNAVAILABLE"},503);}
export function requireLocal(request:Request,write=false) {
  const url=new URL(request.url),host=request.headers.get("host")||url.host;
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)||request.headers.get("sec-fetch-site")==="cross-site"||(write&&request.headers.get("origin")!==`${url.protocol}//${host}`))throw new StegavarError("ORIGIN",403);
}
export async function asset(parts:string[]) {
  if(parts.length===1&&parts[0]==="catalog.json") {
    const data=await catalog();
    for(const row of data.cases)for(const scene of row.scenes)scene.base=`/api/stegavar/assets/${row.id}/${scene.id}`;
    return json(data);
  }
  let file:string,checksum:string|undefined;
  if(parts.length===1&&parts[0]==="SOURCES.md")file="SOURCES.md";
  else {
    if(parts.length!==4||!["cover","stego","difference","recovered"].includes(parts[2])||!/^\d{4}\.png$/.test(parts[3]))throw new StegavarError("NOT_FOUND",404);
    const scene=await selected({case:parts[0],scene:parts[1]});
    checksum=scene.manifest.files_sha256[`${parts[2]}/${parts[3]}`];
    if(!checksum)throw new StegavarError("NOT_FOUND",404);
    file=parts.join("/");
  }
  const root=dataRoot(),path=resolve(/* turbopackIgnore: true */ root,file),rel=relative(root,path);
  if(rel.startsWith("..")||isAbsolute(rel))throw new StegavarError("NOT_FOUND",404);
  const buffer=await readFile(path);
  if(checksum&&createHash("sha256").update(buffer).digest("hex")!==checksum)throw new StegavarError("INPUT_INTEGRITY",422);
  return new Response(buffer,{headers:{"Content-Type":checksum?"image/png":"text/plain; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
