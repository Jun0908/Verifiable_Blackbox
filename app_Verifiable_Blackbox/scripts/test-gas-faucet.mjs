// Isolated fake Sepolia on Anvil. No .env, live RPC, or real role keys are loaded.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {createPublicClient, createWalletClient, defineChain, http, keccak256, parseEther} from 'viem';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';

const root=resolve(import.meta.dirname,'..');
const probe=createServer();
await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port;
await new Promise(r=>probe.close(r));
const rpc=`http://127.0.0.1:${port}`;
const poolKey='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const pool=privateKeyToAccount(poolKey);
await mkdir(resolve(root,'tmp'),{recursive:true});
const directory=await mkdtemp(resolve(root,'tmp/gas-test-'));
const chain=defineChain({id:11155111,name:'Isolated test',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport:http(rpc)});
const wallet=createWalletClient({account:pool,chain,transport:http(rpc)});
const localAnvil=resolve(root,'.tools/foundry-v1.7.1',process.platform==='win32'?'anvil.exe':'anvil');
const anvil=spawn(existsSync(localAnvil)?localAnvil:'anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','11155111','--silent'],{stdio:'ignore',windowsHide:true});
anvil.on('error',error=>{throw error;});
try {
  let ready=false;
  for(let i=0;i<60;i++) {
    try {assert.equal(await client.getChainId(),11155111);ready=true;break;} catch {await new Promise(r=>setTimeout(r,100));}
  }
  assert.ok(ready,'Anvil must start');
  Object.assign(process.env,{NEXT_PUBLIC_CHAIN_ID:'11155111',NEXT_PUBLIC_RPC_URL:rpc,DEMO_RPC_URL:rpc,
    ALLOW_PUBLIC_DEMO_AUTOMATION:'true',DEMO_GAS_FAUCET_ENABLED:'true',DEMO_GAS_FAUCET_PRIVATE_KEY:poolKey,DEMO_GAS_DIR:directory,
    MOCK_USDC_ADDRESS:pool.address,ERC8183_ADDRESS:pool.address,EVIDENCE_HOOK_ADDRESS:pool.address,EVALUATOR_ADDRESS:pool.address,
    DEMO_PROVIDER_ADDRESS:pool.address,DEMO_RELAYER_ADDRESS:pool.address,DEMO_TEE_SIGNER_ADDRESS:pool.address});
  process.chdir(resolve(root,'apps/web'));
  const {GET,POST}=await import('../apps/web/app/api/demo/faucet/route.ts');
  const origin='http://127.0.0.1:3000';
  const url='http://localhost:3000/api/demo/faucet';
  const status=async address=>{
    const response=await GET(new Request(url+'?address='+address,{headers:{Host:'127.0.0.1:3000'}}));
    assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const request=body=>POST(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Host:'127.0.0.1:3000',Origin:origin},body:JSON.stringify(body)}));
  const claim=async account=>{
    const info=await status(account.address);
    return {address:account.address,day:info.day,signature:await account.signMessage({message:info.message})};
  };
  const user=privateKeyToAccount(generatePrivateKey());
  const stranger=privateKeyToAccount(generatePrivateKey());
  const initial=await status(user.address);
  assert.equal(initial.balanceWei,'0');assert.equal(initial.available,true);
  const signed=await claim(user);
  assert.equal((await request({address:user.address})).status,400);
  assert.equal((await request({...signed,address:stranger.address})).status,400);
  assert.equal((await request({...signed,day:'2000-01-01'})).status,400);
  const foreign=await POST(new Request(url,{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify(signed)}));
  assert.equal(foreign.status,400);
  assert.equal(await client.getBalance({address:user.address}),0n);

  process.env.DEMO_GAS_FAUCET_ENABLED='false';
  assert.equal((await status(user.address)).reason,'disabled');
  assert.equal((await request(signed)).status,400);
  process.env.DEMO_GAS_FAUCET_ENABLED='true';
  const poolBefore=await client.getBalance({address:pool.address});
  await client.request({method:'anvil_setBalance',params:[pool.address,'0x0']});
  assert.equal((await status(user.address)).reason,'pool-empty');
  assert.equal((await request(signed)).status,400);
  await client.request({method:'anvil_setBalance',params:[pool.address,'0x'+poolBefore.toString(16)]});
  process.env.NEXT_PUBLIC_CHAIN_ID='1';
  assert.equal((await request(signed)).status,400);
  process.env.NEXT_PUBLIC_CHAIN_ID='11155111';

  const paid=await request(signed);
  assert.equal(paid.status,200,await paid.clone().text());
  const result=await paid.json();assert.equal(result.ready,true);
  assert.equal((await client.getTransactionReceipt({hash:result.gasTransactionHash})).status,'success');
  const nonce=await client.getTransactionCount({address:pool.address});
  const replay=await request(signed);assert.equal(replay.status,200);
  assert.equal((await replay.json()).gasTransactionHash,result.gasTransactionHash);
  assert.equal(await client.getTransactionCount({address:pool.address}),nonce);
  await client.request({method:'anvil_setBalance',params:[user.address,'0x0']});
  assert.equal((await status(user.address)).reason,'daily-limit');
  assert.equal((await request(signed)).status,400);

  const a=privateKeyToAccount(generatePrivateKey()), b=privateKeyToAccount(generatePrivateKey());
  const [sa,sb]=await Promise.all([claim(a),claim(b)]);
  const concurrent=await Promise.all([request(sa),request(sb)]);
  assert.equal(concurrent.filter(r=>r.status===200).length,1,'Serialize funding across recipients');
  assert.equal(await client.getTransactionCount({address:pool.address}),nonce+1);

  // Simulate a restart after saving signed bytes but before broadcast; recover that exact transaction.
  const path=resolve(directory,`11155111-${pool.address.toLowerCase()}`,'ledger.json');
  const ledger=JSON.parse(await readFile(path,'utf8'));
  const recipient=privateKeyToAccount(generatePrivateKey());
  const requestBody=await claim(recipient);
  const raw=await wallet.signTransaction(await wallet.prepareTransactionRequest({to:recipient.address,value:parseEther('0.003')}));
  const hash=keccak256(raw);
  ledger.claims.push({day:requestBody.day,address:recipient.address,amount:parseEther('0.003').toString(),hash,raw,state:'pending'});
  await writeFile(path,JSON.stringify(ledger));
  assert.equal((await status(recipient.address)).reason,'pending');
  const recovered=await request(requestBody);assert.equal(recovered.status,200,await recovered.clone().text());
  assert.equal((await recovered.json()).gasTransactionHash,hash);
  assert.equal(await client.getTransactionCount({address:pool.address}),nonce+2);
  const full=JSON.parse(await readFile(path,'utf8'));
  full.claims.push({...full.claims[0],address:stranger.address,amount:parseEther('0.05').toString()});
  await writeFile(path,JSON.stringify(full));
  const overBudget=privateKeyToAccount(generatePrivateKey());
  assert.equal((await status(overBudget.address)).reason,'budget-limit');
  assert.equal((await request(await claim(overBudget))).status,400);
  await client.request({method:'anvil_setChainId',params:[1]});
  assert.equal((await request(signed)).status,400,'Reject RPC on wrong chain even with Sepolia config');
  await client.request({method:'anvil_setChainId',params:[31337]});
  process.env.NEXT_PUBLIC_CHAIN_ID='31337';
  const local=privateKeyToAccount(generatePrivateKey());
  const localResponse=await request({address:local.address});
  assert.equal(localResponse.status,200,await localResponse.clone().text());
  assert.equal(await client.getBalance({address:local.address}),parseEther('1'));
  console.log(JSON.stringify({ok:true,checks:['zero-balance wallet funding','signature/address/day/origin validation','disabled/empty/wrong-chain rejection','receipt and replay idempotency','daily wallet limit','concurrent nonce protection','persisted signed-transaction recovery','daily global budget','Anvil faucet compatibility'],liveTransactionsSent:false}));
} finally {
  anvil.kill();
}
