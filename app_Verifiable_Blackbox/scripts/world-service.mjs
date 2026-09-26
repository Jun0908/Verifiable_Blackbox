import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';

// World is optional: a disclosure outage must not stop robot controls or payment.
export async function startLocalWorld({root, webEnv, launch}) {
  if (!webEnv.WORLD_SERVICE_URL) return;
  let base;
  try {base = new URL(webEnv.WORLD_SERVICE_URL);}
  catch {console.warn('World disclosure: invalid service URL.');return;}
  if (!['localhost','127.0.0.1'].includes(base.hostname)) return;
  let env;
  try {env = parseEnv(await readFile(resolve(root,'services/world-idp/.env'),'utf8'));}
  catch {console.warn('World disclosure: configure services/world-idp/.env to enable automatic startup.'); return;}
  if (env.WORLD_INTERNAL_TOKEN !== webEnv.WORLD_INTERNAL_TOKEN || env.BASE_URL !== webEnv.WORLD_PUBLIC_URL
    || Number(base.port || 80) !== Number(env.PORT || 8787) || !env.WORLD_APPROVER_OWNERS) {
    console.warn('World disclosure: settings or authorized owners are missing. Run services/world-idp/scripts/setup.mjs.');return;
  }
  const ready = async () => {
    try {
      const response = await fetch(new URL('/internal/health',base), {headers:{Authorization:`Bearer ${env.WORLD_INTERNAL_TOKEN}`}, signal:AbortSignal.timeout(1000)});
      if (!response.ok) return false;
      const status = await response.json();
      return status.ok && status.base === env.BASE_URL && status.ownersConfigured;
    } catch {return false;}
  };
  if (await ready()) {console.log('World disclosure: connected to the running service.');return;}
  const osNames = new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','COMSPEC']);
  const osEnv = Object.fromEntries(Object.entries(process.env).filter(([name])=>osNames.has(name.toUpperCase())));
  const service = launch(process.execPath,['server.mjs'],{cwd:resolve(root,'services/world-idp'),env:{...osEnv,...env}});
  const deadline = Date.now()+15000;
  while (Date.now()<deadline && service.child.exitCode === null) {
    if (await ready()) {console.log('World disclosure: service ready; keep its HTTPS tunnel running.');return;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  console.warn('World disclosure is unavailable. Robot controls and payments remain available.');
}
