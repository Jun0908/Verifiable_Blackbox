import test from "node:test";
import assert from "node:assert/strict";
import {config,selected,upstream,asset,requireLocal,StegavarError} from "../apps/web/lib/server/stegavar.ts";
import {matchesAnalysis} from "../apps/web/lib/stegavar/types.ts";

test("service configuration accepts loopback only",()=>{
  assert.equal(config({}).timeout,20000);
  for(const url of ["https://example.com","http://127.0.0.1@evil.test","http://127.0.0.1:4176/other"])
    assert.throws(()=>config({STEGAVAR_URL:url}));
  assert.throws(()=>config({STEGAVAR_TIMEOUT_MS:"NaN"}));
});
test("case selection and result identity use catalog data",async()=>{
  for(const value of [{case:"../private",scene:"surf"},{case:"rover-moving",scene:[]},{case:"rover-moving",scene:"surf",url:"file:///secret"}])
    await assert.rejects(()=>selected(value),e=>e instanceof StegavarError&&e.status===400);
  const scene=await selected({case:"rover-moving",scene:"surf"});
  assert.ok(matchesAnalysis(scene.savedAnalysis,scene));
  assert.equal(matchesAnalysis({...scene.savedAnalysis,case:"rover-still"},scene),false);
  assert.equal(matchesAnalysis({...scene.savedAnalysis,recovered_frames_sha256:"a".repeat(64)},scene),false);
});
test("upstream failure states stay distinct",async()=>{
  for(const [status,code] of [[409,"BUSY"],[422,"INPUT_INTEGRITY"],[503,"UNAVAILABLE"],[504,"TIMEOUT"],[500,"ANALYSIS_FAILED"]] as const){
    await assert.rejects(()=>upstream("analyze",{},async()=>new Response("{}",{status})),e=>e instanceof StegavarError&&e.code===code);
  }
  await assert.rejects(()=>upstream("health",undefined,async()=>{throw new DOMException("elapsed","TimeoutError");}),e=>e instanceof StegavarError&&e.status===504);
  await assert.rejects(()=>upstream("health",undefined,async()=>{throw new Error("private address");}),e=>e instanceof StegavarError&&e.message==="UNAVAILABLE");
});
test("API requires matching origin for analysis",()=>{
  assert.throws(()=>requireLocal(new Request("http://localhost:3000/api/stegavar/analyze"),true));
  requireLocal(new Request("http://localhost:3000/api/stegavar/analyze",{headers:{origin:"http://localhost:3000"}}),true);
  assert.throws(()=>requireLocal(new Request("http://localhost:3000/api/stegavar/health",{headers:{host:"evil.test"}})));
});
test("asset delivery only serves published files and rewrites shared data URLs",async()=>{
  const data=await(await asset(["catalog.json"])).json();
  assert.equal(data.cases[0].scenes[0].base,"/api/stegavar/assets/rover-moving/surf");
  assert.equal((await asset(["rover-moving","surf","recovered","0000.png"])).headers.get("content-type"),"image/png");
  await assert.rejects(()=>asset(["..","..",".env"]));
  await assert.rejects(()=>asset(["rover-moving","surf","recovered","9999.png"]));
});
