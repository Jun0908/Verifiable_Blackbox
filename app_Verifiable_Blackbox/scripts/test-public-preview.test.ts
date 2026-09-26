import test from "node:test";
import assert from "node:assert/strict";
import {GET as monthly} from "../apps/web/app/api/ledger/monthly/route.ts";
import {GET as csv} from "../apps/web/app/api/ledger/export/route.ts";
import {POST as refresh} from "../apps/web/app/api/ledger/refresh/route.ts";
import {requireLocal as stegavarGuard} from "../apps/web/lib/server/stegavar.ts";
import {publicPreview} from "../apps/web/lib/public-preview.ts";
const remote="https://preview.example";
test("sample data is available remotely only in the explicit public preview",async()=>{
 const result=await monthly(new Request(remote+"/api/ledger/monthly?period=2026-09"));
 assert.equal(result.status,publicPreview?200:403);
 if(publicPreview){const data=await result.json();assert.equal(data.source,"sample");assert.ok(data.usageCount>0);}
 assert.equal((await monthly(new Request("http://localhost:3000/api/ledger/monthly?period=2026-09"))).status,200);
});
test("sample CSV export and empty month retain their local behavior",async()=>{
 for(const host of ["http://localhost:3000",...(publicPreview?[remote]:[])]){
  const result=await csv(new Request(host+"/api/ledger/export?period=2026-09&kind=details"));
  assert.equal(result.status,200);assert.match(result.headers.get("content-disposition")!,/sample-2026-09-details/);
  assert.match(await result.text(),/sample/);
  const empty=await monthly(new Request(host+"/api/ledger/monthly?period=2020-01"));
  assert.equal((await empty.json()).usageCount,0);
  assert.equal((await monthly(new Request(host+"/api/ledger/monthly?period=invalid"))).status,400);
 }
});
test("public preview does not open live ledger or analysis access",async()=>{
 assert.equal((await refresh(new Request(remote+"/api/ledger/refresh",{method:"POST"}))).status,403);
 assert.throws(()=>stegavarGuard(new Request(remote+"/api/stegavar/analyze",{method:"POST",headers:{origin:remote}}),true));
 stegavarGuard(new Request("http://localhost:3000/api/stegavar/analyze",{method:"POST",headers:{origin:"http://localhost:3000"}}),true);
});
