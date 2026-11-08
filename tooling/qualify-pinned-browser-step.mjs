#!/usr/bin/env node
/**
 * Integration physical browser gate: one live genuine OCCT8 C++ worker,
 * one Chromium workbench, two user-authored RUNTIME revisions and two original
 * downloaded STEP custody ZIPs. No stub, OCP fallback or alternate HTTP API.
 * A separate non-OCCT consumer must independently import the same STEP bytes.
 */
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as pause} from 'node:timers/promises';

const origin='http://127.0.0.1:4173';
const output=resolve(process.env.INTUIT3D_PINNED_BROWSER_ARTIFACTS||'pinned-browser-evidence');
const profile=mkdtempSync(join(tmpdir(),'intuit-pinned-chromium-'));
const children=[],pending=new Map();
const identity={url:null,token:null};
let socket,seq=0,closing=false,dead=null,exceptions=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function requireValid(value,message){if(!value)throw Error(message)}
async function until(fn,what,iterations=200){
  for(let n=0;n<iterations;n++){
    if(dead)throw dead;
    try{const value=await fn();if(value)return value;}catch(error){
      if(n===iterations-1)throw Error(what+': '+String(error));
    }
    await pause(250);
  }
  throw Error('Deadline exceeded: '+what);
}
function launch(cmd,args,env=process.env){
  const p=spawn(cmd,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
  children.push(p);
  let error='';
  p.stderr.on('data',b=>error=(error+String(b)).slice(-5000));
  p.on('error',e=>{if(!closing)dead=Error('Process failed: '+e.message)});
  p.on('exit',(code,signal)=>{
    if(!closing)dead=Error(cmd+' exited ('+(signal||code)+'): '+
      error.replace(/LOCAL_PAIRING_TOKEN=\S+/g,'LOCAL_PAIRING_TOKEN=[redacted]'));
  });
  return p;
}
function send(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},12000);
    pending.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evalInPage(code){
  const v=await send('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});
  if(v.exceptionDetails)throw Error('Page execution error: '+JSON.stringify(v.exceptionDetails));
  return v.result?.value;
}
async function click(id){
  const pos=await evalInPage('(()=>{const el=document.querySelector('+
    JSON.stringify('[data-testid='+id+']')+
    ');if(!el||el.disabled)return null;el.scrollIntoView({block:"center",behavior:"instant"});'+
    'const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  requireValid(pos&&pos.x>0&&pos.x<1360&&pos.y>0&&pos.y<900,'Control not clickable: '+id);
  for(const item of [
    {type:'mouseMoved',x:pos.x,y:pos.y},
    {type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1},
    {type:'mouseReleased',x:pos.x,y:pos.y,button:'left',clickCount:1}])
    await send('Input.dispatchMouseEvent',item);
}
async function typeThickness(mm){
  requireValid(await evalInPage('(()=>{const e=document.querySelector('+
    JSON.stringify('[data-testid=runtime-dimension-thickness]')+
    ');if(!e)return false;e.focus();e.select();return document.activeElement===e})()'),
    'Actual dimension editor absent');
  await send('Input.insertText',{text:String(mm)});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-dimension-thickness]")?.value==='+JSON.stringify(String(mm))),'model-backed thickness '+mm);
}
async function screenshot(name){
  const img=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(join(output,name),Buffer.from(img.data,'base64'));
}
async function lastBlob(){
  const b64=await evalInPage('(async()=>{const blob=window.__capturedPinned?.at(-1);'+
    'if(!blob)return null;const bytes=new Uint8Array(await blob.arrayBuffer());'+
    'let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));'+
    'return btoa(s)})()');
  requireValid(b64&&b64.length<15000000,'Missing or oversized browser Blob');
  return Buffer.from(b64,'base64');
}
async function evidence(stage){
  const before=await evalInPage('window.__capturedPinned.length');
  await click('runtime-native-build-pinned-evidence');
  await until(()=>evalInPage('window.__capturedPinned.length>'+before),'real C++ custody ZIP for '+stage,320);
  const bytes=await lastBlob();
  requireValid(bytes.subarray(0,4).toString('hex')==='504b0304','Not an original browser ZIP');
  writeFileSync(join(output,stage+'.zip'),bytes);
  const revision=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  await screenshot(stage+'.png');
  return {file:stage+'.zip',sha256:hash(bytes),bytes:bytes.length,revision};
}
async function saveReopen(){
  const before=await evalInPage('window.__capturedPinned.length');
  await click('runtime-save-archive');
  await until(()=>evalInPage('window.__capturedPinned.length>'+before),'user Save model archive');
  const archive=await lastBlob();
  requireValid(archive.length>100&&archive.length<32000000,'Saved archive invalid size');
  const target=join(output,'edited-user-reopened.i3d-model.json');
  writeFileSync(target,archive);
  const dom=await send('DOM.getDocument',{depth:1});
  const input=await send('DOM.querySelector',{nodeId:dom.root.nodeId,
    selector:'input[aria-label="Open INTUIT model archive"]'});
  requireValid(input.nodeId>0,'Missing actual file picker');
  await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[target]});
  await until(()=>evalInPage('Boolean(document.querySelector("[data-testid=runtime-import-review]"))'),'isolated Worker validation and review',200);
  await click('runtime-import-review-confirm');
  await until(()=>evalInPage('!document.querySelector("[data-testid=runtime-import-review]")&&'+
    'document.querySelector("[data-testid=runtime-dimension-thickness]")?.value==="12"'),
    'explicit user-confirmed saved archive replay',200);
  requireValid(await evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled'),
    'Reopening archive incorrectly retained stale native STEP');
  await screenshot('user-save-and-reopen.png');
  return {file:'edited-user-reopened.i3d-model.json',sha256:hash(archive)};
}
async function execute(){
  mkdirSync(output,{recursive:true});
  requireValid(process.platform==='linux','Genuine OCCT8 Linux worker required');
  const worker=process.env.INTUIT3D_OCCT8_WORKER,expected=process.env.INTUIT3D_OCCT8_WORKER_SHA256;
  requireValid(worker?.startsWith('/')&&/^[a-f0-9]{64}$/.test(expected||''),
    'Requires canonical installed worker and independently expected digest');
  requireValid(hash(readFileSync(worker))===expected,'Worker digest differs before browser launch');
  const companion=launch(process.execPath,['tooling/local-pinned-host.mjs'],{
    ...process.env,INTUIT3D_WEB_ORIGIN:origin
  });
  let buffer='';
  companion.stdout.on('data',bytes=>{
    buffer+=String(bytes);
    let e;
    while((e=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,e).trim();buffer=buffer.slice(e+1);
      if(line.startsWith('LOCAL_PROVIDER_URL='))identity.url=line.slice(19);
      if(line.startsWith('LOCAL_PAIRING_TOKEN='))identity.token=line.slice(20);
    }
  });
  await until(()=>identity.url&&identity.token,'source-pinned local RUNTIME bridge');
  const url=new URL(identity.url);
  requireValid(url.hostname==='127.0.0.1'&&url.protocol==='http:'&&
    /^[a-f0-9]{64}$/.test(identity.token),'Refuse invalid native pairing authority');
  launch('npm',['run','preview','--workspace','@intuit3d/web','--',
    '--host','127.0.0.1','--port','4173','--strictPort']);
  await until(async()=>{try{return (await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok}catch{return false}},'built React workbench');
  let p=spawnSync('which',['google-chrome'],{encoding:'utf8'});
  if(p.status!==0)p=spawnSync('which',['chromium'],{encoding:'utf8'});
  requireValid(p.status===0&&p.stdout.trim(),'No actual Chromium available');
  launch(p.stdout.trim(),[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage',
    '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
    '--disable-background-networking','--no-first-run','--window-size=1360,900',
    '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
  ]);
  const portText=await until(()=>existsSync(join(profile,'DevToolsActivePort'))&&
    readFileSync(join(profile,'DevToolsActivePort'),'utf8'),'Chromium CDP',240);
  const port=Number(portText.split('\n')[0]);
  const page=await until(async()=>{
    const r=await fetch('http://127.0.0.1:'+port+'/json/list');
    if(!r.ok)return null;
    return (await r.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
  },'browser page');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown')
      exceptions.push(message.params?.exceptionDetails?.text||'Chromium exception');
    if(message.method==='Page.javascriptDialogOpening'&&message.params?.type==='beforeunload')
      void send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});
    const task=pending.get(message.id);if(!task)return;
    pending.delete(message.id);clearTimeout(task.timer);
    message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result);
  });
  await until(()=>socket.readyState===WebSocket.OPEN,'CDP WebSocket');
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:origin});
  await until(()=>evalInPage('Boolean(document.querySelector("[data-testid=runtime-native-build-pinned-evidence]"))'),
    'model-backed editor with pinned step control');
  requireValid(await evalInPage('Boolean(document.querySelector("[data-testid=runtime-panel]"))'),
    'CAD not in authoritative model mode');
  await evalInPage('(()=>{window.__capturedPinned=[];const old=URL.createObjectURL.bind(URL);'+
    'URL.createObjectURL=blob=>{window.__capturedPinned.push(blob);return old(blob)};return true})()');
  await typeThickness(8);
  const revision8=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  // Input through React's real event path; never call RUNTIME directly.
  const paired=await evalInPage('(()=>{const update=(id,value)=>{const e=document.querySelector("[data-testid="+id+"]");'+
    'if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,value);'+
    'e.dispatchEvent(new Event("input",{bubbles:true}));return true};return update("runtime-native-url",'+
    JSON.stringify(identity.url)+')&&update("runtime-native-token",'+JSON.stringify(identity.token)+')})()');
  requireValid(paired,'Cannot pair genuine bridge through browser');
  await until(()=>evalInPage('!document.querySelector("[data-testid=runtime-native-build-pinned-evidence]").disabled'),'user-buildable native session');
  const earlier=await evidence('earlier-8mm');
  await typeThickness(12);
  const revision12=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  requireValid(revision12!==revision8,'Retrospective edit did not advance revision');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled'),'stale pinned evidence revoked');
  const reopened=await saveReopen();
  const current=await evidence('current-12mm');
  requireValid(earlier.sha256!==current.sha256,'Earlier and current browser ZIPs identical');
  const report={status:'PINNED_OCCT8_BROWSER_TWO_REVISION_ZIPS_CAPTURED',
    provider:'actual installed Linux OCCT8 C++ worker via persistent RUNTIME/Chromium',
    nativeWorkerSha256:expected,independentCadInteroperability:false,
    revision8,revision12,earlier,current,reopened,
    caveat:'Same original downloaded STEP bytes must be independently imported and checked before #74 acceptance'};
  writeFileSync(join(output,'browser-receipt.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PINNED_OCCT8_BROWSER_TWO_REVISION_ZIPS_CAPTURED '+JSON.stringify({
    earlier:earlier.sha256,current:current.sha256,worker:expected
  }));
}
try{await execute()}catch(error){
  let message=String(error?.stack||error);
  if(identity.token)message=message.replaceAll(identity.token,'[redacted]');
  console.error('PINNED_OCCT8_BROWSER_REJECTED '+message);
  process.exitCode=1;
}finally{
  closing=true;
  try{socket?.close()}catch{}
  for(const proc of children.reverse()){
    try{proc.kill('SIGTERM')}catch{}
    proc.stdout?.destroy();proc.stderr?.destroy();
  }
  await pause(150);
  for(const proc of children)if(proc.exitCode===null)try{proc.kill('SIGKILL')}catch{}
  try{rmSync(profile,{recursive:true,force:true})}catch{}
}