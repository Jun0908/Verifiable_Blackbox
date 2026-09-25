// Simulation only: no device/network client is imported or contacted.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const jpeg=readFileSync(new URL('./fixtures/camera.jpg',import.meta.url));
const token=process.env.VBB_BRIDGE_TOKEN;
if(!token || token.length<32)throw Error('Launch through local-stack.mjs');
let session,sequence=-1,state='idle',motors=[0,0,0,0],deadline=0,paused=false;
let camera={url:'simulation://test-pattern',configured:true,enabled:false,receiving:false};
const snapshot=()=>({ok:true,simulated:true,state,message:'SIMULATED BRIDGE · No hardware connected',telemetryFresh:['ready','commanding'].includes(state),controlPaused:paused,motorsRunning:motors.some(Boolean),motors,rssi:null,physicalMovementVerified:false,paymentEnabled:false});
const halt=()=>{motors=[0,0,0,0];state='idle';paused=false;};
setInterval(()=>{if(state==='commanding'&&Date.now()>deadline){motors=[0,0,0,0];state='ready';paused=true;}},50).unref();
const server=createServer(async(req,res)=>{
 const reply=(code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
 if(req.headers.authorization!==`Bearer ${token}`)return reply(403,{error:'Forbidden'});
 try {
  if(req.method==='GET'){
   if(req.url==='/status')return reply(200,snapshot());
   if(req.url==='/camera')return reply(200,camera);
   if(req.url==='/camera/frame'){
    if(!camera.enabled || camera.url==='simulation://offline'){res.writeHead(204,{'cache-control':'no-store'});return res.end();}
    res.writeHead(200,{'content-type':'image/jpeg','cache-control':'no-store','x-camera-frame':camera.url==='simulation://stale'?'frozen':String(Date.now())});return res.end(jpeg);
   }
   return reply(404,{error:'Not found'});
  }
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048)throw Error('Request too large');}
  const body=JSON.parse(raw);
  if(req.url==='/camera'){camera.url=body.url;return reply(200,camera);}
  if(req.url==='/camera/power'){camera.enabled=body.enabled;return reply(200,camera);}
  if(req.url==='/activate'){
   if(state!=='idle')throw Error('Session already active');
   session=randomUUID();sequence=-1;state='ready';paused=false;return reply(200,{...snapshot(),session});
  }
  if(body.session!==session)throw Error('Invalid session');
  if(req.url==='/stop'){halt();return reply(200,snapshot());}
  if(!['ready','commanding'].includes(state))throw Error('Session ended');
  if(!Number.isSafeInteger(body.sequence)||body.sequence<=sequence)throw Error('Stale command');
  sequence=body.sequence;
  if(req.url==='/release'){motors=[0,0,0,0];state='ready';paused=false;return reply(200,snapshot());}
  if(paused)throw Error('Controls paused');
  if(req.url==='/drive'){
   if(![35,60,85].includes(body.speed)||!['forward','back','left','right','turn-left','turn-right'].includes(body.direction))throw Error('Invalid drive');
   motors=[body.speed,body.speed,body.speed,body.speed];
  }else if(req.url==='/gripper'){
   if(!['open','close'].includes(body.action))throw Error('Invalid gripper');motors=[0,0,0,0];
  }else throw Error('Unknown action');
  state='commanding';deadline=Date.now()+450;return reply(200,snapshot());
 }catch(error){reply(400,{error:error.message});}
});
server.listen(Number(process.env.VBB_BRIDGE_PORT||8765),'127.0.0.1',()=>console.log('SIMULATED Rover bridge ready; no hardware connection.'));
