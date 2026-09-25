import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
export async function freePort(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', () => reject(Error(`Port ${port} is already in use`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
export function launch(command, args, options = {}) {
  const child = spawn(command, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options});
  let output = ''; child.failure = null;
  child.stdout?.on('data', d => {output = (output + d).slice(-20000);});
  child.stderr?.on('data', d => {output = (output + d).slice(-20000);});
  child.on('error', e => {child.failure = e;});
  child.output = () => output;
  return child;
}
export async function run(command, args, options = {}) {
  const child = launch(command, args, options);
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`Command failed (${code}): ${child.output()}`)));
  });
  return child.output();
}
export async function ready(child, check) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.failure || child.exitCode !== null) throw Error('Local test process failed to start');
    try {return await check();} catch {await new Promise(r => setTimeout(r, 200));}
  }
  throw Error('Local test process readiness timeout');
}
export async function stop(child) {
  if (child && child.exitCode === null && !child.failure) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
  }
}
