import {erc8183Abi, expectedChallenge} from "@/lib/contracts";
import {decodeEventLog, type Hex} from "viem";
import {assertDemoAutomationEnabled, getDeployment, getPublicClient} from "@/lib/server/config";
import {getFundedDemoJob} from "@/lib/server/provider";
import {errorResponse} from "@/lib/server/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertDemoAutomationEnabled();
    const rawJobId = new URL(request.url).searchParams.get("jobId") ?? "";
    if (!/^[1-9][0-9]*$/.test(rawJobId)) throw new Error("jobId must be positive");
    const jobId = BigInt(rawJobId);
    const job = await getFundedDemoJob(jobId);
    const client=getPublicClient();
    if(job.expiredAt <= (await client.getBlock()).timestamp)throw Error('JOB_EXPIRED');
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
      status: "Funded",
      client: job.client,
      challenge: expectedChallenge(job.id, "success"),
    }, {
      headers: {"Cache-Control": "no-store"},
    });
  } catch (error) {
    return errorResponse(error, "Rover Job lookup failed");
  }
}

export async function POST() {
  // A drive command or motor setpoint is not evidence of physical movement.
  // Keep robot settlement closed until a physical-work verifier is implemented.
  return Response.json({ok: false, error: "PHYSICAL_MOVEMENT_NOT_VERIFIED", message: "Robot payment is paused: physical movement has not been verified."}, {status: 409});
}
