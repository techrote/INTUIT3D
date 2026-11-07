#!/usr/bin/env node
/**
 * Actual Chromium/React pairing, revision-fence and file download interaction.
 * HTTP responder is an EXPLICIT SYNTHETIC TEST DOUBLE, not native OCCT evidence.
 * The real OCP bridge runs separately via scripts/local-native-host.mjs.
 * No Playwright dependency: local Vite preview + Chrome DevTools Protocol.
 */
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';

const origin='http://127.0.0.1:4173';
const token='b'.repeat(64);
const artifacts=process.env.INTUIT3D_HANDLE_ARTIFACTS||'apps/web/browser-evidence-handles';
const home=mkdtempSync(join(tmpdir(),'intuit3d-native-browser-'));
const children=[];const pending=new Map();const exceptions=[];
let ws,seq=0,requests=0,host;
const check=(ok,why)=>{if(!ok)throw Error(why);};
const eventually=async(fn,why,tries=90)=>{
  for(let i=0;i<tries;i++){try{const found=await fn();if(found)return found;}catch{}await pause(150);}
  throw Error('Timed out: '+why);
};
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const browser=()=>{
  for(const name of ['chromium','google-chrome','chromium-browser']){
    const p=spawnSync('which',[name],{encoding:'utf8'});
    if(p.status===0&&p.stdout.trim())return p.stdout.trim();
  }
  throw Error('Chromium not installed; graphical gate not executed');
};
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
const evaluate=async(expression)=>{
  const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));
  return reply.result?.value;
};
const screenshot=async(name)=>{
  const frame=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(join(artifacts,name),Buffer.from(frame.data,'base64'));
};
const key=async(name,code,virtualKey)=>{
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:virtualKey});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:virtualKey});
};
async function main(){
  mkdirSync(artifacts,{recursive:true});
  host=createServer(async(req,res)=>{
    if(req.method==='OPTIONS' && req.url==='/v1/plate/evaluate' && req.headers.origin===origin){
      res.writeHead(204,{
        'access-control-allow-origin':origin,
        'access-control-allow-methods':'POST, OPTIONS',
        'access-control-allow-headers':'content-type, x-intuit3d-token'
      });
      res.end();return;
    }
    const chunks=[];for await(const part of req)chunks.push(part);
    if(req.method!=='POST'||req.url!=='/v1/plate/evaluate'||
      req.headers['x-intuit3d-token']!==token ||req.headers.origin!==origin){
      res.writeHead(403);res.end('{}');return;
    }
    ++requests;
    const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const model=JSON.parse(raw.archive);
    const bytes=Buffer.from('ISO-10303-21;\\nHEADER;\\n/* SYNTHETIC UI TEST, NOT OCCT */\\nENDSEC;\\nEND-ISO-10303-21;\\n'+sha(raw.archive));
    await pause(600); // Ensure we can change the authoritative model during evaluation.
    res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':origin});
    res.end(JSON.stringify({
      format:'intuit3d.local-plate-bridge',version:1,
      source:{projectId:model.projectId,revision:model.revision,archiveSha256:sha(raw.archive)},
      result:{kind:'experimental_plate_evaluated',projectId:model.projectId,revision:model.revision,
        cutFeatureId:raw.cutFeatureId,requestId:raw.requestId,
        backend:'synthetic-browser-ui-test-only',exactAuthority:false,independentInteroperability:false},
      step:{filename:'plate.step',bytes:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64'),
        verification:'same_engine_step_readback'},
    }));
  });
  await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
  const port=host.address().port;
  const vite=spawn('npm',['run','preview','--workspace','@intuit3d/web','--',
    '--host','127.0.0.1','--port','4173','--strictPort'],{
    stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'
  });
  children.push(vite);
  await eventually(async()=>{try{return(await fetch(origin)).ok}catch{return false}},'Vite preview');
  const chrome=spawn(browser(),[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle',
    '--use-angle=swiftshader','--enable-unsafe-swiftshader',
    '--disable-background-networking','--no-first-run',
    '--window-size=1360,900','--remote-debugging-port=0',
    '--user-data-dir='+home,'about:blank',
  ],{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  children.push(chrome);
  const p=await eventually(()=>existsSync(join(home,'DevToolsActivePort')) &&
    readFileSync(join(home,'DevToolsActivePort'),'utf8'),'CDP port');
  const endpoint='http://127.0.0.1:'+Number(p.split('\n')[0]);
  const target=await eventually(async()=>{
    const reply=await fetch(endpoint+'/json/list');const all=await reply.json();
    return all.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
  },'browser page');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message',event=>{
    const packet=JSON.parse(event.data);
    if(packet.method==='Runtime.exceptionThrown')exceptions.push(packet.params?.exceptionDetails?.text);
    const wait=pending.get(packet.id);
    if(!wait)return;
    pending.delete(packet.id);clearTimeout(wait.timer);
    packet.error?wait.reject(Error(JSON.stringify(packet.error))):wait.resolve(packet.result);
  });
  await eventually(()=>ws.readyState===WebSocket.OPEN,'CDP connection');
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:origin});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=enter-model-runtime]'))"),'model editor launch');
  check(await evaluate("(() => {document.querySelector('[data-testid=enter-model-runtime]').click();return true})()"),'cannot enter model editor');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-native-export]'))"),'native panel');
  check(await evaluate("document.querySelector('[data-testid=runtime-exact-state]')?.textContent.includes('NO EXACT KERNEL')"),
    'experimental bridge promoted to exact');
  check(await evaluate(`(() => {
    const update=(testid,value)=>{
      const input=document.querySelector('[data-testid='+testid+']');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));
      return input.value===value;
    };
    return update('runtime-native-url','http://127.0.0.1:${port}') &&
      update('runtime-native-token','${token}');
  })()`),'cannot pair local host inputs');
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-native-export]').disabled"),'enabled STEP action');
  await screenshot('native-01-paired.png');

  check(await evaluate("(() => {window.__nativeStepBlobs=[];const previous=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{window.__nativeStepBlobs.push(blob);return previous(blob)};return true})()"),
    'cannot inspect actual browser file publication');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-export]').click();return true})()"),
    'cannot request STEP');
  await eventually(()=>evaluate("window.__nativeStepBlobs.length===1"),'verified binary file download');
  check(await evaluate("(async()=>{const a=await window.__nativeStepBlobs[0].text();return a.includes('SYNTHETIC UI TEST, NOT OCCT')})()"),
    'downloaded STEP byte stream differs from verified synthetic HTTP fixture');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-result]')?.textContent.includes('not independent STEP')"),
    'STEP result lacks experimental and independent status');
  await screenshot('native-02-download.png');

  // Second request is aborted by an actual browser param edit before HTTP reply.
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-export]').click();return true})()"),
    'cannot start second request');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-native-cancel]'))"),'in-progress native request');
  check(await evaluate("(() => {const el=document.querySelector('[data-testid=runtime-dimension-thickness]');el.focus();el.select();return document.activeElement===el})()"),
    'model dimension editor cannot focus');
  await send('Input.insertText',{text:'12'});
  await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'authoritative retrospective edit');
  await pause(950);
  check(await evaluate('window.__nativeStepBlobs.length===1'),
    'stale STEP was downloaded following model change');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'sketch edit fabricated exact cut');
  await screenshot('native-03-edit-cancels-stale.png');

  // The edited revision can be evaluated and downloaded again on demand.
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-export]').click();return true})()"),
    'cannot re-evaluate edited model');
  await eventually(()=>evaluate('window.__nativeStepBlobs.length===2'),'edited STEP download');
  check(await evaluate("(async()=>{const a=await window.__nativeStepBlobs[0].text();const b=await window.__nativeStepBlobs[1].text();return a!==b})()"),
    'edited project reused stale STEP bytes');
  check(exceptions.length===0,'Browser exceptions: '+exceptions.join('; '));
  writeFileSync(join(artifacts,'native-browser-report.json'),JSON.stringify({
    evidence:'actual Chromium React UI and binary Blob/download interception',
    provider:'synthetic HTTP responder, NOT OCP/native/STEP interoperability',
    downloadedFiles:2,staleDownloadRefused:true,realPhysicalGeometry:false,
    independentStep:false,humanAcceptance:false,requests,screenshots:[
      'native-01-paired.png','native-02-download.png','native-03-edit-cancels-stale.png'
    ]},null,2)+'\n');
  console.log('WORKBENCH_NATIVE_UI_BROWSER_PASS synthetic_http_only');
}
main().catch(error=>{console.error('WORKBENCH_NATIVE_UI_BROWSER_FAIL',error.stack||error);process.exitCode=1;})
.finally(async()=>{
  try{ws?.close()}catch{}
  for(const child of children.reverse()){
    try{
      if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');
      else child.kill('SIGKILL');
    }catch{try{child.kill('SIGKILL')}catch{}}
    child.stdout?.destroy();child.stderr?.destroy();
  }
  if(host)await new Promise(resolve=>host.close(resolve));
  try{rmSync(home,{recursive:true,force:true})}catch{}
});
