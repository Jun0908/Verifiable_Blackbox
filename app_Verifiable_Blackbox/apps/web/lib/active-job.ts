import type {JobHistoryScope, ScenarioResult, StoredDemoStateV3} from "./job-history";

export function activeJobKey(scope:JobHistoryScope) {
  return `vbb-active-job-v1:${scope.chainId}:${scope.core.toLowerCase()}:${scope.wallet.toLowerCase()}`;
}
export function loadDemoState(scope?:JobHistoryScope):StoredDemoStateV3|undefined {
  if(!scope)return;
  try {
    const stored=JSON.parse(localStorage.getItem(activeJobKey(scope))||'null');
    if(stored?.version!==3 || stored.walletAddress?.toLowerCase()!==scope.wallet.toLowerCase()
      || !/^[1-9][0-9]*$/.test(stored.job?.jobId??'')
      || !/^0x[0-9a-f]{64}$/i.test(stored.job?.createTransactionHash??'')
      || !['fixture','rover'].includes(stored.job?.source))return;
    return stored;
  } catch {return;}
}
export function storeDemoState(scope:JobHistoryScope|undefined,job:ScenarioResult,extras:Pick<StoredDemoStateV3,'verified'|'verifier'|'verdictSignature'|'completeTransactionHash'>) {
  if(!scope)throw Error('WALLET_SCOPE_REQUIRED');
  const previous=loadDemoState(scope);
  const same=previous?.job.jobId===String(job.jobId)&&previous.job.createTransactionHash===job.createTransactionHash;
  const stored:StoredDemoStateV3={...(same?previous:{}),version:3,walletAddress:scope.wallet,job:{...job,jobId:String(job.jobId)},...extras};
  localStorage.setItem(activeJobKey(scope),JSON.stringify(stored));
}
