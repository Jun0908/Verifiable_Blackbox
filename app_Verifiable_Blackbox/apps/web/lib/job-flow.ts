export const DEMO_STORAGE_KEY = "vbb-demo-state-v3";
export type ActiveRobotJob = {jobId: string; createTransactionHash: string};

export function readActiveRobotJob(wallet: string): ActiveRobotJob | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) ?? "null");
    if (stored?.version !== 3 || stored.walletAddress?.toLowerCase() !== wallet.toLowerCase()
      || stored.job?.source !== "rover" || !/^[1-9][0-9]*$/.test(stored.job.jobId)
      || !/^0x[0-9a-f]{64}$/i.test(stored.job.createTransactionHash)) return;
    return {jobId: stored.job.jobId, createTransactionHash: stored.job.createTransactionHash};
  } catch {return;}
}

function operationKey(job: ActiveRobotJob) {
  return `vbb-control-ended:${job.createTransactionHash}:${job.jobId}`;
}
// This records only the end of a control session, never verified physical work.
export function recordControlEnded(job: ActiveRobotJob) {
  localStorage.setItem(operationKey(job), "ended");
}
export function controlHasEnded(job: ActiveRobotJob) {
  return localStorage.getItem(operationKey(job)) === "ended";
}
