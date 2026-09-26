import {erc8183Abi, expectedChallenge} from "@/lib/contracts";
import {decodeEventLog, type Hex} from "viem";
import {assertDemoAutomationEnabled, getDeployment, getPublicClient} from "@/lib/server/config";
import {errorResponse} from "@/lib/server/response";
import {completeRoverSession} from "@/lib/server/rover-session/payment";
import {sessionFailure, sessionRequest, sessionResponse} from "@/lib/server/rover-session/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const rawJobId = new URL(request.url).searchParams.get("jobId") ?? "";
    if (!/^[1-9][0-9]*$/.test(rawJobId)) throw new Error("jobId must be positive");
    const jobId = BigInt(rawJobId);
    const client=getPublicClient();
    const deployment = getDeployment();
    const job = await client.readContract({address: deployment.erc8183, abi: erc8183Abi, functionName: "getJob", args: [jobId]});
    if (job.id !== jobId || ![1, 2, 3].includes(job.status)) throw Error("JOB_NOT_AVAILABLE");
    if (job.provider.toLowerCase() !== deployment.provider.toLowerCase() || job.evaluator.toLowerCase() !== deployment.evaluator.toLowerCase()
      || job.hook.toLowerCase() !== deployment.evidenceHook.toLowerCase()) throw Error("JOB_CONTEXT_MISMATCH");
    if(job.status !== 3 && job.expiredAt <= (await client.getBlock()).timestamp)throw Error('JOB_EXPIRED');
    const hash=new URL(request.url).searchParams.get('createTx');
    if(hash) {
      if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('INVALID_CREATION_TRANSACTION');
      const receipt=await client.getTransactionReceipt({hash:hash as Hex});
      const core=getDeployment().erc8183;
      const matched=receipt.status==='success' && receipt.logs.some(log=>{
        if(log.address.toLowerCase()!==core.toLowerCase())return false;
        try {const event=decodeEventLog({abi:erc8183Abi,data:log.data,topics:log.topics});return event.eventName==='JobCreated' && event.args.jobId===jobId && event.args.client.toLowerCase()===job.client.toLowerCase();}catch{return false;}
      });
      if(!matched)throw Error('CREATION_TRANSACTION_MISMATCH');
    }
    return Response.json({
      ok: true,
      jobId: job.id.toString(),
      status: ({1: "Funded", 2: "Submitted", 3: "Completed"} as Record<number, string>)[job.status],
      client: job.client,
      challenge: expectedChallenge(job.id, "success"),
    }, {
      headers: {"Cache-Control": "no-store"},
    });
  } catch (error) {
    return errorResponse(error, "Rover Job lookup failed");
  }
}

export async function POST(request: Request) {
  try {
    const body = await sessionRequest(request);
    if (Object.keys(body).some(key => !["jobId", "sessionId", "signature"].includes(key))) throw Error("INVALID_SESSION_REQUEST");
    return sessionResponse(await completeRoverSession(body.jobId, body.sessionId, body.signature));
  } catch (error) {return sessionFailure(error);}
}
