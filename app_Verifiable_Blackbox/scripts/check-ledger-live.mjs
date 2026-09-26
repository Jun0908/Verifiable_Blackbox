import {loadEnvFile} from 'node:process';
import {resolve} from 'node:path';
import {settings} from '../apps/web/lib/server/curvegrid/config.ts';
import {LedgerState} from '../apps/web/lib/server/curvegrid/state.ts';
import {safeError} from '../apps/web/lib/server/curvegrid/fetch.ts';
try {
  loadEnvFile(resolve(import.meta.dirname,'../.env'));
  const state=new LedgerState(settings(),resolve(import.meta.dirname,'../apps/web/.ledger'));
  await state.load();await state.refresh();
  const view=state.publicState();
  console.log(JSON.stringify({state:view.state,error:view.error,source:view.source,fetchedAt:view.fetchedAt,range:view.range,
    payments:view.payments.map(p=>({jobId:p.jobId,status:p.status,amount:p.amountDisplay,tx:p.txHash})),total:view.totalMinor,matched:view.matchedMinor}));
  if(view.state!=='live'||!view.payments.length||view.payments.some(p=>p.status!=='matched'))process.exitCode=1;
} catch(error) {console.error(safeError(error));process.exitCode=1;}
