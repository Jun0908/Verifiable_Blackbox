import assert from 'node:assert/strict';
const base = process.env.VBB_TEST_WEB_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local test server required');
for (const body of [{}, {jobId:'12', evidence:{jobId:'12'}}]) {
  const r=await fetch(`${base}/api/demo/rover/complete`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(r.status,409);
  assert.equal((await r.json()).error,'PHYSICAL_MOVEMENT_NOT_VERIFIED');
}
const badOrigin=await fetch(`${base}/api/demo/rover/control`, {method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.org'},body:JSON.stringify({action:'activate'})});
assert.equal(badOrigin.status,403);
for (const origin of [undefined, 'https://example.org']) {
  const response = await fetch(`${base}/api/demo/rover/review`, {method:'POST', headers:{'Content-Type':'application/json', ...(origin ? {Origin:origin} : {})}, body:JSON.stringify({jobId:'1',action:'verify-and-pay'})});
  assert.equal(response.status,origin?403:409);
  assert.equal((await response.json()).error,origin?'LOCAL_SAME_ORIGIN_REQUIRED':'SAME_ORIGIN_REQUIRED');
}
const invalidReview = await fetch(`${base}/api/demo/rover/review`, {method:'POST', headers:{'Content-Type':'application/json',Origin:base}, body:JSON.stringify({jobId:'0',action:'prepare'})});
assert.equal(invalidReview.status,409);
assert.equal((await invalidReview.json()).error,'INVALID_JOB_ID');
console.log('PASS: automatic robot payment blocked, foreign-origin control/review rejected, invalid review rejected, no physical movement claim.');
