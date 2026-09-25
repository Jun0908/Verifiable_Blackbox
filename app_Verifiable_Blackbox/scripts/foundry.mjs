import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const [tool = 'forge', ...args] = process.argv.slice(2);
if (!['forge', 'anvil', 'cast'].includes(tool)) throw Error('Unknown Foundry tool');
const local = resolve(import.meta.dirname, '..', '.tools/foundry-v1.7.1', tool + (process.platform === 'win32' ? '.exe' : ''));
const result = spawnSync(existsSync(local) ? local : tool, args, {stdio: 'inherit', windowsHide: true});
if (result.error) console.error(`Install Foundry v1.7.1; see docs/DEPENDENCIES.md. ${result.error.message}`);
process.exitCode = result.status ?? 1;
