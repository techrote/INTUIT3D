#!/usr/bin/env node
/**
 * Actual Chromium/React pairing, revision-fence and file download interaction.
 * This executes the real trusted RUNTIME loopback host and pinned experimental
 * OCP two-hole Boolean worker. The existing WORKBENCH browser test separately
 * covers the deterministic synthetic/stale-response regression.
 * Same-engine STEP readback is NOT independent interoperability.
 * No Playwright dependency: local Vite preview + Chrome DevTools Protocol.
 */
import {spawn,spawnSync} from 'node:child_process';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {startLocalPlateBridge} from '@intuit3d/workflow-runtime/local-plate-bridge';
import {mkdirSync,mkdtempSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';

const origin='http://127.0.0.1:4173';
let token;
const artifacts=process.env.INTUIT3D_REAL_NATIVE_BROWSER_ARTIFACTS||'browser-evidence-real-native';
const home=mkdtempSync(join(tmpdir(),'intuit3d-native-browser-'));
const children=[];const pending=new Map();const exceptions=[];
let ws,seq=0,host;
const check=(ok,why)=>{if(!ok)throw Error(why);};
const eventually=async(fn,why,tries=90)=>{
  for(let i=0;i<tries;i++){try{const found=await fn();if(found)return found;}catch{}await pause(150);}
  throw Error('Timed out: '+why);
};
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
  const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
  host=await startLocalPlateBridge({runtime,model,plateContract,runExperimentalPlate,origin,timeoutMs:45000});
  token=host.token;
  const port=Number(new URL(host.url).port);
  check(Number.isSafeInteger(port)&&port>0,'real native bridge failed to bind');
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
  await screenshot('native-real-01-paired.png');

  check(await evaluate("(() => {window.__nativeStepBlobs=[];const previous=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{window.__nativeStepBlobs.push(blob);return previous(blob)};return true})()"),
    'cannot inspect actual browser file publication');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-export]').click();return true})()"),
    'cannot request STEP');
  await eventually(()=>evaluate("window.__nativeStepBlobs.length===1"),'verified binary file download');
  check(await evaluate("(async()=>{const a=await window.__nativeStepBlobs[0].text();return a.length>1000 && a.includes('ISO-10303-21;') && a.includes('END-ISO-10303-21;')})()"),
    'real native STEP did not reach Chromium as nonempty STEP text');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-result]')?.textContent.includes('not independent STEP')"),
    'STEP result lacks experimental and independent status');
  await screenshot('native-real-02-download.png');

  // Change the actual earlier model thickness, invalidating the downstream cut.
  // Then regenerate and download a distinct REAL OCP STEP through the browser.
  check(await evaluate("(() => {const el=document.querySelector('[data-testid=runtime-dimension-thickness]');el.focus();el.select();return document.activeElement===el})()"),
    'model thickness dimension editor cannot focus');
  await send('Input.insertText',{text:'12'});
  await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'authoritative retrospective thickness edit');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'retrospective thickness edit fabricated an exact cut');
  await screenshot('native-real-03-edit-invalidates.png');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-export]').click();return true})()"),
    'cannot re-evaluate edited native model');
  await eventually(()=>evaluate('window.__nativeStepBlobs.length===2'),'edited real OCP STEP download',240);
  check(await evaluate("(async()=>{const a=await window.__nativeStepBlobs[0].text();const b=await window.__nativeStepBlobs[1].text();return b.length>1000 && a!==b && b.includes('END-ISO-10303-21;')})()"),
    'edited thickness reused prior native STEP bytes');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-result]')?.textContent.includes('not independent STEP')"),
    'edited native STEP lacks honest provenance');
  await screenshot('native-real-04-edited-step.png');
  check(exceptions.length===0,'Browser exceptions: '+exceptions.join('; '));
  writeFileSync(join(artifacts,'native-browser-report.json'),JSON.stringify({
    evidence:'actual Chromium React UI and binary Blob/download interception',
    provider:'actual pinned OCP 7.9.3.1 Python through trusted RUNTIME HTTP host',
    downloadedFiles:2,staleDownloadRefused:'covered by separate synthetic Chromium gate',realPhysicalGeometry:true,
    independentStep:false,humanAcceptance:false,screenshots:[
      'native-01-paired.png','native-02-download.png','native-real-03-edit-invalidates.png','native-real-04-edited-step.png'
    ]},null,2)+'\n');
  console.log('WORKBENCH_REAL_OCP_NATIVE_UI_BROWSER_PASS same_engine_step_only');
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
  if(host)await host.close();
  try{rmSync(home,{recursive:true,force:true})}catch{}
});
