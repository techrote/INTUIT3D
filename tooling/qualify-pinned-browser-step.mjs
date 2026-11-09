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
async function clickHistoryAction(label){
  // Ordinary pointer click on the existing ribbon button, never direct React
  // handler invocation. A disabled or ambiguous history action is a failure.
  const pos=await evalInPage('(()=>{const xs=[...document.querySelectorAll(".ribbon-group button")].filter(e=>e.textContent.trim()==='+
    JSON.stringify(label)+');if(xs.length!==1||xs[0].disabled)return null;const e=xs[0];'+
    'e.scrollIntoView({block:"center",behavior:"instant"});const r=e.getBoundingClientRect();'+
    'return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
  requireValid(pos&&pos.x>0&&pos.x<1360&&pos.y>0&&pos.y<900,
    'History control disabled, missing or ambiguous: '+label);
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

/** One browser-operated, genuinely drawn from-zero profile with original C++
 * evidence before and after a structural SKETCH hole edit. The source model,
 * cut target and project persist; this does not borrow the seeded plate.
 */
async function drawnFromEmptyPhysical(expected){
  const fill=async(id,value)=>{
    const ok=await evalInPage('(()=>{const e=document.querySelector('+JSON.stringify('[data-testid='+id+']')+');if(!e||e.disabled)return false;e.focus();e.select();return document.activeElement===e})()');
    requireValid(ok,'Required keyboard input unavailable: '+id);
    await send('Input.insertText',{text:String(value)});
    await until(()=>evalInPage('document.querySelector('+JSON.stringify('[data-testid='+id+']')+')?.value==='+JSON.stringify(String(value))),
      'actual React input '+id+'='+value);
  };
  const pointer=async(x,y)=>{
    const p=await evalInPage('(()=>{const s=document.querySelector("[data-testid=runtime-blank-sketch]");const m=s?.getScreenCTM();if(!m)return null;const p=new DOMPoint('+x+','+(120-y)+').matrixTransform(m);return {x:p.x,y:p.y}})()');
    requireValid(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>0&&p.x<1360&&p.y>0&&p.y<900,'No real SVG pointer projection '+x+','+y);
    for(const event of [
      {type:'mouseMoved',x:p.x,y:p.y},
      {type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1},
      {type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1}
    ])await send('Input.dispatchMouseEvent',event);
  };
  await click('runtime-new-empty-sketch');
  await until(()=>evalInPage('Boolean(document.querySelector("[data-testid=runtime-import-review]"))'),'empty project replacement consent');
  await click('runtime-import-review-confirm');
  await until(()=>evalInPage('Boolean(document.querySelector("[data-testid=runtime-blank-sketch]"))'),'zero-entity canvas');
  const blank=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  requireValid(await evalInPage('!document.querySelector("[data-testid=runtime-sketch]")'),'unexpected preauthored contour');
  await click('runtime-outline-tool');
  for(const [x,y] of [[0,0],[120,0],[120,80],[0,80]])await pointer(x,y);
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-contour-vertex-count]")?.textContent?.includes("4 / 12")'),'four pointer-authored vertices');
  requireValid((await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent'))===blank,
    'Unclosed draft changed canonical source');
  await click('runtime-close-contour');
  await until(()=>evalInPage('Boolean(document.querySelector("[data-testid=runtime-sketch]"))'),'solver and versioned RUNTIME contour admission');
  requireValid((await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent'))!==blank,
    'Four-vertex Close did not journal');
  await screenshot('drawn-01-authoritative-outline.png');
  await click('runtime-create-extrusion');
  await until(()=>evalInPage('Boolean(document.querySelector("[data-testid=runtime-feature-plate]"))'),'user extrusion creation');
  for(const [k,v] of [['x',35],['y',40],['diameter',12]])await fill('runtime-new-hole-'+k,v);
  await click('runtime-add-hole');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-hole-inspector] .section-head")?.textContent?.includes("1")'),'one user-authored circular bore');
  await click('runtime-create-cut');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-feature-cut]")?.textContent?.includes("pending_exact_provider")'),'explicit body-bound cut');
  await screenshot('drawn-02-one-bore-cut.png');
  // Pair the same genuine source-pinned Linux native provider through the UI,
  // and only then click the UI evidence control.
  const paired=await evalInPage('(()=>{const update=(id,value)=>{const e=document.querySelector("[data-testid="+id+"]");if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,value);e.dispatchEvent(new Event("input",{bubbles:true}));return true};return update("runtime-native-url",'+JSON.stringify(identity.url)+')&&update("runtime-native-token",'+JSON.stringify(identity.token)+')})()');
  requireValid(paired,'Cannot pair pinned host using user-facing inputs');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-build-pinned-evidence]")?.disabled===false'),'genuine native build allowed');
  const earlierRevision=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  const earlier=await evidence('earlier-one-bore');
  // This edit mutates the *earlier sketch feature* while the cut remains
  // explicitly targeted. Affected branches must rebuild, old STEP revoked.
  for(const [k,v] of [['x',85],['y',40],['diameter',12]])await fill('runtime-new-hole-'+k,v);
  await click('runtime-add-hole');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-hole-inspector] .section-head")?.textContent?.includes("2")'),'second user-authored bore');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled===true'),'old native STEP invalidated by earlier-feature edit');
  const editedRevision=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  requireValid(editedRevision!==earlierRevision,'Earlier-feature edit did not advance source revision');
  await screenshot('drawn-03-old-step-revoked.png');
  await clickHistoryAction('Undo');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-hole-inspector] .section-head")?.textContent?.includes("1")'),'real browser undo one bore');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled===true'),'undo still revokes stale STEP');
  await screenshot('drawn-04-undo.png');
  await clickHistoryAction('Redo');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-hole-inspector] .section-head")?.textContent?.includes("2")'),'real browser redo second bore');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled===true'),'redo still revokes stale STEP');
  await screenshot('drawn-05-redo.png');
  // Retrospectively edit the earlier extrusion through actual 3D keyboard
  // interaction, after the dependent cut and second bore already exist. This
  // is an authored physical dimension change, not a direct RUNTIME call.
  // The selected thickness grip commits four separate 1 mm, revision-fenced
  // edits. Undo and Redo must revoke the previous original C++ STEP bytes.
  const beforeThicknessRevision=await evalInPage(
    'document.querySelector("[data-testid=runtime-revision]")?.textContent');
  // Adding/editing a sketch hole deliberately leaves the workbench in XY
  // sketch mode. The 3D extrusion grip is not rendered there. Use the real
  // Solid ribbon button, not direct React state manipulation, to return to
  // the physical 3D edit surface before exercising the grip.
  await click('runtime-mode-solid');
  await until(()=>evalInPage(
    'Boolean(document.querySelector("[data-testid=runtime-thickness-handle]"))'),
    'actual 3D thickness grip after real Solid ribbon navigation');
  requireValid(await evalInPage(
    'document.querySelector("[data-testid=runtime-thickness-handle]")?.getAttribute("aria-valuenow")==="8"'),
    'Drawn cut has no actual 8 mm solid thickness handle');
  // Accessible keyboard navigation: focus the preceding real camera FIT
  // button, then press Tab to enter the following native thickness slider.
  // A pointer-down on the grip currently prevents default focus to support
  // drag capture; do not pretend an unfocused ArrowUp will edit the model.
  await click('runtime-camera-fit');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',
    code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',
    code:'Tab',windowsVirtualKeyCode:9});
  requireValid(await evalInPage(
    'document.activeElement?.getAttribute("data-testid")==="runtime-thickness-handle"'),
    'Real keyboard Tab did not focus the accessible 3D thickness slider');
  for(let step=9;step<=12;step++){
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',
      code:'ArrowUp',windowsVirtualKeyCode:38});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',
      code:'ArrowUp',windowsVirtualKeyCode:38});
    await until(()=>evalInPage(
      'document.querySelector("[data-testid=runtime-thickness-handle]")?.getAttribute("aria-valuenow")==='+JSON.stringify(String(step))),
      'actual 3D thickness keyboard handle at '+step+' mm');
  }
  await until(()=>evalInPage(
    'document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled===true'),
    'retrospective extrusion edit did not revoke stale STEP');
  const revisionThicknessEdited=await evalInPage(
    'document.querySelector("[data-testid=runtime-revision]")?.textContent');
  requireValid(revisionThicknessEdited!==beforeThicknessRevision,
    '3D keyboard dimension change did not journal');
  await screenshot('drawn-05b-3d-thickness-edited-12mm.png');
  await clickHistoryAction('Undo');
  await until(()=>evalInPage(
    'document.querySelector("[data-testid=runtime-thickness-handle]")?.getAttribute("aria-valuenow")==="11"'),
    'real Undo did not restore preceding 11 mm extrusion');
  await until(()=>evalInPage(
    'document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled===true'),
    'thickness Undo retained stale STEP');
  await screenshot('drawn-05c-thickness-undo-11mm.png');
  await clickHistoryAction('Redo');
  await until(()=>evalInPage(
    'document.querySelector("[data-testid=runtime-thickness-handle]")?.getAttribute("aria-valuenow")==="12"'),
    'real Redo did not restore revised 12 mm extrusion');
  await until(()=>evalInPage(
    'document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled===true'),
    'thickness Redo retained stale STEP');
  await screenshot('drawn-05d-thickness-redo-12mm.png');
  const currentRevision=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  const before=await evalInPage('window.__capturedPinned.length');
  await click('runtime-save-archive');
  await until(()=>evalInPage('window.__capturedPinned.length>'+before),'user Save drawn project');
  const saved=await lastBlob();
  requireValid(saved.length>100&&saved.length<32000000,'Invalid saved drawn project');
  const filename=join(output,'drawn-user-reopened.i3d-model.json');
  writeFileSync(filename,saved);
  const dom=await send('DOM.getDocument',{depth:1});
  const input=await send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[aria-label="Open INTUIT model archive"]'});
  requireValid(input.nodeId>0,'Original file input absent');
  await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[filename]});
  await until(()=>evalInPage('Boolean(document.querySelector("[data-testid=runtime-import-review]"))'),'isolated Worker validates drawn archive');
  await click('runtime-import-review-confirm');
  await until(()=>evalInPage('!document.querySelector("[data-testid=runtime-import-review]")&&document.querySelector("[data-testid=runtime-hole-inspector] .section-head")?.textContent?.includes("2")'),'confirmation/reopen preserves drawn cut and two bores');
  requireValid(await evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled===true'),'reopen retained stale native STEP');
  await screenshot('drawn-06-file-picker-worker-reopen.png');
  const current=await evidence('current-two-bores');
  requireValid(earlier.sha256!==current.sha256,'One- and two-bore original ZIPs identical');
  const report={status:'PINNED_OCCT8_BROWSER_DRAWN_FROM_EMPTY_TWO_REVISIONS_CAPTURED',
    provider:'actual installed Linux OCCT8 C++ worker via browser and persistent RUNTIME',
    nativeWorkerSha256:expected,independentCadInteroperability:false,
    journey:'drawn-from-empty',revisionEarlier:earlierRevision,revisionEdited:editedRevision,
    revisionCurrent:currentRevision,revisionThicknessEdited,earlier,current,
    reopened:{file:'drawn-user-reopened.i3d-model.json',sha256:hash(saved)},
    authoredFeatures:{sketchSource:'four_real_pointer_clicks_from_zero_entities',
      pointerDrawnClosedProfile:true,extrusion:'actual_browser_control',
      cut:'actual_browser_control',earlierFeatureEdit:'second_solver_admitted_bore',
      retrospectiveDimensionEdit:'real_3d_thickness_grip_8_to_12mm_ArrowUp_Undo_Redo',
      undoRedo:'real_browser_controls',sourceRevocation:true},
    caveat:'Current original STEP must pass the separately compiled non-OCCT AnvilCAD volume, material and wrong-one-bore witness'};
  writeFileSync(join(output,'browser-receipt.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PINNED_OCCT8_BROWSER_DRAWN_FROM_EMPTY_TWO_REVISIONS_CAPTURED '+JSON.stringify({
    worker:expected,earlier:earlier.sha256,current:current.sha256}));
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
  if(process.env.INTUIT3D_BROWSER_DRAWN_FROM_EMPTY==='1'){
    await drawnFromEmptyPhysical(expected);
    return;
  }
  // Separate source-qualified journey. The starter supplies a solved rectangle
  // and two circles; the user authors the actual extrusion and cut by clicking
  // the ordinary React controls. It is NOT user-drawn polygon acceptance.
  const journey=process.env.INTUIT3D_BROWSER_SKETCH_FIRST==='1'
    ?'sketch-first-template':'preauthored-plate';
  let authoredFeatures=null;
  if(journey==='sketch-first-template'){
    await click('runtime-new-sketch');
    await until(()=>evalInPage(
      'Boolean(document.querySelector("[data-testid=runtime-import-review]"))'),
      'new sketch-first project replacement review');
    await click('runtime-import-review-confirm');
    await until(()=>evalInPage(
      'Boolean(document.querySelector("[data-testid^=runtime-feature-sketch]"))'+
      '&&!document.querySelector("[data-testid=runtime-feature-plate]")'+
      '&&!document.querySelector("[data-testid=runtime-feature-cut]")'),
      'new project has a solved sketch but no authored solids');
    await click('runtime-create-extrusion');
    await until(()=>evalInPage(
      'Boolean(document.querySelector("[data-testid=runtime-feature-plate]"))'+
      '&&!document.querySelector("[data-testid=runtime-create-cut]").disabled'),
      'user clicked real model-backed extrusion');
    await click('runtime-create-cut');
    await until(()=>evalInPage(
      'Boolean(document.querySelector("[data-testid=runtime-feature-cut]"))'),
      'user clicked real target-bound cut');
    await screenshot('user-sketch-first-extrude-cut.png');
    authoredFeatures={
      sketchSource:'solved_start_template_not_pointer_drawn',
      extrusion:'actual_browser_control',cut:'actual_browser_control',
      revisionAfterCut:await evalInPage(
        'document.querySelector("[data-testid=runtime-revision]")?.textContent'),
      pointerDrawnClosedProfile:false,
    };
  }
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
  const revisionEdited=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  requireValid(revisionEdited!==revision8,'Retrospective edit did not advance revision');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled'),'edited revision revoked prior STEP');
  // Exercise real user Undo/Redo *against this same pinned C++ session*, not
  // an isolated unit-test history. Both transitions must revoke prior native
  // bytes; only the subsequent C++ build may reinstate a current receipt.
  await clickHistoryAction('Undo');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-dimension-thickness]")?.value==="8"'),'actual browser undo restored 8 mm');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled'),'undo revoked native STEP');
  const revisionUndo=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  await screenshot('user-undo-8mm.png');
  await clickHistoryAction('Redo');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-dimension-thickness]")?.value==="12"'),'actual browser redo restored 12 mm');
  await until(()=>evalInPage('document.querySelector("[data-testid=runtime-native-evidence-zip]")?.disabled'),'redo revoked obsolete native STEP');
  const revision12=await evalInPage('document.querySelector("[data-testid=runtime-revision]")?.textContent');
  requireValid(revisionUndo!==revisionEdited&&revision12!==revisionUndo&&revision12!==revision8,
    'Undo and redo did not advance canonical source history');
  await screenshot('user-redo-12mm.png');
  const reopened=await saveReopen();
  const current=await evidence('current-12mm');
  requireValid(earlier.sha256!==current.sha256,'Earlier and current browser ZIPs identical');
  const report={status:'PINNED_OCCT8_BROWSER_TWO_REVISION_ZIPS_CAPTURED',
    provider:'actual installed Linux OCCT8 C++ worker via persistent RUNTIME/Chromium',
    nativeWorkerSha256:expected,independentCadInteroperability:false,
    revision8,revisionEdited,revisionUndo,revision12,earlier,current,reopened,
    journey,authoredFeatures,
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