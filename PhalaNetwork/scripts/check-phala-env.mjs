import { checkPhalaEnvironment } from '../dist/cloud-config.js';
try {
  const p = checkPhalaEnvironment(process.env);
  console.log(JSON.stringify({ok:true,chainId:p.config.chainId,image:p.image,cvmId:p.cvmId,cliVersion:p.cliVersion,
    instanceType:p.instanceType,diskSize:p.diskSize,evaluator:p.config.evaluatorAddress,keyPath:p.config.dstackKeyPath}));
} catch(e) {
  console.error(JSON.stringify({ok:false,reason:e.message.startsWith('Invalid configuration:') ? e.message : 'PREFLIGHT_FAILED'})); process.exitCode=1;
}
