import { resolve } from 'node:path';
import { freePort, run } from './local-process.mjs';
const root = resolve(import.meta.dirname,'..');
const app = resolve(process.env.APP_PROJECT_ROOT || resolve(root,'../app_Verifiable_Blackbox'));
for (const port of [8547,3107,3108]) await freePort(port);
const env = {...process.env, PHALA_PROJECT_ROOT:root, HOST:'127.0.0.1'};
delete env.DSTACK_SIMULATOR_ENDPOINT;
console.log(await run(process.execPath,[resolve(app,'scripts/foundry.mjs'),'forge','build'],{cwd:app,env}));
console.log(await run(process.execPath,['--experimental-transform-types',resolve(app,'scripts/test-demo-review.mjs')],{cwd:app,env}));
