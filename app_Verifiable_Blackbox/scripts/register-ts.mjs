import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const web=resolve(import.meta.dirname,'../apps/web');
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='server-only')return {url:'data:text/javascript,export {};',shortCircuit:true};
  const path=specifier.startsWith('@/')?resolve(web,specifier.slice(2)):specifier.startsWith('.')&&context.parentURL?.startsWith('file:')?resolve(dirname(fileURLToPath(context.parentURL)),specifier):null;
  if(path&&existsSync(path+'.ts'))return {url:pathToFileURL(path+'.ts').href,shortCircuit:true};
  return nextResolve(specifier,context);
}});
