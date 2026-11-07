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
  // Always drain child pipes: a noisy Vite/Chromium process can block while
  // writing into an unread pipe before the CDP handshake is established.
  let viteStderr='';
  vite.stdout?.resume();
  vite.stderr?.on('data',chunk=>{viteStderr=(viteStderr+chunk.toString()).slice(-4096);});
  try {
    await eventually(async()=>{try{return(await fetch(origin)).ok}catch{return false}},'Vite preview');
  } catch(error) {
    throw new Error(String(error)+'; viteExit='+vite.exitCode+'; stderr='+viteStderr);
  }

  // This real-native test runs after memory-intensive Python/OCP/STEP work.
  // Github's Linux browser can hang before emitting DevToolsActivePort, even
  // while the Chrome PID is alive (observed on exact accepted-main run
  // 42336300195). Use the SAME bounded, explicitly instrumented two-mode
  // Chromium launch fallback as the already qualified browser-smoke harness.
  // Missing browser rendering is never accepted as a test pass.
  const executable=browser();
  const browserVersion=spawnSync(executable,['--version'],{encoding:'utf8'});
  const rendererModes=[
    ['--headless=new','--use-gl=angle','--use-angle=swiftshader'],
    ['--headless','--use-gl=swiftshader','--no-zygote'],
  ];
  const launchFailures=[];
  let p=null;
  for(let attempt=0;attempt<rendererModes.length && !p;attempt++){
    const profile=join(home,attempt===0?'primary':'fallback');
    const chrome=spawn(executable,[
      ...rendererModes[attempt],'--no-sandbox','--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader','--disable-background-networking',
      '--no-first-run','--no-default-browser-check','--window-size=1360,900',
      '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank',
    ],{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    children.push(chrome);
    let stderr='';
    chrome.stdout?.resume();
    chrome.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);});
    chrome.on('error',err=>{stderr=(stderr+'\\nspawn: '+err.message).slice(-12000);});
    try{
      p=await eventually(()=>existsSync(join(profile,'DevToolsActivePort'))&&
        readFileSync(join(profile,'DevToolsActivePort'),'utf8'),
        'Chromium CDP port / attempt '+(attempt+1),120);
    }catch(error){
      launchFailures.push({
        attempt:attempt+1,reason:String(error),
        exitCode:chrome.exitCode,signalCode:chrome.signalCode,
        browserVersion:(browserVersion.stdout||browserVersion.stderr||'').trim(),
        flags:rendererModes[attempt],stderr
      });
      console.error('CHROMIUM_LAUNCH_ATTEMPT_FAILED '+JSON.stringify(launchFailures.at(-1)));
      try{
        if(process.platform!=='win32'&&chrome.pid)process.kill(-chrome.pid,'SIGKILL');
        else chrome.kill('SIGKILL');
      }catch{try{chrome.kill('SIGKILL')}catch{}}
    }
  }
  if(!p)throw Error('Chromium native browser/CDP startup failed after two bounded attempts: '+
    JSON.stringify({launchFailures,viteExit:vite.exitCode,viteStderr}));
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

  // End-to-end PRODUCT path, not a synthetic responder: physically drag an
  // admitted SKETCH hole, edit its diameter, undo/redo, save/reopen the actual
  // authoritative archive, and demand a THIRD distinct physical OCP STEP.
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-mode-sketch]').click();return true})()"),
    'cannot open sketch handles with actual provider paired');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch-hole-holeA]'))"),
    'live hole A handle missing');
  const drag=await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-sketch-hole-holeA]');const r=e.getBoundingClientRect();const m=e.ownerSVGElement.getScreenCTM();const o=new DOMPoint(0,0).matrixTransform(m);const p=new DOMPoint(8,0).matrixTransform(m);return {x:r.left+r.width/2,y:r.top+r.height/2,dx:p.x-o.x}})()");
  check(Number.isFinite(drag.dx)&&Math.abs(drag.dx)>4,'real-native sketch handle has no usable CTM');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x,y:drag.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.x,y:drag.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x+drag.dx,y:drag.y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x+drag.dx,y:drag.y,button:'left',clickCount:1});
  await eventually(()=>evaluate("Math.abs(Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)-43)<0.6"),
    'real-native hole center drag did not commit the intended semantic coordinate');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-hole-holeA-diameter]');e.focus();e.select();return document.activeElement===e})()"),
    'cannot focus hole A diameter control');
  await send('Input.insertText',{text:'16'});await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='16'"),
    'independent hole A diameter did not commit');
  check(await evaluate("document.querySelector('[data-testid=runtime-hole-holeB-diameter]')?.value==='12'"),
    'hole A diameter incorrectly mutated hole B');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'edited hole dimensions reused exact cut evidence');
  await screenshot('native-real-05-hole-sketch.png');

  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell .toolstrip button')].find(x=>x.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'cannot undo hole diameter');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='12'"),
    'hole undo did not restore previous diameter');
  check(await evaluate("Math.abs(Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)-43)<0.6"),
    'undo diameter incorrectly undid preceding hole center drag');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell .toolstrip button')].find(x=>x.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    'cannot redo hole diameter');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='16'"),
    'hole redo did not reapply diameter');

  // Exercise real browser save/reopen, not merely an in-memory runtime replay.
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell .title-actions button')].find(x=>x.textContent?.trim()==='Save model archive');b?.click();return !!b})()"),
    'cannot save edited model archive');
  await eventually(()=>evaluate("window.__nativeStepBlobs.length===3"),'browser model archive Blob');
  check(await evaluate("(async()=>{const s=await window.__nativeStepBlobs[2].text();const j=JSON.parse(s);return !!j&&s.includes('sketch.plate')&&s.includes('holeA')})()"),
    'saved archive lost authored sketch constraints');
  check(await evaluate("(async()=>{const s=await window.__nativeStepBlobs[2].text();const input=document.querySelector('input[aria-label=\"Open INTUIT model archive\"]');const transfer=new DataTransfer();transfer.items.add(new File([s],'replay.i3d-model.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()"),
    'cannot re-import real saved browser archive');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'archive reopen confirmation did not appear');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(x=>x.textContent?.trim()==='Replace with model archive');b?.click();return !!b})()"),
    'cannot confirm saved archive reopening');
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-import-review]') && document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='16'"),
    'reopened browser archive did not restore revised hole diameter');
  check(await evaluate("Math.abs(Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)-43)<0.6"),
    'reopened archive lost dragged hole position');
  check(await evaluate("document.querySelector('[data-testid=runtime-exact-state]')?.textContent.includes('NO EXACT KERNEL')"),
    'archive replay falsely claimed exactness');

  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-mode-solid]').click();return true})()"),
    'cannot return to solid workbench for hole rebuild');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-export]').click();return true})()"),
    'cannot rebuild STEP after browser hole edit and archive reopen');
  await eventually(()=>evaluate('window.__nativeStepBlobs.length===4'),
    'physical OCP STEP from edited, reopened hole geometry',240);
  check(await evaluate("(async()=>{const a=await window.__nativeStepBlobs[1].text();const b=await window.__nativeStepBlobs[3].text();return b.length>1000 && a!==b && b.includes('ISO-10303-21;') && b.includes('END-ISO-10303-21;')})()"),
    'hole edits did not produce a distinct genuine STEP file');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-result]')?.textContent.includes('not independent STEP')"),
    'hole-rebuilt STEP lost experimental provenance');
  await screenshot('native-real-06-hole-reopened-step.png');
  check(exceptions.length===0,'Browser exceptions: '+exceptions.join('; '));
  writeFileSync(join(artifacts,'native-browser-report.json'),JSON.stringify({
    evidence:'actual Chromium React UI and binary Blob/download interception',
    provider:'actual pinned OCP 7.9.3.1 Python through trusted RUNTIME HTTP host',
    downloadedFiles:3,holeDrag:true,independentHoleDimension:true,undoRedo:true,archiveReplay:true,staleDownloadRefused:'covered by separate synthetic Chromium gate',realPhysicalGeometry:true,
    independentStep:false,humanAcceptance:false,screenshots:[
      'native-real-01-paired.png','native-real-02-download.png','native-real-03-edit-invalidates.png','native-real-04-edited-step.png','native-real-05-hole-sketch.png','native-real-06-hole-reopened-step.png'
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
