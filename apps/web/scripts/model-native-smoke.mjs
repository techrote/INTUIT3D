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
import {join,resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';

const origin='http://127.0.0.1:4173';
const token='b'.repeat(64);
const artifacts=process.env.INTUIT3D_HANDLE_ARTIFACTS||'apps/web/browser-evidence-handles';
const home=mkdtempSync(join(tmpdir(),'intuit3d-native-browser-'));
const children=[];const pending=new Map();const exceptions=[];
let ws,seq=0,requests=0,host;
// Deliberately invalid responses are exercised in real Chromium. This is NEVER a native provider.
let mockReplyMode='valid';
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
    if(req.method==='OPTIONS' && ['/v1/plate/evaluate','/v1/plate/capabilities'].includes(req.url) && req.headers.origin===origin){
      res.writeHead(204,{
        'access-control-allow-origin':origin,
        'access-control-allow-methods':'POST, OPTIONS',
        'access-control-allow-headers':'content-type, x-intuit3d-token'
      });
      res.end();return;
    }
    if(req.method==='GET' && req.url==='/v1/plate/capabilities' &&
       req.headers['x-intuit3d-token']===token && req.headers.origin===origin){
      res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':origin});
      res.end(JSON.stringify({
        format:'intuit3d.local-plate-bridge-capability',version:1,
        backend:'OCP-python-prototype',occtVersion:'7.9.3.1',
        stepVerification:'same_engine_step_readback',exactAuthority:false,
        independentInteroperability:false,
        note:'TEST DOUBLE only: no OCP, CAD kernel, real STEP or independent check was executed',
      }));return;
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
        // The envelope follows the pinned OCP 7.9.3.1 *schema* solely so this
        // synthetic interaction test can exercise RUNTIME's actual validation.
        // No OCP was executed; bytes below are intentionally non-STEP.
        backend:mockReplyMode==='wrong-provider'?'synthetic-browser-ui-test-only':'OCP-python-prototype',
        occtVersion:'7.9.3.1',exactAuthority:false,independentInteroperability:false,
        artifact:raw.exportStep?{
          bytes:bytes.length,sha256:sha(bytes),verification:'same_engine_step_readback',
          testFixture:'synthetic-browser-ui-test-only',
        }:null},
      step:raw.exportStep?{filename:'plate.step',bytes:bytes.length,
        sha256:mockReplyMode==='bad-step-digest'?'0'.repeat(64):sha(bytes),
        base64:bytes.toString('base64'),
        verification:'same_engine_step_readback'}:null,
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
    readFileSync(join(home,'DevToolsActivePort'),'utf8'),'CDP port',240);
  const endpoint='http://127.0.0.1:'+Number(p.split('\n')[0]);
  const target=await eventually(async()=>{
    const reply=await fetch(endpoint+'/json/list');const all=await reply.json();
    return all.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
  },'browser page');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message',event=>{
    const packet=JSON.parse(event.data);
    if(packet.method==='Runtime.exceptionThrown')exceptions.push(packet.params?.exceptionDetails?.text);
    // The app correctly warns on reload with unexported changes. This test
    // deliberately accepts that native browser dialog while simulating a
    // renderer restart, so that IndexedDB continuity can be verified.
    if(packet.method==='Page.javascriptDialogOpening' && packet.params?.type==='beforeunload'){
      void send('Page.handleJavaScriptDialog',{accept:true}).catch(error=>
        exceptions.push('beforeunload replay dialog: '+String(error)));
    }
    const wait=pending.get(packet.id);
    if(!wait)return;
    pending.delete(packet.id);clearTimeout(wait.timer);
    packet.error?wait.reject(Error(JSON.stringify(packet.error))):wait.resolve(packet.result);
  });
  await eventually(()=>ws.readyState===WebSocket.OPEN,'CDP connection');
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:origin});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-native-export]'))"),'model-first native panel');
  check(await evaluate("document.querySelector('[data-testid=runtime-panel]')!==null && document.querySelector('[data-testid=enter-model-runtime]')===null"),
    'Default startup did not mount only the authoritative CAD editor');
  // Real Chromium click/keyboard + archive roundtrip of authoritative
  // INTENT feature tombstones. No retired solid may remain on screen as current.
  const pointerClick=async(testid)=>{
    const pos=await evaluate(`(() => {
      const el=document.querySelector('[data-testid="${testid}"]');
      if(!el||el.disabled)return null;
      el.scrollIntoView({block:'center',behavior:'instant'});
      const rect=el.getBoundingClientRect();
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    })()`);
    check(pos&&pos.y>0&&pos.y<900,'cannot target pointer control '+testid);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x,y:pos.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x,y:pos.y,button:'left',clickCount:1});
  };
  // The default mounting-plate fixture is parameter-bound at 10 mm.
  // Seed the owner's representative 8→12 mm edit via the REAL inspector,
  // without silently changing RUNTIME's canonical fixture or using a mock.
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-dimension-thickness]');e.focus();e.select();return document.activeElement===e})()"),
    'cannot focus authoritative extrusion dimension for 8 mm baseline');
  await send('Input.insertText',{text:'8'});await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='8'"),
    'cannot seed 8 mm model-backed thickness');
  // Actual Chromium 3D direct manipulation. Camera-projected axis is read
  // from the rendered handle; no synthetic geometry or runtime model is edited
  // until the completed gesture reaches INTENT/RUNTIME.
  await eventually(()=>evaluate("(() => {const e=document.querySelector('[data-testid=runtime-thickness-handle]');return Boolean(e&&!e.hidden&&Number.isFinite(Number(e.dataset.axisX))&&Number.isFinite(Number(e.dataset.axisY)))})()"),
    '3D extrusion thickness grip projection');
  check(await evaluate("(() => {const h=document.querySelector('[data-testid=runtime-thickness-handle]');h.focus();return document.activeElement===h})()"),
    'thickness grip cannot receive keyboard focus');
  // Keep the same physical GPU context and browser orbit when an authorized
  // thickness edit, undo and direct drag replace the preview tessellation.
  check(await evaluate("(() => {const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');if(!c)return false;window.__intuit3dTest3DCanvas=c;window.__intuit3dTest3DContext=c.getContext('webgl2');return Boolean(window.__intuit3dTest3DContext)})()"),
    '3D editor has no actual WebGL2 context to preserve');
  // Physical Chromium clicks exercise the real Three camera and canvas.
  const cameraRev=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  for(const preset of ['top','front','right','isometric']){
    await pointerClick('runtime-camera-'+preset);
    const pose=await eventually(()=>evaluate(`(() => {
      const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');
      if(!c||c.dataset.cameraPreset!==${JSON.stringify(preset)})return null;
      const pos=(c.dataset.cameraPosition||'').split(',').map(Number);
      const target=(c.dataset.cameraTarget||'').split(',').map(Number);
      return pos.length===3&&target.length===3&&pos.every(Number.isFinite)&&target.every(Number.isFinite)?{pos,target}:null;
    })()`),'3D camera preset '+preset);
    if(preset==='top')check(pose.pos[2]>pose.target[2]&&Math.abs(pose.pos[0]-pose.target[0])<.01,'Top camera alignment');
    if(preset==='front')check(pose.pos[1]<pose.target[1]&&Math.abs(pose.pos[2]-pose.target[2])<.01,'Front camera alignment');
    if(preset==='right')check(pose.pos[0]>pose.target[0]&&Math.abs(pose.pos[1]-pose.target[1])<.01,'Right camera alignment');
    check(await evaluate("(() => {const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');return c===window.__intuit3dTest3DCanvas&&c?.getContext('webgl2')===window.__intuit3dTest3DContext})()"),'Camera preset reset WebGL2 context');
    check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===cameraRev,'Camera preset authored model revision');
  }
  // Select a real authored hole from the actual Three.js canvas using real
  // CDP pointer events, not a DOM callback or synthetic model edit.
  // Camera preset state is published synchronously, whereas the projected hole
  // markers are republished by the following animation frame. Never click a
  // stale ISO marker while the camera has already moved to TOP.
  const beforeTopMarkers=await evaluate("document.querySelector('[data-testid=runtime-3d-viewport] canvas')?.dataset.holePickMarkers");
  await pointerClick('runtime-camera-top');
  const visibleHole=await eventually(()=>evaluate(`(() => {
    const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');
    if(!c||c.dataset.cameraPreset!=='top'||
       c.dataset.holePickMarkers===${JSON.stringify(beforeTopMarkers)})return null;
    const h=JSON.parse(c.dataset.holePickMarkers||'[]').find(x=>x.id==='holeA');
    if(!h)return null;
    const rect=c.getBoundingClientRect();
    return {x:rect.left+h.x,y:rect.top+h.y};
  })()`),'projected actual 3D holeA');
  check(visibleHole.x>0&&visibleHole.x<1360&&visibleHole.y>0&&visibleHole.y<900,
    '3D hole projection is outside the browser viewport');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:visibleHole.x,y:visibleHole.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:visibleHole.x,y:visibleHole.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:visibleHole.x,y:visibleHole.y,button:'left',clickCount:1});
  const actualSolidPick=await evaluate(`(() => ({
    active:document.querySelector('[data-testid=runtime-active-hole]')?.textContent?.trim(),
    hint:document.querySelector('[data-testid=runtime-solid-selected-hole]')?.textContent?.trim(),
    quickEditor:Boolean(document.querySelector('[data-testid=runtime-solid-quickedit]')),
    pickTrace:document.querySelector('[data-testid=runtime-3d-viewport] canvas')?.dataset.pickTrace,
    target:document.elementFromPoint(${visibleHole.x},${visibleHole.y})?.outerHTML?.slice(0,300),
    canvasBounds:(()=>{const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');const r=c?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height}:null})(),
  }))()`);
  check(actualSolidPick.active?.includes('Selected circular cut: holeA'),
    '3D canvas click did not set the authoritative selected hole: '+JSON.stringify(actualSolidPick));
  check(await evaluate("document.querySelector('[data-testid=runtime-3d-viewport] canvas')?.dataset.cameraPreset==='top'"),
    'Stationary hole selection was mistaken for a camera drag');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===cameraRev,
    '3D hole selection accidentally authored a CAD revision');
  check(await evaluate("(() => {const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');return c===window.__intuit3dTest3DCanvas&&c?.getContext('webgl2')===window.__intuit3dTest3DContext})()"),
    '3D hole selection recreated the GPU context');
  // Genuine 3D canvas picking now opens a contextual, source-owned bore editor.
  // Use actual Chromium keyboard entry and pointer apply/undo, not a helper call.
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-solid-quickedit]')?.textContent?.includes('holeA')"),
    '3D-picked hole has no contextual precision editor');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-solid-quickedit-x]');e.focus();e.select();return document.activeElement===e})()"),
    'selected-hole X editor is not focusable');
  await send('Input.insertText',{text:'36'});
  await pointerClick('runtime-solid-quickedit-move');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value==='36'"),
    '3D-picked bore centre did not commit through SKETCH');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")!==cameraRev,
    'selected-hole 3D movement did not advance the authoritative revision');
  check(await evaluate("(() => {const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');return c===window.__intuit3dTest3DCanvas&&c?.getContext('webgl2')===window.__intuit3dTest3DContext})()"),
    '3D precision edit recreated the GPU context');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value==='35'"),
    '3D contextual centre edit was not undoable');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-solid-quickedit-diameter]');e.focus();e.select();return document.activeElement===e})()"),
    'selected-hole bore editor is not focusable after undo');
  await send('Input.insertText',{text:'13'});
  await pointerClick('runtime-solid-quickedit-resize');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='13'"),
    '3D-picked diameter did not commit through SKETCH');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='12'"),
    '3D contextual diameter edit was not undoable');
  // INTENT undo is an explicit compensating journal transaction: it restores
  // the original *values*, not the former revision counter. Export must remain
  // stale until physical STEP is rebuilt for this new authoritative revision.
  const afterContextualUndos=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  const beforeEditRevision=Number(cameraRev?.match(/[0-9]+/)?.[0]);
  const afterEditRevision=Number(afterContextualUndos?.match(/[0-9]+/)?.[0]);
  check(Number.isInteger(afterEditRevision)&&afterEditRevision>beforeEditRevision,
    '3D contextual undos did not preserve monotonic journal revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent")==='pending_exact_provider',
    '3D contextual undo falsely retained previous exact STEP authority');
  await screenshot('native-00b-3d-selected-hole-edit.png');
  await pointerClick('runtime-camera-isometric');
  await pointerClick('runtime-camera-fit');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===afterContextualUndos,
    'FIT altered the current journal revision after contextual edits');
  await screenshot('native-00-camera-views.png');
  check(await evaluate("(() => {const h=document.querySelector('[data-testid=runtime-thickness-handle]');h?.focus();return document.activeElement===h})()"),
    '3D camera controls did not return keyboard focus to thickness grip');
  await key('ArrowUp','ArrowUp',38);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='9'"),
    '3D keyboard thickness did not edit the actual parameter');
  check(await evaluate("(() => {const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');return c===window.__intuit3dTest3DCanvas && c?.getContext('webgl2')===window.__intuit3dTest3DContext && !document.querySelector('[data-testid=runtime-3d-preview-error]')})()"),
    'model edit recreated GPU context or failed bounded tessellation');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    '3D edit incorrectly claimed exact native geometry');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='8'"),
    'keyboard undo did not restore the authored extrusion parameter');
  const grip=await eventually(()=>evaluate(`(() => {
    const h=document.querySelector('[data-testid=runtime-thickness-handle]');
    if(!h||h.hidden)return null;
    const r=h.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,ax:Number(h.dataset.axisX),ay:Number(h.dataset.axisY)};
  })()`),'projected 3D pointer grip');
  check(grip.x>0&&grip.x<1360&&grip.y>0&&grip.y<900,
    '3D extrusion grip is outside Chromium viewport');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:grip.x,y:grip.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:grip.x,y:grip.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:grip.x+grip.ax*4,y:grip.y+grip.ay*4,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:grip.x+grip.ax*4,y:grip.y+grip.ay*4,button:'left',clickCount:1});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    '3D pointer drag did not commit the 8-to-12 mm authoritative edit');
  check(await evaluate("(() => {const c=document.querySelector('[data-testid=runtime-3d-viewport] canvas');return c===window.__intuit3dTest3DCanvas && c?.getContext('webgl2')===window.__intuit3dTest3DContext && !document.querySelector('[data-testid=runtime-3d-preview-error]')})()"),
    'direct 8-to-12 mm drag unexpectedly reset orbit canvas or WebGL context');
  await screenshot('native-00-3d-thickness-grip-12mm.png');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    '3D thickness gesture claimed exact geometry');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='8'"),
    'undo of 3D pointer gesture did not restore original thickness');
  // Real Chromium click + keyboard on the authoritative INTENT named-parameter
  // editor: both changes must be one journal revision, undoable and not exact.
  const parameterRevision=Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0]);
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-parameter-name]');e?.focus();e?.select();return document.activeElement===e})()"),
    'named parameter field cannot receive keyboard input');
  await send('Input.insertText',{text:'plateThickness'});
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-parameter-value]');e?.focus();e?.select();return document.activeElement===e})()"),
    'named parameter value field cannot receive keyboard input');
  await send('Input.insertText',{text:'12'});
  await pointerClick('runtime-parameter-apply');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-parameter-name]')?.value==='plateThickness' && document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'parameter rename + 8-to-12 mm edit did not reach the authoritative model');
  check(Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0])===parameterRevision+1,
    'named parameter edit did not produce exactly one authored revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'named parameter edit fabricated exact B-rep evidence');
  await screenshot('native-00c-named-thickness-parameter.png');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-parameter-name]')?.value==='thickness' && document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='8'"),
    'undo did not restore both parameter fields');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Z',code:'KeyZ',modifiers:10,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Z',code:'KeyZ',modifiers:10,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-parameter-name]')?.value==='plateThickness' && document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'redo did not restore the named parameter edit');
  // Real Chromium pointer/keyboard path through the accepted INTENT formula
  // table: preview must not commit, commit must be one undo frame, and no
  // native exactness may leak from a new derived parameter expression.
  const formulaRevision=Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0]);
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-formula-expression-0]');e?.focus();e?.select();return document.activeElement===e})()"),
    'formula spreadsheet field cannot receive keyboard focus');
  await send('Input.insertText',{text:'14'});
  await pointerClick('runtime-formula-preview');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-formula-impact]')?.textContent?.includes('plate')"),
    'model-owned parameter preview did not identify dependent rebuild');
  check(await evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'parameter preview mutated the authoritative model before commit');
  await pointerClick('runtime-formula-commit');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='14'"),
    'model-owned spreadsheet commit did not rebuild extrusion dimensions');
  check(Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0])===formulaRevision+1,
    'one edited formula row did not create exactly one journal revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'formula spreadsheet falsely promoted physical STEP authority');
  await screenshot('native-00d-formula-table-committed.png');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12' && document.querySelector('[data-testid=runtime-parameter-name]')?.value==='plateThickness'"),
    'formula spreadsheet undo did not restore the original named source');
  // A draft is NOT erased when a different authoritative inspector commits.
  // Exercise real Chromium keys and pointer clicks through the exact
  // #213 per-conflict review API, then undo both operations independently.
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-formula-expression-0]');e?.focus();e?.select();return document.activeElement===e})()"),
    'cannot draft stale sheet in real Chromium');
  await send('Input.insertText',{text:'16'});
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-parameter-value]');e?.focus();e?.select();return document.activeElement===e})()"),
    'cannot edit authoritative parameter during unsaved formula draft');
  await send('Input.insertText',{text:'13'});
  await pointerClick('runtime-parameter-apply');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='13' && !!document.querySelector('[data-testid=runtime-formula-stale]') && document.querySelector('[data-testid=runtime-formula-expression-0]')?.value==='16'"),
    'authoritative edit erased unsaved formula draft or stale indicator');
  await pointerClick('runtime-formula-preview');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-formula-conflicts]')?.textContent?.includes('edited_row_changed')"),
    'INTENT conflict did not appear in browser');
  check(await evaluate("document.querySelector('[data-testid=runtime-formula-commit]')?.disabled"),
    'unapproved stale draft erroneously allowed commit');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-formula-approve-0]');e?.click();return e?.checked})()"),
    'individual model conflict cannot be acknowledged');
  await pointerClick('runtime-formula-resolve');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-formula-value-comparison]')) && !document.querySelector('[data-testid=runtime-formula-commit]')?.disabled"),
    'explicit conflict review did not produce scalar comparison');
  check(await evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='13'"),
    'conflict approval implicitly changed model before final commit');
  // Explicit consent may be withdrawn before final commit. No stale ready
  // proposal may remain executable once its exact approval is revoked.
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-formula-approve-0]');e?.click();return e?.checked===false})()"),
    'cannot revoke individual conflict consent');
  check(await evaluate("document.querySelector('[data-testid=runtime-formula-commit]')?.disabled"),
    'revoked conflict consent left stale commit enabled');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-formula-approve-0]');e?.click();return e?.checked===true})()"),
    'cannot reapprove exact conflict');
  await pointerClick('runtime-formula-resolve');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-formula-value-comparison]')) && !document.querySelector('[data-testid=runtime-formula-commit]')?.disabled"),
    'reapproved conflict did not require another INTENT review');
  await pointerClick('runtime-formula-commit');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='16'"),
    'reviewed stale formula was not committed');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'reviewed spreadsheet fabricated exact geometry provenance');
  await screenshot('native-00d1-reviewed-parameter-conflict.png');
  for(const expected of ['13','12']){
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
    await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='"+expected+"'"),
      'reviewed parameter and concurrent inspector undo were not separately reversible');
  }
  // Exact same 12-mm state continues into existing save/reopen/undo tests.
  // Real browser save -> OS file picker -> isolated #188 validation Worker ->
  // explicit Replace -> same authoritative named source and undo journal.
  // No private owner archive or browser-local model serializer is involved.
  check(await evaluate(`(() => {
    window.__namedArchiveBlobs=[];
    const prior=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{window.__namedArchiveBlobs.push(blob);return prior(blob)};
    const save=[...document.querySelectorAll('button')].find(b=>b.textContent==='Save model archive');
    save?.click();return !!save;
  })()`),'named parameter archive cannot be saved by real browser');
  await eventually(()=>evaluate('window.__namedArchiveBlobs.length===1'),
    'named parameter browser Save did not create exactly one model archive');
  const namedArchive=await evaluate("(async()=>await window.__namedArchiveBlobs[0].text())()");
  check(namedArchive.includes('plateThickness'),
    'browser Save omitted the authoritative renamed parameter');
  const namedPath=resolve(artifacts,'native-browser-named-parameter.i3d-model.json');
  writeFileSync(namedPath,namedArchive);
  const namedDoc=await send('DOM.getDocument',{depth:1});
  const namedInput=await send('DOM.querySelector',{
    nodeId:namedDoc.root.nodeId,selector:'input[aria-label="Open INTUIT model archive"]'
  });
  check(namedInput.nodeId>0,'browser model file picker input missing');
  await send('DOM.setFileInputFiles',{nodeId:namedInput.nodeId,files:[namedPath]});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'isolated archive Worker did not reach import confirmation');
  check(await evaluate("document.querySelector('[data-testid=runtime-parameter-name]')?.value==='plateThickness'"),
    'import validation mutated the live model before confirmation');
  check(await evaluate(`(() => {
    const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')]
      .find(x=>x.textContent==='Replace with model archive');
    b?.click();return !!b;
  })()`),'browser refused to confirm named-parameter archive replacement');
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-import-review]') && document.querySelector('[data-testid=runtime-parameter-name]')?.value==='plateThickness' && document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'browser Worker reopen lost the renamed source or edited thickness');
  await screenshot('native-00e-named-parameter-reopened.png');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-parameter-name]')?.value==='thickness' && document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='8'"),
    'second undo failed to restore the 8 mm plate for downstream workflows');
  await pointerClick('runtime-feature-plate');
  await pointerClick('runtime-feature-remove');
  await eventually(()=>evaluate(
    "Boolean(document.querySelector('[data-testid=runtime-removed-extrusion]')) && "+
    "Boolean(document.querySelector('[data-testid=runtime-empty]')) && "+
    "document.querySelector('[data-testid=runtime-feature-plate]')?.textContent?.includes('tombstone')"
  ),'retired extrusion must not display cached geometry');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-export]')?.disabled"),
    'removed extrusion left native STEP action available');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent!=='pending_exact_provider'"),
    'orphaned cut was falsely shown as physically evaluated');
  await screenshot('native-00-lifecycle-pending-cut.png');
  check(await evaluate("(() => {window.__featureArchiveBlobs=[];const prior=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{window.__featureArchiveBlobs.push(blob);return prior(blob)};return true})()"),
    'cannot intercept real tombstone archive download');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Save model archive');b?.click();return !!b})()"),
    'cannot save deleted extrusion from browser');
  await eventually(()=>evaluate("window.__featureArchiveBlobs.length===1"),'tombstone archive download');
  const removedArchive=await evaluate("(async()=>await window.__featureArchiveBlobs[0].text())()");
  const removedPath=resolve(artifacts,'native-browser-removed-extrusion.i3d-model.json');
  writeFileSync(removedPath,removedArchive);
  const tree=await send('DOM.getDocument',{depth:1});
  const uploader=await send('DOM.querySelector',{
    nodeId:tree.root.nodeId,selector:'input[aria-label="Open INTUIT model archive"]'
  });
  check(uploader.nodeId>0,'model archive upload field absent');
  await send('DOM.setFileInputFiles',{nodeId:uploader.nodeId,files:[removedPath]});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'deleted extrusion archive not offered for review');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-import-review] button:last-child').click();return true})()"),
    'cannot reopen deleted extrusion');
  await eventually(()=>evaluate(
    "Boolean(document.querySelector('[data-testid=runtime-removed-extrusion]')) && "+
    "Boolean(document.querySelector('[data-testid=runtime-feature-restore]'))"
  ),'tombstone lost on save/reopen');
  await screenshot('native-00-lifecycle-reopened.png');
  await pointerClick('runtime-feature-restore');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-boundary]')) && "+
    "document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'restoring exact original extrusion ID did not restore valid preview');
  await pointerClick('runtime-feature-cascade-start');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-feature-cascade-confirmation]'))"),
    'cascade lacks explicit confirmation');
  await pointerClick('runtime-feature-cascade-confirm');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid=runtime-feature-restore]').length===1 && "+
    "document.querySelector('[data-testid=runtime-feature-cut]')?.textContent?.includes('tombstone')"),
    'cascade did not retire both linked features');
  check(await evaluate("!document.querySelector('[data-testid=runtime-boundary]')"),
    'cascaded cut retained visible current plate geometry');
  // Actual browser keyboard undo reverses the entire multi-event deletion.
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-plate]')?.textContent?.includes('preview_only') && "+
    "document.querySelector('[data-testid=runtime-feature-cut]')?.textContent?.includes('pending_exact_provider')"),
    'keyboard undo did not restore extrusion and cut together');
  await screenshot('native-00-lifecycle-undo-cascade.png');

  // Real clicks/keyboard edit admitted RUNTIME constraints, then a physical
  // Chromium pointer drag commits one semantic hole-center transaction.
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-hole-holeA-diameter]');e.focus();e.select();return document.activeElement===e})()"),
    'cannot focus independent hole dimension');
  await send('Input.insertText',{text:'16'});await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='16'"),'hole A diameter edit');
  check(await evaluate("document.querySelector('[data-testid=runtime-hole-holeB-diameter]')?.value==='12'"),
    'individual hole edit incorrectly changed second hole');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-move-cut-earlier]').click();return true})()"),
    'cannot move authored cut on timeline');
  check(await evaluate("(() => {const ids=[...document.querySelectorAll('[data-testid=runtime-order] .timeline-event')].map(x=>x.children[1]?.textContent);return ids.indexOf('cut')<ids.indexOf('plate')})()"),
    'authoritative timeline did not move cut earlier');
  // Actual keyboard shortcut, with button rather than input focused.
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
  await eventually(()=>evaluate("(() => {const ids=[...document.querySelectorAll('[data-testid=runtime-order] .timeline-event')].map(x=>x.children[1]?.textContent);return ids.indexOf('plate')<ids.indexOf('cut')})()"),'timeline undo from keyboard');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-mode-sketch]').click();return true})()"),'cannot enter sketch viewport');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch-hole-holeA]'))"),'sketch handle not rendered');
  const drag=await evaluate(`(() => {
    const e=document.querySelector('[data-testid=runtime-sketch-hole-holeA]');
    const rect=e.getBoundingClientRect();
    const matrix=e.ownerSVGElement.getScreenCTM();
    const p0=new DOMPoint(0,0).matrixTransform(matrix);
    const p8=new DOMPoint(8,0).matrixTransform(matrix);
    return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,dx:p8.x-p0.x};
  })()`);
  check(Number.isFinite(drag.dx)&&Math.abs(drag.dx)>4,'sketch CTM is not draggable');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x,y:drag.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.x,y:drag.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x+drag.dx,y:drag.y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x+drag.dx,y:drag.y,button:'left',clickCount:1});
  await eventually(()=>evaluate("Math.abs(Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)-43)<0.6"),
    'physical sketch handle drag did not commit the hole A center');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'hole drag falsely promoted cut to exact');
  await screenshot('native-00-hole-drag-timeline.png');
  // Real physical Chromium pointer and keyboard operations, not DOM-dispatched input.
  const dragDimensionHandle=async(testid,millimetres)=>{
    const pos=await evaluate(`(() => {
      const e=document.querySelector('[data-testid="${testid}"]');
      if(!e)return null;
      const rect=e.getBoundingClientRect(),m=e.ownerSVGElement.getScreenCTM();
      const p0=new DOMPoint(0,0).matrixTransform(m);
      const p1=new DOMPoint(${millimetres},0).matrixTransform(m);
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,dx:p1.x-p0.x};
    })()`);
    check(pos&&Number.isFinite(pos.dx)&&Math.abs(pos.dx)>3,'dimension handle cannot be projected: '+testid);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x,y:pos.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x+pos.dx,y:pos.y,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x+pos.dx,y:pos.y,button:'left',clickCount:1});
  };
  const beforeResize=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  await dragDimensionHandle('runtime-sketch-dimension-width',12);
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-dimension-width]')?.value)===132"),
    'physical plate-width handle did not edit the authoritative sketch');
  await dragDimensionHandle('runtime-sketch-dimension-holeB.diameter',2);
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-hole-holeB-diameter]')?.value)===16"),
    'physical hole-B diameter handle did not edit the correct constraint');
  check(await evaluate("document.querySelector('[data-testid=runtime-hole-holeA-diameter]')?.value==='16'"),
    'diameter gesture disturbed hole A');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-sketch-dimension-depth]');e.focus();return document.activeElement===e})()"),
    'keyboard-accessible depth dimension could not focus');
  await key('ArrowUp','ArrowUp',38);
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-dimension-depth]')?.value)===81"),
    'depth keyboard nudge did not edit authoritative sketch');
  check((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))!==beforeResize,
    'direct sketch gestures created no journal revisions');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'direct sketch edit incorrectly asserted exact geometry');
  await screenshot('native-00b-direct-dimensions.png');
  // Two real viewport clicks create a solved circle via one authoritative
  // RUNTIME/SKETCH transaction. The first click is ephemeral; no dummy cut is
  // journalled or exported. Pointer coordinates use the actual SVG CTM.
  await pointerClick('runtime-circle-tool');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-circle-stage]'))"),'circle tool not armed');
  const beforeCircle=Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0]);
  const clickSketchPoint=async(x,y)=>{
    const pos=await evaluate(`(() => {
      const svg=document.querySelector('[data-testid=runtime-sketch]');
      if(!svg)return null;
      const matrix=svg.getScreenCTM();
      const p=new DOMPoint(${x},81-${y}).matrixTransform(matrix);
      return {x:p.x,y:p.y};
    })()`);
    check(pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y),'cannot project circle click');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x,y:pos.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x,y:pos.y,button:'left',clickCount:1});
  };
  await clickSketchPoint(60,65);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-circle-stage]')?.textContent?.includes('Click radius')"),'first circle click did not acquire centre');
  check(Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0])===beforeCircle,
    'first circle click incorrectly journalled incomplete intent');
  await screenshot('native-00b-circle-draft.png');
  await clickSketchPoint(65,65);
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===3"),
    'two-click circle was not admitted into the authoritative sketch');
  check(Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0])===beforeCircle+1,
    'two-click circle did not create exactly one undoable document revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'sketch-drawn circle falsely promoted STEP/exact state');
  await screenshot('native-00b-circle-committed.png');
  // Newly drawn holes are immediately editable, including real radial
  // pointer drags and keyboard arrows; no browser-side CAD state is authored.
  const drawnId=await evaluate("Array.from(document.querySelectorAll('[data-testid^=runtime-hole-editor-]')).map(x=>x.getAttribute('data-testid').slice(20)).find(x=>x.startsWith('hole.user.'))");
  check(drawnId,'drawn hole ID missing');
  const diameterHandle=await evaluate(`(() => {
    const h=document.querySelector('[data-testid="runtime-sketch-diameter-${drawnId}"]');
    if(!h)return null;
    const x=Number(h.getAttribute('cx')),y=Number(h.getAttribute('cy')),m=h.getScreenCTM();
    const a=new DOMPoint(x,y).matrixTransform(m);
    const b=new DOMPoint(x,y-2).matrixTransform(m);
    return {x:a.x,y:a.y,dx:b.x-a.x,dy:b.y-a.y};
  })()`);
  check(diameterHandle&&Number.isFinite(diameterHandle.dy)&&Math.abs(diameterHandle.dy)>3,
    'radial diameter handle cannot be projected into actual Chromium');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:diameterHandle.x,y:diameterHandle.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:diameterHandle.x,y:diameterHandle.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:diameterHandle.x+diameterHandle.dx,y:diameterHandle.y+diameterHandle.dy,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:diameterHandle.x+diameterHandle.dx,y:diameterHandle.y+diameterHandle.dy,button:'left',clickCount:1});
  const drawnDiameter=()=>evaluate(`Number(document.querySelector('[data-testid="runtime-hole-${drawnId}-diameter"]')?.value)`);
  await eventually(async()=>await drawnDiameter()===14,'radial pointer did not commit 14 mm solved diameter');
  check(await evaluate(`document.querySelector('[data-testid=runtime-active-hole]')?.textContent.includes('${drawnId}')`),
    'selected radial cut did not reach inspector');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'radial sketch edit incorrectly promoted physical exactness');
  await screenshot('native-00b-circle-radial-edited.png');
  check(await evaluate(`(() => {const h=document.querySelector('[data-testid="runtime-sketch-diameter-${drawnId}"]');h?.focus();return document.activeElement===h})()`),
    'new radial diameter handle was not keyboard focusable');
  await key('ArrowRight','ArrowRight',39);
  await eventually(async()=>await drawnDiameter()===15,'keyboard radial arrow did not author 15 mm diameter');
  const historyButton=async(label)=>evaluate(`(() => {
    const b=[...document.querySelectorAll('.runtime-shell button')].find(x=>x.textContent?.trim()===${JSON.stringify(label)});
    b?.click();return !!b;
  })()`);
  check(await historyButton('Undo'),'cannot undo radial keyboard resize');
  await eventually(async()=>await drawnDiameter()===14,'undo lost pointer-edited diameter');
  check(await historyButton('Undo'),'cannot undo radial pointer resize');
  await eventually(async()=>await drawnDiameter()===10,'undo lost original drawn diameter');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Undo');b?.click();return !!b})()"),'cannot undo sketch drawn circle');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===2"),
    'one undo did not remove drawn circle');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Redo');b?.click();return !!b})()"),'cannot redo sketch drawn circle');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===3"),
    'redo did not restore drawn circle identity');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Undo');b?.click();return !!b})()"),'cannot clear circle fixture for following regression');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===2"),
    'cleanup undo did not restore two-hole fixture');
  // Actual Chromium clicks, keyboard-model transactions and rendered circle.
  const beforeAdd=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-add-hole]').click();return true})()"),'cannot add a real sketch hole');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===3"),'added hole did not reach React inspector');
  const addedId=await evaluate("Array.from(document.querySelectorAll('[data-testid^=runtime-hole-editor-]')).map(x=>x.getAttribute('data-testid')?.slice(20)).find(x=>x?.startsWith('hole.user.'))");
  check(typeof addedId==='string'&&addedId.startsWith('hole.user.'),'new hole identity missing');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent.includes('3 displayed circular holes')"),'added circle not shown in solved profile');
  check(await evaluate(`Boolean(document.querySelector('[data-testid="runtime-sketch-hole-${addedId}"]'))`),'added circle has no drag affordance');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),'new cut falsely labelled exact');
  await screenshot('native-00c-added-hole.png');
  check(await evaluate(`(() => {document.querySelector('[data-testid="runtime-remove-hole-${addedId}"]').click();return true})()`),'cannot remove added hole');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===2"),'removed hole still in authoritative inspector');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Undo');b.click();return true})()"),'cannot undo hole removal');
  await eventually(()=>evaluate(`Boolean(document.querySelector('[data-testid="runtime-hole-editor-${addedId}"]'))`),'undo lost new circle identity');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent!=="+JSON.stringify(beforeAdd)),'add/remove did not author journal revisions');

  // Real Chromium pointer click, authoritative solver admission and a
  // six-hole 3D preview (three originals including added one + three copies).
  const patternButton=await evaluate(`(() => {
    const b=document.querySelector('[data-testid=runtime-pattern-holes]');
    b.scrollIntoView({block:'center',behavior:'instant'});
    const r=b.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  check(patternButton&&patternButton.y>0&&patternButton.y<900,
    'hole pattern control is not reachable by Chromium pointer');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:patternButton.x,y:patternButton.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:patternButton.x,y:patternButton.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:patternButton.x,y:patternButton.y,button:'left',clickCount:1});
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===6"),
    'physical pointer did not commit solver-backed rectangular array');
  check(await evaluate("Array.from(document.querySelectorAll('[data-testid^=runtime-hole-editor-]')).filter(x=>x.dataset.testid.startsWith('runtime-hole-editor-array.')).length===3"),
    'array did not author three stable copied hole IDs');
  check(await evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent.includes('6 displayed circular holes')"),
    'one-shot array not rendered in actual viewport');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'array incorrectly promoted preview geometry to exact');
  await screenshot('native-00d-one-shot-hole-array.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Undo');b.click();return true})()"),
    'array undo cannot be triggered');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===3"),
    'one undo did not remove all three array copies');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Redo');b.click();return true})()"),
    'array redo cannot be triggered');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===6"),
    'array redo did not restore independent circles and IDs');

  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-mode-solid]').click();return true})()"),'cannot return to solid viewport');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-3d-viewport]'))"),'3D preview after sketch drag');

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
  check(await evaluate("!document.querySelector('[data-testid=runtime-native-download-cached]').disabled"),
    'RUNTIME did not retain current, verified STEP for explicit download');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-evidence-zip]')?.disabled"),
    'synthetic/OCP browser fixture was offered as pinned OCCT8 independent-CAD custody');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-evidence]')?.textContent.includes('Through-holes:')"),
    'browser cannot inspect same-revision experimental provider result');
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
  check(await evaluate("document.querySelector('[data-testid=runtime-native-download-cached]')?.disabled"),
    'retrospective edit left a stale RUNTIME STEP receipt downloadable');
  check(await evaluate("!document.querySelector('[data-testid=runtime-native-evidence]')"),
    'old native physical receipt survived a journal revision edit');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'sketch edit fabricated exact cut');
  await screenshot('native-03-edit-cancels-stale.png');

  // The edited revision can be evaluated and downloaded again on demand.
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-export]').click();return true})()"),
    'cannot re-evaluate edited model');
  await eventually(()=>evaluate('window.__nativeStepBlobs.length===2'),'edited STEP download');
  check(await evaluate("(async()=>{const a=await window.__nativeStepBlobs[0].text();const b=await window.__nativeStepBlobs[1].text();return a!==b})()"),
    'edited project reused stale STEP bytes');
  // Newly accepted INTENT freeze contract exercised by actual Chromium clicks,
  // keyboard dimension edits, undo/redo, local archive save and file reopen.
  check(await evaluate("document.querySelector('[data-testid=runtime-thickness-link-state]')?.textContent.includes('Linked:')"),
    'initial inspector does not reflect authoritative parameter link');
  const freezeButton=await evaluate(`(() => {
    const b=document.querySelector('[data-testid=runtime-freeze-thickness]');
    b?.scrollIntoView({block:'center',behavior:'instant'});
    const r=b?.getBoundingClientRect();
    return r ? {x:r.left+r.width/2,y:r.top+r.height/2,disabled:b.disabled}:null;
  })()`);
  check(freezeButton&&!freezeButton.disabled&&freezeButton.y>0&&freezeButton.y<900,
    'Make Independent button not pointer-operable');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:freezeButton.x,y:freezeButton.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:freezeButton.x,y:freezeButton.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:freezeButton.x,y:freezeButton.y,button:'left',clickCount:1});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-thickness-link-state]')?.textContent.includes('Independent:')"),
    'pointer freeze did not detach the authoritative binding');
  check(await evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'freeze reverted edited dimension instead of preserving 12 mm');
  check(await evaluate("document.querySelector('[data-testid=runtime-freeze-thickness]')?.disabled"),
    'freeze was not disabled for an independent dimension');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'freeze incorrectly promoted native exactness');
  await screenshot('native-04-parameter-frozen.png');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-dimension-thickness]');e.focus();e.select();return document.activeElement===e})()"),
    'independent thickness input did not focus');
  await send('Input.insertText',{text:'15'});await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='15'"),
    'independent 15 mm editing did not rebuild preview');
  check(await evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent.includes('15 mm extrude')"),
    'independent thickness does not reach actual viewport geometry');
  // Undo edits, undo freeze, and redo both through the visible toolbar.
  const clickButton=async(label)=>check(await evaluate(`(() => {
    const b=[...document.querySelectorAll('.toolstrip button')].find(e=>e.textContent===${JSON.stringify(label)});
    if(!b||b.disabled)return false;
    b.click();return true;
  })()`),'cannot click '+label);
  await clickButton('Undo');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='12'"),
    'undo direct thickness edit');
  await clickButton('Undo');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-thickness-link-state]')?.textContent.includes('Linked:')"),
    'undo freeze did not restore parameter and dependency');
  await clickButton('Redo');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-thickness-link-state]')?.textContent.includes('Independent:')"),
    'redo freeze did not detach parameter');
  await clickButton('Redo');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='15'"),
    'redo independent edit not applied');
  // The archived data is generated by the same actual Save button used by users.
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Save model archive');b?.click();return !!b})()"),
    'cannot save authoritative archive');
  await eventually(()=>evaluate("window.__nativeStepBlobs.length===3"),'browser archive Blob');
  const savedArchive=await evaluate("(async()=>await window.__nativeStepBlobs.at(-1).text())()");
  check(savedArchive.includes('parameter-freeze')||savedArchive.includes('workbench.freeze'),
    'archive did not preserve freeze journal');
  const archivePath=resolve(artifacts,'native-browser-frozen-plate.i3d-model.json');
  writeFileSync(archivePath,savedArchive);
  const {root}=await send('DOM.getDocument',{depth:1});
  const input=await send('DOM.querySelector',{
    nodeId:root.nodeId,selector:'input[aria-label="Open INTUIT model archive"]'
  });
  check(input.nodeId>0,'model import input missing');
  await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[archivePath]});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'saved model archive was not reviewed for import');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(x=>x.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'cannot reopen frozen archive');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-thickness-link-state]')?.textContent.includes('Independent:')&&document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='15'"),
    'reopened model lost independent dimension');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'reopened model fabricated native exactness');
  await screenshot('native-05-frozen-archive-reopened.png');
  // A separate build must leave verified bytes in the persistent RUNTIME
  // coordinator without silently downloading or reusing stale old geometry.
  check(await evaluate("document.querySelector('[data-testid=runtime-native-download-cached]')?.disabled"),
    'reopened archive incorrectly retained an old STEP receipt');
  const beforeBuildCount=await evaluate('window.__nativeStepBlobs.length');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-build]').click();return true})()"),
    'cannot initiate build-only native revision');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-native-evidence]'))"),
    'new RUNTIME receipt after archive reopen');
  check(await evaluate('window.__nativeStepBlobs.length')===beforeBuildCount,
    'build-only unexpectedly downloaded a STEP blob');
  check(await evaluate("!document.querySelector('[data-testid=runtime-native-download-cached]').disabled"),
    'build-only did not enable live, revision-fenced download');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-download-cached]').click();return true})()"),
    'cannot download current-session STEP');
  await eventually(()=>evaluate('window.__nativeStepBlobs.length==='+String(beforeBuildCount+1)),
    'explicit cached STEP download');
  check(await evaluate("(async()=>{const a=await window.__nativeStepBlobs.at(-1).text();return a.includes('SYNTHETIC UI TEST, NOT OCCT')})()"),
    'cached STEP contents do not match the verified local HTTP fixture');
  await screenshot('native-06-live-session-build-and-download.png');
  // Opt-in live rebuild must rebuild the edited authoritative revision without
  // an extra click, retaining bytes but never automatically downloading them.
  const beforeAutoCount=await evaluate('window.__nativeStepBlobs.length');
  const beforeAutoStep=await evaluate("(async()=>await window.__nativeStepBlobs.at(-1).text())()");
  check(await evaluate("(() => {const x=document.querySelector('[data-testid=runtime-native-auto-rebuild]');x.click();return x.checked})()"),
    'cannot enable live native rebuild');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-dimension-thickness]');e.focus();e.select();return document.activeElement===e})()"),
    'cannot focus retrospective thickness for live native rebuild');
  await send('Input.insertText',{text:'17'});await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-thickness]')?.value==='17'"),
    'live edit did not commit authoritative 17 mm thickness');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-native-download-cached]')?.disabled"),
    'live edit did not immediately revoke old native receipt');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-native-evidence]')) && !document.querySelector('[data-testid=runtime-native-download-cached]').disabled"),
    'live RUNTIME rebuild did not publish the newly admitted revision');
  check(await evaluate('window.__nativeStepBlobs.length')===beforeAutoCount,
    'automatic native evaluation unexpectedly downloaded a STEP file');
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-native-download-cached]').click();return true})()"),
    'live-rebuilt current STEP cannot be explicitly downloaded');
  await eventually(()=>evaluate('window.__nativeStepBlobs.length==='+String(beforeAutoCount+1)),
    'live-rebuilt STEP explicit download');
  check(await evaluate("(async()=>await window.__nativeStepBlobs.at(-1).text())()")!==beforeAutoStep,
    'live reconstruction reused the previous-revision STEP payload');
  await screenshot('native-07-auto-native-rebuild-after-dimension-edit.png');
  // Actual Chromium inputs -> admitted combined RUNTIME/SKETCH layout edit.
  // HTTP STEP bytes remain explicitly synthetic UI test evidence.
  // Start this dimensional acceptance with a clean two-hole plate; the prior
  // array/pointer tests intentionally leave six circles and are not a valid
  // physical comparator for an independent two-hole pitch/bore adjustment.
  await pointerClick('runtime-new-plate');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'new authoritative plate did not open replacement review');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(x=>x.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'cannot start fresh model-backed two-hole plate');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===2"),
    'fresh plate was not restored to two authored hole IDs');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-native-evidence]'))"),
    'fresh plate was not automatically rebuilt by the persistent native session');
  const beforeLayout=await evaluate(`(() => {
    const val=id=>Number(document.querySelector('[data-testid="runtime-hole-'+id+'"]')?.value);
    return {a:val('holeA-x'),b:val('holeB-x'),
      da:val('holeA-diameter'),db:val('holeB-diameter')};
  })()`);
  // A new project starts with one selected circle to prevent accidental
  // whole-group drags. Explicitly Ctrl/checkbox-select both before committing
  // a two-hole dimensional layout edit; do not rely on a hidden default.
  for (const hole of ['holeA','holeB']) {
    if (!await evaluate(`document.querySelector('[data-testid=runtime-layout-select-${hole}]')?.checked`))
      await pointerClick(`runtime-layout-select-${hole}`);
  }
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-layout-select-holeA]')?.checked && document.querySelector('[data-testid=runtime-layout-select-holeB]')?.checked"),
    'explicit two-hole selection for retrospective layout edit');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-layout-scaleX]');e.focus();e.select();return document.activeElement===e})()"),
    'cannot focus combined layout pitch dimension');
  await send('Input.insertText',{text:'120'});
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-layout-radiusScale]');e.focus();e.select();return document.activeElement===e})()"),
    'cannot focus bore resize dimension');
  await send('Input.insertText',{text:'125'});
  await pointerClick('runtime-layout-apply');
  await eventually(()=>evaluate(`(() => {
    const n=id=>Number(document.querySelector('[data-testid="runtime-hole-'+id+'"]')?.value);
    return Math.abs((n('holeB-x')-n('holeA-x'))-1.2*${beforeLayout.b-beforeLayout.a})<0.001 &&
      Math.abs(n('holeA-diameter')-1.25*${beforeLayout.da})<0.001 &&
      Math.abs(n('holeB-diameter')-1.25*${beforeLayout.db})<0.001 &&
      document.querySelector('[data-testid=runtime-layout-scaleX]')?.value==='100';
  })()`),'browser did not commit selected pitch and both bore diameters');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'retrospective layout was misrepresented as exact');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-native-evidence]')) && !document.querySelector('[data-testid=runtime-native-download-cached]').disabled"),
    'layout edit failed to auto rebuild current native session revision');
  await screenshot('native-08-retrospective-hole-layout-rebuild.png');
  // Negative end-to-end checks: an unrecognized provider and corrupt binary
  // must produce explicit refused states, without replacing previously verified
  // same-revision bytes. The live RUNTIME intentionally retains that valid cache.
  mockReplyMode='wrong-provider';
  await pointerClick('runtime-native-build');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-native-result]')?.textContent?.includes('invalid_host_reply')"),
    'RUNTIME did not refuse the unrecognized provider');
  check(await evaluate("!document.querySelector('[data-testid=runtime-native-download-cached]')?.disabled"),
    'failed provider refresh incorrectly discarded earlier verified same-revision STEP');
  mockReplyMode='bad-step-digest';
  await pointerClick('runtime-native-build');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-native-result]')?.textContent?.includes('invalid_step')"),
    'RUNTIME did not refuse mismatched STEP SHA-256');
  check(await evaluate("!document.querySelector('[data-testid=runtime-native-download-cached]')?.disabled"),
    'bad-digest refresh incorrectly discarded earlier verified same-revision STEP');
  mockReplyMode='valid';
  // One actual user pointer click must traverse the native request and the
  // pinned custody fence. This is an OCP-shaped synthetic responder, so no
  // pinned C++ archive/receipt/STEP ZIP may be offered or downloaded.
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-native-build-pinned-evidence]').disabled"),
    'one-click pinned evidence action is not available for an authored cut');
  const beforePinnedAttempt=await evaluate('window.__nativeStepBlobs.length');
  const beforePinnedRevision=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  await pointerClick('runtime-native-build-pinned-evidence');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-native-result]')?.textContent?.includes('Pinned STEP custody unavailable')"),
    'synthetic OCP was not explicitly refused for one-click pinned STEP custody');
  check(await evaluate('window.__nativeStepBlobs.length')===beforePinnedAttempt,
    'OCP or synthetic provider caused a pinned-evidence ZIP to be published');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===beforePinnedRevision,
    'one-click STEP evaluation edited the authoritative CAD journal');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-evidence-zip]')?.disabled"),
    'one-click OCP evaluation incorrectly enabled a pinned receipt');
  await screenshot('native-08b-pinned-custody-refusal.png');
  // Actual Chromium Ctrl+N creates a sketch-only project, with an Escape-safe
  // replacement gate. The existing model must survive cancellation.
  const projectBeforeNew=await evaluate("document.querySelector('.browser-project')?.textContent");
  const ctrlN={key:'n',code:'KeyN',windowsVirtualKeyCode:78,modifiers:2};
  await send('Input.dispatchKeyEvent',{type:'keyDown',...ctrlN});
  await send('Input.dispatchKeyEvent',{type:'keyUp',...ctrlN});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'Ctrl+N did not offer a sketch-first project');
  await key('Escape','Escape',27);
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-import-review]')"),
    'Escape did not cancel new-project review');
  check(await evaluate("document.querySelector('.browser-project')?.textContent")===projectBeforeNew,
    'Cancel unexpectedly replaced the authoritative model');
  await send('Input.dispatchKeyEvent',{type:'keyDown',...ctrlN});
  await send('Input.dispatchKeyEvent',{type:'keyUp',...ctrlN});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'Second Ctrl+N did not offer the project');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(x=>x.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'Cannot confirm fresh sketch-first project');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-create-extrusion]')?.disabled===false && !document.querySelector('[data-testid=runtime-feature-plate]')"),
    'Fresh sketch project not solved and ready for extrusion');
  check(await evaluate("document.querySelector('.project-title')?.textContent?.includes('Sketch project')"),
    'Sketch-only project incorrectly titled as completed plate');
  await screenshot('native-09-model-first-new-sketch-shortcut.png');
  // Real Chromium semantic multi-selection, model-backed 90-degree rotation,
  // one-revision commit and keyboard Undo/Redo; no synthetic state mutation.
  const rigidBefore=await evaluate(`(() => {
    const read=(id,field)=>Number(document.querySelector('[data-testid="runtime-hole-'+id+'-'+field+'"]')?.value);
    return {a:{x:read('holeA','x'),y:read('holeA','y'),d:read('holeA','diameter')},
      b:{x:read('holeB','x'),y:read('holeB','y'),d:read('holeB','diameter')}};
  })()`);
  check(Object.values(rigidBefore.a).every(Number.isFinite)&&Object.values(rigidBefore.b).every(Number.isFinite),
    'missing source hole values for rigid rotation');
  for(const id of ['holeA','holeB']){
    if(!await evaluate(`document.querySelector('[data-testid=runtime-layout-select-${id}]')?.checked`))
      await pointerClick('runtime-layout-select-'+id);
  }
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-rigid-apply]')?.disabled===false"),
    'selected-hole rigid rotation button disabled');
  const rigidRevision=Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/[0-9]+/)?.[0]);
  await pointerClick('runtime-rigid-apply');
  const rigidPivot={x:(rigidBefore.a.x+rigidBefore.b.x)/2,y:(rigidBefore.a.y+rigidBefore.b.y)/2};
  await eventually(()=>evaluate(`(() => {
    const n=(id,field)=>Number(document.querySelector('[data-testid="runtime-hole-'+id+'-'+field+'"]')?.value);
    return Math.abs(n('holeA','x')-${rigidPivot.x-(rigidBefore.a.y-rigidPivot.y)})<1e-5 &&
      Math.abs(n('holeA','y')-${rigidPivot.y+(rigidBefore.a.x-rigidPivot.x)})<1e-5 &&
      Math.abs(n('holeB','x')-${rigidPivot.x-(rigidBefore.b.y-rigidPivot.y)})<1e-5 &&
      Math.abs(n('holeB','y')-${rigidPivot.y+(rigidBefore.b.x-rigidPivot.x)})<1e-5 &&
      n('holeA','diameter')===${rigidBefore.a.d} && n('holeB','diameter')===${rigidBefore.b.d};
  })()`),'rigid transform did not commit real rotated hole centres');
  check(Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/[0-9]+/)?.[0])===rigidRevision+1,
    'rigid transform did not advance exactly one model revision');
  await screenshot('native-10a-selected-rigid-rotation.png');
  const undoRigid=async()=>{
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
    await eventually(()=>evaluate(`Math.abs(Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)-${rigidBefore.a.x})<1e-5 &&
      Math.abs(Number(document.querySelector('[data-testid=runtime-hole-holeB-y]')?.value)-${rigidBefore.b.y})<1e-5`),
      'rigid Undo did not restore both original hole positions');
  };
  await undoRigid();
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await eventually(()=>evaluate(`Math.abs(Number(document.querySelector('[data-testid=runtime-hole-holeA-y]')?.value)-${rigidPivot.y+(rigidBefore.a.x-rigidPivot.x)})<1e-5`),
    'rigid Redo did not recover rotated geometry');
  await undoRigid(); // restore sketch-first starting geometry for bolt-circle test
  // Real Chromium pointer and keyboard: create an admitted bolt-circle from
  // the sketch-first project, Undo all new holes, then Redo identical IDs.
  const orbitRevision=Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0]);
  check(Number.isSafeInteger(orbitRevision),'invalid bolt-circle starting revision');
  await pointerClick('runtime-orbit-commit');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=\"runtime-hole-editor-orbit.\"]').length===2"),
    'bolt-circle click did not commit two SKETCH circles');
  check(Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0])===orbitRevision+1,
    'bolt circle did not commit exactly one model revision');
  check(await evaluate("document.querySelector('[data-testid=\"runtime-status-sketch.plate\"]')?.textContent==='analytic_profile_only'"),
    'bolt-circle solver did not admit the sketch');
  await screenshot('native-10-circular-bolt-array.png','native-11-local-recovery-after-reload.png','native-12-selected-profile-direct-drag.png');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=\"runtime-hole-editor-orbit.\"]').length===0"),
    'bolt-circle Undo did not remove the entire array');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=\"runtime-hole-editor-orbit.\"]').length===2"),
    'bolt-circle Redo did not recover the same hole IDs');
  // Browser-local crash recovery: real IndexedDB save from the committed
  // RUNTIME journal, real pointer disclosure/import review, cancel and reopen.
  // This is independent of Windows Firefox's private #177 archive acceptance.
  const recoveryRevision=Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0]);
  await eventually(()=>evaluate("(() => {const row=document.querySelector('.runtime-local-recovery-entry');return Boolean(row&&row.textContent.includes('revision "+recoveryRevision+"')&&row.textContent.includes('unexported draft'));})()"),
    'automatic local recovery did not persist the latest unexported revision');
  await pointerClick('runtime-local-recovery-toggle');
  const recoveryRestoreId=await evaluate(
    "document.querySelector('[data-testid^=\"runtime-recovery-restore-\"]')?.dataset.testid");
  check(recoveryRestoreId?.startsWith('runtime-recovery-restore-session.'),
    'missing session-specific local recovery checkpoint');
  await pointerClick(recoveryRestoreId);
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'recovery failed isolated Worker validation or did not require replacement review');
  check(await evaluate("document.querySelector('[data-testid=runtime-import-incoming]')?.textContent.includes('revision "+recoveryRevision+"')"),
    'local recovery review lost the journal revision');
  await pointerClick('runtime-import-review-cancel');
  check(Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0])===recoveryRevision,
    'cancelling recovery mutated the current model');
  // Reload the entire React application: in-memory state is destroyed.
  // The user must explicitly restore the durable IndexedDB copy.
  await send('Page.reload',{ignoreCache:true});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-local-recovery-toggle]'))"),
    'local recovery UI unavailable after browser reload');
  await eventually(()=>evaluate("document.querySelector('[data-testid=\""+recoveryRestoreId+"\"]')!==null"),
    'the checkpoint was not durable across a full browser reload');
  await pointerClick('runtime-local-recovery-toggle');
  await pointerClick(recoveryRestoreId);
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'recovered checkpoint did not pass Worker validation after reload');
  await pointerClick('runtime-import-review-confirm');
  // Decode the browser's visible revision outside the CDP expression string.
  // Backslash escapes inside nested JS strings can silently turn /\d+/ into /d+/.
  // A passing check also requires the confirmation dialog to have closed.
  try{
    await eventually(async()=>{
      const label=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
      const got=Number(String(label??'').match(/[0-9]+/)?.[0]);
      return got===recoveryRevision &&
        await evaluate("document.querySelector('[data-testid=runtime-import-review]')===null");
    },'explicit recovery did not restore the original authoritative revision');
  }catch(error){
    const observed=await evaluate(`(() => JSON.stringify({
      revision:document.querySelector('[data-testid=runtime-revision]')?.textContent??null,
      reviewVisible:Boolean(document.querySelector('[data-testid=runtime-import-review]')),
      processing:document.querySelector('[data-testid=runtime-import-stage]')?.textContent??null,
      message:document.querySelector('.runtime-message')?.textContent??null,
      archiveState:document.querySelector('[data-testid=runtime-archive-state]')?.textContent??null,
    }))()`);
    await screenshot('native-11-recovery-revision-failure.png').catch(()=>{});
    throw Error(`Recovery revision mismatch (expected ${recoveryRevision}; observed ${observed}): ${String(error)}`);
  }
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=\"runtime-hole-editor-orbit.\"]').length===2"),
    'recovering an archive lost newly authored circular holes');
  check(await evaluate("document.querySelector('[data-testid=runtime-archive-state]')?.textContent.includes('UNEXPORTED')"),
    'IndexedDB recovery incorrectly claimed an OS-level exported archive');
  await screenshot('native-11-local-recovery-after-reload.png');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=\"runtime-hole-editor-orbit.\"]').length===0"),
    'reopened recovery lost authoritative undo frames');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=\"runtime-hole-editor-orbit.\"]').length===2"),
    'reopened recovery failed redo of authored circular holes');
  // Real Chromium pointer-selection and keyboard input, not a synthetic React call.
  await pointerClick('runtime-mode-sketch');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch-outline-hole-holeA]'))"),
    'fresh admitted plate sketch not visible');
  await pointerClick('runtime-sketch-outline-hole-holeA');
  const beforeNudge=Number(await evaluate("document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value"));
  const beforeNudgeRevision=Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0]);
  await key('ArrowRight','ArrowRight',39);
  await eventually(()=>evaluate(`Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)===${beforeNudge+1}`),
    'arrow-key nudge did not move selected hole through the authoritative model');
  check(Number((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/\d+/)?.[0])===beforeNudgeRevision+1,
    'arrow-key nudge did not commit precisely one journal revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-download-cached]')?.disabled"),
    'arrow-key nudge retained a stale native STEP receipt');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await eventually(()=>evaluate(`Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)===${beforeNudge}`),
    'keyboard nudge undo failed to restore the authored centre');
  // Real Chromium contour selection and semantic-handle drag. Pointer location
  // derives from the actual SVG screen CTM, never a direct React/RUNTIME call.
  await pointerClick('runtime-profile-select-mode');
  const contourPick=await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=runtime-sketch]');
    if(!svg)return null;
    const matrix=svg.getScreenCTM();
    if(!matrix)return null;
    // Sketch Y is inverted in the renderer: model (60,65) -> SVG (60,15).
    const p=new DOMPoint(60,15).matrixTransform(matrix);
    return {x:p.x,y:p.y};
  })()`);
  check(contourPick&&contourPick.x>0&&contourPick.y>0&&contourPick.x<1360&&contourPick.y<900,
    'Real selected-contour pointer is offscreen');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:contourPick.x,y:contourPick.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:contourPick.x,y:contourPick.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:contourPick.x,y:contourPick.y,button:'left',clickCount:1});
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-pointer-profile-selected]')?.textContent?.startsWith('cycle:'))"),
    'Real browser click failed to select solver-admitted semantic contour');
  const widthHandleIndex=await evaluate(`(() => {
    const options=[...document.querySelector('[data-testid=runtime-pointer-profile-handle]')?.options||[]];
    return options.findIndex(option=>option.textContent.includes('distanceX'));
  })()`);
  check(widthHandleIndex>0,'Accepted SKETCH exposed no X dimension semantic handle');
  check(await evaluate("(() => {const s=document.querySelector('[data-testid=runtime-pointer-profile-handle]');s.focus();return document.activeElement===s})()"),
    'Profile handle selector cannot take keyboard focus');
  for(let i=0;i<widthHandleIndex;i++)await key('ArrowDown','ArrowDown',40);
  await key('Tab','Tab',9);
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-profile-drag-handle]'))"),
    'Explicit keyboard choice did not expose an authentic solver handle');
  const dragStart=await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=runtime-sketch]');
    const handle=document.querySelector('[data-testid=runtime-profile-drag-handle]');
    if(!svg||!handle)return null;
    const rect=handle.getBoundingClientRect(),matrix=svg.getScreenCTM();
    return matrix?{x:rect.x+rect.width/2,y:rect.y+rect.height/2,dx:10*matrix.a}:null;
  })()`);
  check(dragStart&&dragStart.dx>0,'Cannot project semantic X handle in browser');
  const contourRevision=Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/[0-9]+/)?.[0]);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragStart.x,y:dragStart.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:dragStart.x,y:dragStart.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragStart.x+dragStart.dx,y:dragStart.y,
    button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:dragStart.x+dragStart.dx,y:dragStart.y,
    button:'left',clickCount:1});
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-dimension-width]')?.value)===130"),
    'Pointer-released semantic profile handle failed to commit width 120 -> 130');
  check(Number((await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"))?.match(/[0-9]+/)?.[0])===contourRevision+1,
    'Semantic pointer drag did not create exactly one model revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-native-download-cached]')?.disabled"),
    'Semantic pointer edit did not fence stale native STEP');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-dimension-width]')?.value)===120"),
    'Semantic pointer drag lost model-backed undo');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:10});
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-dimension-width]')?.value)===130"),
    'Semantic pointer drag lost model-backed redo');
  await screenshot('native-12-selected-profile-direct-drag.png');
  await pointerClick('runtime-mode-solid');
  check(exceptions.length===0,'Browser exceptions: '+exceptions.join('; '));
  writeFileSync(join(artifacts,'native-browser-report.json'),JSON.stringify({
    evidence:'actual Chromium React UI and binary Blob/download interception',
    provider:'synthetic HTTP responder with schema-compatible OCP identity, NOT OCP/native/STEP interoperability',
    downloadedFiles:4,staleDownloadRefused:true,liveRuntimeNativeSession:true,buildWithoutDownload:true,cachedDownloadRevisionFence:true,autoRebuildAfterEdit:true,holeDrag:true,outlineDrag:true,diameterDrag:true,depthKeyboardEdit:true,timelineUndo:true,physicalHoleArrayClick:true,oneStepArrayUndoRedo:true,parameterFreezePointer:true,independentThicknessEdit:true,freezeUndoRedo:true,freezeArchiveReopen:true,namedParameterEdit:true,namedParameterUndoRedo:true,namedParameterArchiveReopen:true,wrongProviderRefused:true,badStepDigestRefused:true,oneClickPinnedOcpRefusal:true,realPhysicalGeometry:false,
    retrospectiveMultiHoleLayout:true,layoutLiveRebuild:true,keyboardHoleNudge:true,keyboardNudgeUndo:true,selectedContourPointerDrag:true,selectedContourRevisionFenced:true,circularHoleArrayPointer:true,circularHoleUndoRedo:true,selectedRigidRotationPointer:true,rigidRotationUndoRedo:true,localRecoveryIndexedDbReload:true,recoveryWorkerReviewCancel:true,recoveryUndoRedo:true,independentStep:false,humanAcceptance:false,requests,screenshots:[
      'native-00c-named-thickness-parameter.png','native-00e-named-parameter-reopened.png','native-00-hole-drag-timeline.png','native-00b-direct-dimensions.png','native-00d-one-shot-hole-array.png','native-01-paired.png','native-02-download.png','native-03-edit-cancels-stale.png','native-04-parameter-frozen.png','native-05-frozen-archive-reopened.png','native-06-live-session-build-and-download.png','native-07-auto-native-rebuild-after-dimension-edit.png','native-08-retrospective-hole-layout-rebuild.png','native-08b-pinned-custody-refusal.png','native-09-model-first-new-sketch-shortcut.png','native-10a-selected-rigid-rotation.png','native-10-circular-bolt-array.png','native-11-local-recovery-after-reload.png'
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
