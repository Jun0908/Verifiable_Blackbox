import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createLocalJWKSet, exportJWK, generateKeyPair, SignJWT} from "jose";
import {toHex, type Address} from "viem";
import {verifyPrivyOwner} from "../apps/web/lib/server/rover-session/owner.ts";
import {roverPaymentBundle} from "../apps/web/lib/server/rover-session/payment-gate.ts";
import {roverHash, type RoverSessionContext, type RoverSessionRecord} from "../apps/web/lib/rover-session.ts";

const owner = toHex(1, {size:20}) as Address;
test("Privy login proves the Job wallet without a personal_sign request", async () => {
  const {privateKey, publicKey} = await generateKeyPair("ES256");
  const keys = createLocalJWKSet({keys:[{...await exportJWK(publicKey), kid:"test", alg:"ES256"}]});
  const sign = (aud="test-app", exp: number | string="5m") => new SignJWT({}).setProtectedHeader({alg:"ES256",kid:"test"})
    .setIssuer("privy.io").setAudience(aud).setSubject("did:privy:test-owner").setIssuedAt().setExpirationTime(exp).sign(privateKey);
  let calls=0;
  const remote = async (url: string | URL | Request, init?: RequestInit) => {
    calls++; assert.equal(url,"https://auth.privy.io/api/v1/users/me");
    assert.equal((init!.headers as Record<string,string>)["privy-app-id"],"test-app");
    return Response.json({user:{id:"did:privy:test-owner",linked_accounts:[{type:"wallet",chain_type:"ethereum",address:owner}]}});
  };
  await verifyPrivyOwner(await sign(),"test-app",owner,keys,remote as typeof fetch);
  assert.equal(calls,1);
  await assert.rejects(verifyPrivyOwner(await sign("other-app"),"test-app",owner,keys,remote as typeof fetch),/LOGIN_TOKEN_INVALID/);
  await assert.rejects(verifyPrivyOwner(await sign("test-app",1),"test-app",owner,keys,remote as typeof fetch),/LOGIN_TOKEN_INVALID/);
  assert.equal(calls,1);
  await assert.rejects(verifyPrivyOwner(await sign(),"test-app",toHex(2,{size:20}),keys,remote as typeof fetch),/JOB_OWNER_REQUIRED/);
  await assert.rejects(verifyPrivyOwner(await sign(),"test-app",owner,keys,async()=>Response.json({user:{id:"did:privy:other",linked_accounts:[]}})),/JOB_OWNER_REQUIRED/);
  await assert.rejects(verifyPrivyOwner(await sign(),"test-app",owner,keys,async()=>{throw Error("offline");}),/LOGIN_CHECK_UNAVAILABLE/);
});

test("signed Privy identity binds the wallet to the access-token user without a remote user lookup", async () => {
  const {privateKey,publicKey}=await generateKeyPair("ES256");
  const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:"test",alg:"ES256"}]});
  const sign=(claims:Record<string,unknown>,sub="did:privy:owner",aud="test-app",exp:number|string="5m")=>new SignJWT(claims)
    .setProtectedHeader({alg:"ES256",kid:"test"}).setIssuer("privy.io").setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  const claims={linked_accounts:JSON.stringify([{type:"wallet",chain_type:"ethereum",address:owner}])};
  const access=await sign({});
  const offline=async()=>{throw Error("must not fetch user");};
  await verifyPrivyOwner(access,"test-app",owner,keys,offline,await sign(claims));
  await assert.rejects(verifyPrivyOwner(access,"test-app",owner,keys,offline,await sign(claims,"did:privy:other")),/LOGIN_IDENTITY_INVALID/);
  await assert.rejects(verifyPrivyOwner(access,"test-app",owner,keys,offline,await sign(claims,"did:privy:owner","other-app")),/LOGIN_IDENTITY_INVALID/);
  await assert.rejects(verifyPrivyOwner(access,"test-app",owner,keys,offline,await sign(claims,"did:privy:owner","test-app",1)),/LOGIN_IDENTITY_INVALID/);
  await assert.rejects(verifyPrivyOwner(access,"test-app",toHex(2,{size:20}),keys,offline,await sign(claims)),/JOB_OWNER_REQUIRED/);
});

test("manual Forward press pays before recording finishes and freezes payment evidence", async () => {
  const r=record(),now=Date.now()/1000;
  r.context.controlMode="manual";r.buttonAuthorization!.contextHash=roverHash(r.context);
  r.phase="OPERATING";
  r.buttonAuthorization!.pressedAt=now;
  const bundle=await roverPaymentBundle(r,now);
  assert.equal(bundle.forwardPressed,true);
  r.payment={phase:"VERIFYING",bundle,evidence:{} as NonNullable<RoverSessionRecord["payment"]>["evidence"]};
  r.phase="CAPTURED";r.analysis={...bundle.video,judgment:"MOVING",execution:"ANALYZED"};
  assert.deepEqual(await roverPaymentBundle(r,now+1),bundle);
  delete r.buttonAuthorization!.pressedAt;
  await assert.rejects(roverPaymentBundle(r,now),/FORWARD_PRESS_REQUIRED/);
});

function record(): RoverSessionRecord {
  const now=Math.floor(Date.now()/1000);
  const options={judgmentMode:"VIDEO" as const,operation:"FORWARD" as const,durationMs:3000,speed:35};
  const context: RoverSessionContext={version:1,paymentPolicy:"forward-button-v1",chainId:31337,core:owner,evaluator:owner,token:owner,
    jobId:"1",client:owner,provider:owner,budget:"100000000",jobExpiresAt:String(now+3600),sessionId:randomUUID(),nonce:toHex(1,{size:32}),
    issuedAt:now-10,expiresAt:now+3600,options,camera:"external-fixed",cameraUrl:"",policyHash:roverHash({}),conditionsHash:roverHash({})};
  return {context,phase:"ERROR",error:"BRIDGE_UNAVAILABLE",buttonAuthorization:{policy:"forward-button-v1",contextHash:roverHash(context),
    owner,authenticatedAt:new Date().toISOString(),pressedAt:now-1}};
}
test("one recorded button press pays without duration, video success or a stop response", async () => {
  const r=record(), now=Math.floor(Date.now()/1000);
  const bundle=await roverPaymentBundle(r,now);
  assert.equal(bundle.forwardPressed,true); assert.equal(bundle.authorizationSignature,null);
  assert.equal(bundle.video.judgment,"INCONCLUSIVE"); assert.equal(bundle.video.execution,"UNAVAILABLE");
  r.analysis={...bundle.video,judgment:"STILL",reason:null,execution:"ANALYZED"};
  assert.equal((await roverPaymentBundle(r,now)).video.judgment,"STILL");
  delete r.buttonAuthorization!.pressedAt;
  await assert.rejects(roverPaymentBundle(r,now),/FORWARD_PRESS_REQUIRED/);
});
test("button payment rejects a changed Job context and preserves payment evidence after video arrives", async () => {
  const r=record(), now=Math.floor(Date.now()/1000), bundle=await roverPaymentBundle(r,now);
  r.context.jobId="2";
  await assert.rejects(roverPaymentBundle(r,now),/SESSION_CONTEXT_CHANGED/);
  r.context.jobId="1";
  r.phase="OPERATING";
  await assert.rejects(roverPaymentBundle(r,now),/RUN_NOT_FINISHED/);
  r.phase="ERROR";
  r.payment={phase:"VERIFYING",bundle,evidence:{} as NonNullable<RoverSessionRecord["payment"]>["evidence"]};
  r.analysis={...bundle.video,judgment:"MOVING",execution:"ANALYZED",reason:null};
  assert.deepEqual(await roverPaymentBundle(r,now),bundle);
  await assert.rejects(roverPaymentBundle(r,now+4000),/JOB_EXPIRED/);
});
