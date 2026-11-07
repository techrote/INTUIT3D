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
  await pointerClick('runtime-feature-plate');
  await pointerClick('runtime-feature-remove');
  await eventually(()=>evaluate(
    "Boolean(document.querySelector('[data-testid=runtime-removed-extrusion]')) && "+
    "Boolean(document.querySelector('[data-testid=runtime-empty]')) &&
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
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-boundary]')) &&
    document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
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
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-plate]')?.textContent?.includes('preview_only') &&
    document.querySelector('[data-testid=runtime-feature-cut]')?.textContent?.includes('pending_exact_provider')"),
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
  // Actual Chromium clicks, keyboard-model transactions and rendered circle.
  const beforeAdd=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(await evaluate("(() => {document.querySelector('[data-testid=runtime-add-hole]').click();return true})()"),'cannot add a real sketch hole');
  await eventually(()=>evaluate("document.querySelectorAll('[data-testid^=runtime-hole-editor-]').length===3"),'added hole did not reach React inspector');
  const addedId=await evaluate("Array.from(document.querySelectorAll('[data-testid^=runtime-hole-editor-]')).map(x=>x.getAttribute('data-testid')?.slice(20)).find(x=>x?.startsWith('hole.user.'))");
  check(typeof addedId==='string'&&addedId.startsWith('hole.user.'),'new hole identity missing');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent.includes('3 circular holes')"),'added circle not shown in solved profile');
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
  check(await evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent.includes('6 circular holes')"),
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
  check(exceptions.length===0,'Browser exceptions: '+exceptions.join('; '));
  writeFileSync(join(artifacts,'native-browser-report.json'),JSON.stringify({
    evidence:'actual Chromium React UI and binary Blob/download interception',
    provider:'synthetic HTTP responder, NOT OCP/native/STEP interoperability',
    downloadedFiles:4,staleDownloadRefused:true,liveRuntimeNativeSession:true,buildWithoutDownload:true,cachedDownloadRevisionFence:true,autoRebuildAfterEdit:true,holeDrag:true,outlineDrag:true,diameterDrag:true,depthKeyboardEdit:true,timelineUndo:true,physicalHoleArrayClick:true,oneStepArrayUndoRedo:true,parameterFreezePointer:true,independentThicknessEdit:true,freezeUndoRedo:true,freezeArchiveReopen:true,realPhysicalGeometry:false,
    independentStep:false,humanAcceptance:false,requests,screenshots:[
      'native-00-hole-drag-timeline.png','native-00b-direct-dimensions.png','native-00d-one-shot-hole-array.png','native-01-paired.png','native-02-download.png','native-03-edit-cancels-stale.png','native-04-parameter-frozen.png','native-05-frozen-archive-reopened.png','native-06-live-session-build-and-download.png','native-07-auto-native-rebuild-after-dimension-edit.png'
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
