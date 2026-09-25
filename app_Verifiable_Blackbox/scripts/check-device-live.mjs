// Read-only: verifies a saved signature; never contacts the robot or sends a transaction.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createPublicClient,http} from 'viem';
import {resolveEnsPublicKey} from '../parts/device-signature/ens.mjs';
import {verifyDeviceSignature,verifyERC7913} from '../parts/device-signature/signature.mjs';
import {renderReport} from '../parts/device-signature/report.mjs';
try {
 if(!process.env.VBB_SAVED_SIGNATURE)throw Error('SAVED_SIGNATURE_PATH_REQUIRED');
 const rpc=process.env.DEMO_RPC_URL || process.env.SEPOLIA_RPC_URL;
 if(!rpc)throw Error('SERVER_RPC_REQUIRED');
 const ens=await resolveEnsPublicKey({name:'vbb-rover-001.eth',rpcUrl:rpc});
 const saved=JSON.parse(await readFile(process.env.VBB_SAVED_SIGNATURE,'utf8'));
 const record=verifyDeviceSignature(saved,ens.publicKey,{chainId:saved.chainId,core:saved.core,jobId:saved.jobId});
 const result=await verifyERC7913(createPublicClient({transport:http(rpc,{timeout:10000,retryCount:0})}),'0xfD789267D20c5124FA6718D15faa0EF47A5EF13f',record);
 const dir=new URL('../parts/device-signature/local/',import.meta.url);await mkdir(dir,{recursive:true});
 await writeFile(new URL('saved-live-report.html',dir),renderReport(record,result,{ens,signatureSource:'saved'}));
 console.log(JSON.stringify({ok:true,source:'saved signature, no fresh hardware response',ens:ens.name,block:ens.blockNumber,chain:record.chainId,job:record.jobId,p256:'verified',erc7913:result.status,payment:'not queried or changed'}));
}catch(error){console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'LIVE_DEVICE_READ_CHECK_FAILED');process.exitCode=1;}
