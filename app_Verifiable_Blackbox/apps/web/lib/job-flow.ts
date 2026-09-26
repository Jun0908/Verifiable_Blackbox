import type {JobHistoryScope} from './job-history';
import {loadDemoState} from './active-job';
export const DEMO_STORAGE_KEY = 'vbb-active-job-v1:';
export type ActiveRobotJob = JobHistoryScope & {jobId:string;createTransactionHash:string};
export function readActiveRobotJob(scope:JobHistoryScope):ActiveRobotJob|undefined {
  const stored=loadDemoState(scope);
  if(!stored || stored.job.source!=='rover')return;
  return {...scope,jobId:stored.job.jobId,createTransactionHash:stored.job.createTransactionHash};
}
function operationKey(job:ActiveRobotJob) {
  return `vbb-control-ended:${job.chainId}:${job.core.toLowerCase()}:${job.wallet.toLowerCase()}:${job.createTransactionHash}:${job.jobId}`;
}
// A control-session marker never claims verified physical movement or payment.
export function recordControlEnded(job:ActiveRobotJob) {localStorage.setItem(operationKey(job),'ended');}
export function controlHasEnded(job:ActiveRobotJob) {return localStorage.getItem(operationKey(job))==='ended';}
