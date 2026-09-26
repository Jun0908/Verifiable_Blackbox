import "server-only";
import {resolve} from "node:path";
import {erc8183Abi} from "@/lib/contracts";
import {ROVER_JOB_DESCRIPTION} from "@/lib/rover-session";
import {getDeployment, getPublicClient} from "../config";
import {RoverSessionStore} from "./store";

export function sessionStore() {
  const deployment = getDeployment();
  return new RoverSessionStore(resolve(/* turbopackIgnore: true */ process.env.ROVER_SESSION_DIR || resolve(process.cwd(), ".rover-sessions")),
    {chainId: deployment.chainId, core: deployment.erc8183});
}

// Session jobs use their dedicated payment gate.
export async function assertApprovalOnlyJob(jobId: bigint) {
  const deployment = getDeployment();
  const [record, job] = await Promise.all([
    sessionStore().read(jobId.toString()),
    getPublicClient().readContract({address: deployment.erc8183, abi: erc8183Abi, functionName: "getJob", args: [jobId]}),
  ]);
  if (record || job.description === ROVER_JOB_DESCRIPTION) throw Error("ROVER_SESSION_PAYMENT_REQUIRED");
}
