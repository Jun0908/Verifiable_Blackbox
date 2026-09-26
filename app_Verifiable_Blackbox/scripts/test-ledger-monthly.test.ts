import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateUsage, summarize, monthlyCsv, csvCell, monthInTokyo, formatAmount} from "../apps/web/lib/ledger/monthly-demo.ts";
const rows = validateUsage(JSON.parse(readFileSync(new URL("../apps/web/lib/ledger/monthly-sample.json", import.meta.url), "utf8")));
test("120明細は3社各40件・4.00、全体12.00に集計される",()=>{
  const summary=summarize(rows,"2026-09");
  assert.equal(summary.usageCount,120);assert.equal(summary.counterpartyCount,3);assert.equal(summary.amountMinor,"12000000");
  assert.equal(summary.amountDisplay,"12.00");assert.ok(summary.groups.every(g=>g.usageCount===40&&g.amountDisplay==="4.00"));
});
test("JST月境界とデータなしの月",()=>{
  assert.equal(monthInTokyo("2026-08-31T14:59:59Z"),"2026-08");assert.equal(monthInTokyo("2026-08-31T15:00:00Z"),"2026-09");
  assert.equal(summarize(rows,"2026-08").amountMinor,"0");assert.throws(()=>summarize(rows,"2026-99"));
});
test("集計に浮動小数点誤差がなく、小さい端数も保持",()=>{
  const altered=rows.slice(0,2).map((r,i)=>({...r,amountMinor:i===0?"9007199254740993":"1"}));
  assert.equal(summarize(altered,"2026-09").amountMinor,"9007199254740994");assert.equal(formatAmount("1"),"0.000001");assert.equal(formatAmount("100000"),"0.10");
});
test("サンプルへの実取引混入・重複・負数を拒否",()=>{
  assert.throws(()=>validateUsage([...rows,rows[0]]));assert.throws(()=>validateUsage([{...rows[0],source:"multibaas"}]));assert.throws(()=>validateUsage([{...rows[0],amountMinor:"-1"}]));
});
test("CSVの集計と明細に安定ID・sample区分・正確な金額を出力",()=>{
  const summary=monthlyCsv(rows,"2026-09","summary"),details=monthlyCsv(rows,"2026-09","details");
  assert.ok(summary.startsWith("\uFEFF"));assert.equal(summary.trim().split("\r\n").length,4);assert.equal(details.trim().split("\r\n").length,121);
  assert.ok(details.includes('"sample-202609-001"'));assert.ok(summary.includes('"4000000","4.00"'));assert.equal((details.match(/"sample",/g)||[]).length,120);
  assert.equal(details,monthlyCsv(rows,"2026-09","details"));
});
test("CSVの引用符・改行をエスケープし数式解釈を防止",()=>{
  assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.ok(csvCell('  @SUM(1)').startsWith('"\''));
});
