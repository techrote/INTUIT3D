#!/usr/bin/env node
/**
 * Browser qualification for the WORKBENCH preview-only direct sketch handles.
 * Requires installed workspace dependencies and a completed Vite build.
 * No Playwright/npm dependency or external service: local preview + Chromium CDP.
 * Images are actual rendered frames, NOT OCCT/engineering or human acceptance.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:4173';
const artifactDir = process.env.INTUIT3D_HANDLE_ARTIFACTS || 'apps/web/browser-evidence-handles';
const home = mkdtempSync(join(tmpdir(), 'intuit3d-handles-'));
const children = [];
let ws;
let seq = 0;
const pending = new Map();
const exceptions = [];
const check = (condition, message) => { if (!condition) throw Error(message); };
const eventually = async (callback, label, attempts = 80) => {
  for (let i = 0; i < attempts; i++) {
    try { const value = await callback(); if (value) return value; } catch {}
    await pause(150);
  }
  throw Error('Timed out: ' + label);
};
const executable = () => {
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    const process = spawnSync('which', [name], { encoding: 'utf8' });
    if (process.status === 0 && process.stdout.trim()) return process.stdout.trim();
  }
  throw Error('Chromium not installed; browser qualification was not executed');
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 10000);
  pending.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error('Runtime exception: ' + JSON.stringify(result.exceptionDetails));
  return result.result?.value;
};
const screenshot = async (filename) => {
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(artifactDir, filename), Buffer.from(image.data, 'base64'));
};
const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent',
  { type, x, y, button: 'left', buttons, clickCount: 1 });
const key = async (name, code, virtualKey) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey });
};
const numberValue = (name) => evaluate(`document.querySelector('input[aria-label="${name}"]')?.value`);
const revision = () => evaluate("document.querySelector('.project-title small')?.textContent || ''");
async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const vite = spawn('npm', ['run', 'preview', '--workspace', '@intuit3d/web', '--',
    '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  });
  children.push(vite);
  let serverLog = '';
  vite.stdout.on('data', chunk => serverLog = (serverLog + chunk.toString()).slice(-12000));
  vite.stderr.on('data', chunk => serverLog = (serverLog + chunk.toString()).slice(-12000));
  await eventually(async () => (await fetch(origin)).ok, 'local Vite preview: ' + serverLog);
  check(vite.exitCode === null, 'Vite exited before browser startup');

  const chrome = spawn(executable(), [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--window-size=1360,900', '--remote-debugging-port=0',
    '--user-data-dir=' + home, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  children.push(chrome);
  const activePort = await eventually(() =>
    existsSync(join(home, 'DevToolsActivePort')) && readFileSync(join(home, 'DevToolsActivePort'), 'utf8'),
    'Chromium debugging port');
  const port = Number(activePort.split('\n')[0]);
  check(Number.isSafeInteger(port) && port > 0, 'Invalid Chromium debugging port');
  const target = await eventually(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const targets = await response.json();
    return targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, 'Chromium page target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if (packet.method === 'Runtime.exceptionThrown') exceptions.push(packet.params?.exceptionDetails?.text || 'Browser exception');
    const request = pending.get(packet.id);
    if (!request) return;
    pending.delete(packet.id);
    clearTimeout(request.timer);
    packet.error ? request.reject(Error(JSON.stringify(packet.error))) : request.resolve(packet.result);
  });
  await eventually(() => ws.readyState === WebSocket.OPEN, 'CDP WebSocket');
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: origin });
  await eventually(() => evaluate("Boolean(document.querySelector('[data-testid=runtime-panel]') && document.querySelector('[data-testid=runtime-exact-state]'))"), 'model-backed CAD is the default startup');
  check(await evaluate("document.querySelector('[data-testid=enter-model-runtime]')===null"), 'Legacy preview mounted alongside the model authority');
  await screenshot('00-model-first-start.png');

  // Real React model-backed user path: select an admitted sketch contour by
  // pointer, explicitly choose its solver-owned width handle, type a precise
  // dimension, submit, then undo. No mock document or renderer authority.
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-mode-sketch]');b?.click();return !!b})()"),
    'Model-backed Sketch control missing');
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-profile-select-mode]');b?.click();return !!b})()"),
    'Explicit semantic contour selection missing');
  const profilePoint = await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=runtime-sketch]');
    if(!svg||!svg.getScreenCTM())return null;
    const p=svg.createSVGPoint();p.x=60;p.y=15;
    const q=p.matrixTransform(svg.getScreenCTM());
    return {x:q.x,y:q.y};
  })()`);
  check(profilePoint && Number.isFinite(profilePoint.x), 'Model-backed semantic profile projection invalid');
  await mouse('mouseMoved',profilePoint.x,profilePoint.y);
  await mouse('mousePressed',profilePoint.x,profilePoint.y,1);
  await mouse('mouseReleased',profilePoint.x,profilePoint.y,0);
  await eventually(()=>evaluate(
    "Boolean(document.querySelector('[data-testid=runtime-pointer-profile-selected]') && !document.querySelector('[data-testid=runtime-pointer-profile-selected]').textContent.includes('Selection expired'))"
  ),'actual pointer contour selection');
  check(await evaluate(`(() => {
    const s=document.querySelector('[data-testid=runtime-pointer-profile-handle]');
    if(!s)return false;
    const opt=[...s.options].find(o=>o.value.includes('dimension:width'));
    if(!opt)return false;
    s.value=opt.value;s.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`),'Semantic width handle missing from explicit selection list');
  await eventually(()=>evaluate(
    "Boolean(document.querySelector('[data-testid=runtime-profile-numeric-editor]'))"
  ),'numeric semantic editor');
  check(await evaluate(`(() => {
    const el=document.querySelector('[data-testid=runtime-profile-numeric-value]');
    if(!el)return false;el.focus();el.select();return document.activeElement===el;
  })()`),'numeric semantic dimension input cannot focus');
  await send('Input.insertText',{text:'135'});
  const typedNumericValue=await evaluate("document.querySelector('[data-testid=runtime-profile-numeric-value]')?.value");
  check(typedNumericValue==='135','Chromium number entry mismatch: '+JSON.stringify(typedNumericValue));
  await key('Enter','Enter',13);
  try{
    await eventually(()=>evaluate(
      "document.querySelector('input[aria-label=\"Plate width\"]')?.value==='135'"
    ),'numeric semantic edit through RUNTIME');
  }catch(err){
    const diagnostic=await evaluate(`(() => ({
      revision:document.querySelector('[data-testid=runtime-revision]')?.textContent,
      selected:document.querySelector('[data-testid=runtime-pointer-profile-selected]')?.textContent,
      typed:document.querySelector('[data-testid=runtime-profile-numeric-value]')?.value,
      width:document.querySelector('input[aria-label="Plate width"]')?.value,
      error:document.querySelector('[data-testid=runtime-profile-numeric-error]')?.textContent,
      message:document.querySelector('.runtime-message')?.textContent,
    }))()`);
    throw Error(String(err)+'; diagnostic='+JSON.stringify(diagnostic));
  }
  await screenshot('00a-model-numeric-profile.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-panel] button')].find(el=>el.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'Model-backed undo control missing');
  await eventually(()=>evaluate(
    "document.querySelector('input[aria-label=\"Plate width\"]')?.value==='120'"
  ),'numeric semantic undo');
  await screenshot('00b-model-numeric-profile-undo.png');
  // The edited authoritative journal is deliberately protected by the
  // browser's beforeunload guard, even after undo. Request its archive first,
  // as an actual user must do, before navigating to the legacy preview.
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-save-archive]');b?.click();return !!b})()"),
    'Model-backed archive save control missing');
  await eventually(()=>evaluate(
    "document.querySelector('[data-testid=runtime-archive-state]')?.textContent?.includes('ARCHIVE DOWNLOAD REQUESTED')"
  ),'model archive save request before navigating away');

  // Legacy preview regression remains available only by explicit opt-in.
  await send('Page.navigate', { url: origin + '/?mode=preview' });
  await eventually(async () => evaluate("Boolean(document.querySelector('canvas') && document.querySelector('[data-testid=enter-model-runtime]'))"), 'explicit preview mode');
  await screenshot('01-solid.png');

  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Sketch');b?.click();return !!b})()"),
    'Sketch ribbon unavailable');
  await eventually(async () => evaluate("Boolean(document.querySelector('[data-testid=dimension-handle-width]'))"), 'sketch handles');
  await screenshot('02-sketch.png');
  check(await numberValue('Plate width') === '120', 'Unexpected initial width');

  // Real browser keyboard entry: unit arithmetic is preview-only, invalid input
  // must not change the model, Escape must not commit stale onBlur text.
  // Preserve the ordinary numeric entry for the existing integration CDP gate.
  check(await evaluate("(() => {const b=document.querySelector('button[aria-label=\"Use expression for Plate width\"]');b?.click();return !!b})()"),
    'Preview fx toggle missing');
  await eventually(() => evaluate("document.querySelector('input[aria-label=\"Plate width\"]')?.type==='text'"), 'fx text entry');
  check(await evaluate("(() => {const e=document.querySelector('input[aria-label=\"Plate width\"]');e?.focus();e?.select();return document.activeElement===e})()"),
    'Dimension editor cannot focus');
  await send('Input.insertText', { text: '1in + 95mm' });
  await key('Enter', 'Enter', 13);
  await eventually(async () => (await numberValue('Plate width')) === '120.4', 'unit expression commit');
  check((await revision()).includes('1'), 'Valid arithmetic should make one preview revision');
  check(await evaluate("document.querySelector('input[aria-label=\"Plate width\"]')?.type==='number'"),
    'Valid expression did not return to normal numeric entry');
  check(await evaluate("(() => {const b=document.querySelector('button[aria-label=\"Use expression for Plate width\"]');b?.click();return !!b})()"),
    'Cannot enter fx mode to test invalid arithmetic');
  await eventually(() => evaluate("document.querySelector('input[aria-label=\"Plate width\"]')?.type==='text'"), 're-enter fx mode');
  check(await evaluate("(() => {const e=document.querySelector('input[aria-label=\"Plate width\"]');e?.focus();e?.select();return document.activeElement===e})()"),
    'Dimension editor cannot refocus');
  await send('Input.insertText', { text: '1cm/0' });
  await key('Enter', 'Enter', 13);
  await eventually(async () => evaluate("Boolean(document.querySelector('#expression-error-width[role=alert]'))"), 'invalid arithmetic shown inline');
  check(await numberValue('Plate width') === '1cm/0', 'Invalid arithmetic text must remain repairable');
  check((await revision()).includes('1'), 'Invalid arithmetic must not change journal revision');
  await screenshot('02a-invalid-expression.png');
  // Binary64 must not silently discard a nonzero dimensional increment.
  check(await evaluate("(() => {const e=document.querySelector('input[aria-label=\"Plate width\"]');e?.focus();e?.select();return document.activeElement===e})()"),
    'Invalid calculator draft cannot be repaired');
  await send('Input.insertText', { text: '120.4mm + 1e-15mm' });
  await key('Enter', 'Enter', 13);
  await eventually(async () => evaluate(
    "document.querySelector('#expression-error-width[role=alert]')?.textContent?.includes('lost a nonzero operand')"
  ), 'precision loss must be diagnosed rather than silently committed');
  check((await revision()).includes('1'), 'Rounded-away dimension edit must not author a revision');
  check(await numberValue('Plate width') === '120.4mm + 1e-15mm',
    'Precision-loss expression must remain editable after rejection');
  await screenshot('02b-precision-loss.png');
  check(await evaluate("(() => {const e=document.querySelector('input[aria-label=\"Plate width\"]');e?.focus();e?.select();return document.activeElement===e})()"),
    'Invalid draft cannot be selected for cancellation');
  await send('Input.insertText', { text: '2mm' });
  await key('Escape', 'Escape', 27);
  await eventually(async () => (await numberValue('Plate width')) === '120.4', 'Escape must discard draft without blur commit');
  check((await revision()).includes('1'), 'Escape must preserve original revision');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'Undo button unavailable after calculator edit');
  await eventually(async () => (await numberValue('Plate width')) === '120', 'calculator undo restore');

  // Real cursor movement must show a visual snap at the sketch origin, without
  // creating a dimension edit or claiming an authored solver constraint.
  const originScreen = await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=sketch-viewport]');
    const p=svg.createSVGPoint();p.x=500;p.y=325;
    const q=p.matrixTransform(svg.getScreenCTM());
    return {x:q.x,y:q.y};
  })()`);
  check(originScreen && Number.isFinite(originScreen.x), 'Sketch origin projection invalid');
  await mouse('mouseMoved', originScreen.x, originScreen.y);
  await eventually(async () => evaluate(
    "document.querySelector('[data-testid=sketch-cursor-readout]')?.textContent?.includes('VISUAL SNAP: origin')"
  ), 'real cursor origin snap');
  check((await revision()).includes('revision 0'), 'Hover must not author a preview edit');
  check(await evaluate(
    "document.querySelector('[data-testid=sketch-cursor-readout]')?.textContent?.includes('X 0.0 mm · Y 0.0 mm')"
  ), 'Origin coordinate readout changed precision or units');
  await screenshot('02-cursor-snap.png');

  // Failure injection: an absent SVG screen CTM must clear the visual cursor
  // instead of silently treating the mouse as the viewBox origin.
  check(await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=sketch-viewport]');
    svg.getScreenCTM=()=>null;
    return svg.getScreenCTM()===null;
  })()`), 'Could not inject a missing SVG CTM');
  await mouse('mouseMoved', originScreen.x + 5, originScreen.y + 5);
  await eventually(async () => evaluate(
    "!document.querySelector('[data-testid=sketch-cursor-readout]')"
  ), 'missing CTM clears visual cursor');
  check((await revision()).includes('revision 0'), 'Invalid projection authored an edit');
  check(await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=sketch-viewport]');
    delete svg.getScreenCTM;
    return Boolean(svg.getScreenCTM());
  })()`), 'Could not restore native SVG projection');

  // Use actual CDP mouse events at the screen-projected SVG handle. Moving the
  // right edge by 4 mm in sketch coordinates changes the *full* width by 8 mm.
  const positions = await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=sketch-viewport]');
    const h=document.querySelector('[data-testid=dimension-handle-width]');
    const m=svg.getScreenCTM();
    const p0=svg.createSVGPoint();p0.x=h.cx.baseVal.value;p0.y=h.cy.baseVal.value;
    const p1=svg.createSVGPoint();p1.x=p0.x+8*Math.min(4.6,660/120,410/80)/2;p1.y=p0.y;
    const a=p0.matrixTransform(m),b=p1.matrixTransform(m);
    return {x:a.x,y:a.y,finishX:b.x,finishY:b.y};
  })()`);
  check(positions && Number.isFinite(positions.x) && Number.isFinite(positions.finishX), 'Handle projection invalid');

  // Losing window focus mid-gesture cancels the uncommitted preview; the
  // subsequent pointer-up must not journal the abandoned dimension.
  await mouse('mouseMoved', positions.x, positions.y);
  await mouse('mousePressed', positions.x, positions.y, 1);
  await mouse('mouseMoved', positions.finishX, positions.finishY, 1);
  await eventually(async () => (await numberValue('Plate width')) === '128', 'provisional width before blur');
  check((await revision()).includes('revision 0'), 'Provisional edit created a revision');
  check(await evaluate("(() => {window.dispatchEvent(new Event('blur'));return true})()"), 'Synthetic blur dispatch failed');
  await eventually(async () => (await numberValue('Plate width')) === '120', 'blur must cancel provisional dimension');
  await mouse('mouseReleased', positions.finishX, positions.finishY);
  check((await revision()).includes('revision 0'), 'Released abandoned gesture committed a revision');

  // Another real pointer gesture loses its coordinate transform mid-drag.
  // Cancellation must restore the authored width, without a phantom revision,
  // even if the pointer subsequently releases normally.
  await mouse('mouseMoved', positions.x, positions.y);
  await mouse('mousePressed', positions.x, positions.y, 1);
  await mouse('mouseMoved', positions.finishX, positions.finishY, 1);
  await eventually(async () => (await numberValue('Plate width')) === '128', 'pre-projection-loss provisional width');
  check(await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=sketch-viewport]');
    svg.getScreenCTM=()=>({a:1,b:2,c:2,d:4,e:0,f:0});
    return true;
  })()`), 'Could not inject singular SVG CTM');
  await mouse('mouseMoved', positions.finishX + 2, positions.finishY, 1);
  await eventually(async () => (await numberValue('Plate width')) === '120', 'singular CTM must cancel provisional dimension');
  await mouse('mouseReleased', positions.finishX + 2, positions.finishY);
  check(await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=sketch-viewport]');
    delete svg.getScreenCTM;
    return Boolean(svg.getScreenCTM());
  })()`), 'Could not restore SVG projection after cancellation');
  check((await revision()).includes('revision 0'), 'Projection failure authored an invalid revision');

  await mouse('mouseMoved', positions.x, positions.y);
  await mouse('mousePressed', positions.x, positions.y, 1);
  await mouse('mouseMoved', positions.finishX, positions.finishY, 1);
  await mouse('mouseReleased', positions.finishX, positions.finishY);
  await eventually(async () => (await numberValue('Plate width')) === '128', 'width direct manipulation');
  check((await revision()).includes('revision 1'), 'Pointer drag created more than one authored revision');
  await screenshot('03-width-drag.png');

  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'Undo button absent');
  await eventually(async () => (await numberValue('Plate width')) === '120', 'single-command undo');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    'Redo button absent');
  await eventually(async () => (await numberValue('Plate width')) === '128', 'single-command redo');

  check(await evaluate("(() => {const e=document.querySelector('[data-testid=dimension-handle-holeDiameter]');e?.focus();return document.activeElement===e})()"),
    'Diameter handle not keyboard focusable');
  await key('ArrowRight', 'ArrowRight', 39);
  await eventually(async () => (await numberValue('Hole diameter')) === '13', 'diameter keyboard nudge');
  await screenshot('04-keyboard-edit.png');

  await send('Page.reload', { ignoreCache: true });
  await eventually(async () => evaluate("Boolean(document.querySelector('[data-testid=recovery-dialog]'))"), 'local recovery offer');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Recover draft');b?.click();return !!b})()"),
    'Recover button unavailable');
  await eventually(async () => (await numberValue('Plate width')) === '128' &&
    (await numberValue('Hole diameter')) === '13', 'exact saved preview parameters');
  await screenshot('05-recovered.png');
  // Actual software-WebGL 3D direct-manipulation test. The HTML knob tracks
  // the projected Three.js world-Y axis; gestures never claim B-rep identity.
  const thicknessHandlePosition = async (deltaMm = 3) => eventually(async () => evaluate(`(() => {
    const b=document.querySelector('[data-testid=solid-thickness-handle]');
    if (!b || getComputedStyle(b).visibility!=='visible') return null;
    const r=b.getBoundingClientRect();
    const x=Number(b.dataset.axisX),y=Number(b.dataset.axisY);
    if (!Number.isFinite(x)||!Number.isFinite(y)||Math.hypot(x,y)<0.02) return null;
    return {x:r.left+r.width/2,y:r.top+r.height/2,finishX:r.left+r.width/2+x*${deltaMm},finishY:r.top+r.height/2+y*${deltaMm}};
  })()`), 'visible projected 3D thickness handle');
  const solidStart = await thicknessHandlePosition();
  check(await numberValue('Thickness') === '8', 'Unexpected baseline extrusion thickness');
  const startRevision = await revision();
  await mouse('mouseMoved', solidStart.x, solidStart.y);
  await mouse('mousePressed', solidStart.x, solidStart.y, 1);
  await mouse('mouseMoved', solidStart.finishX, solidStart.finishY, 1);
  await eventually(async () => (await numberValue('Thickness')) === '11', 'provisional 3D thickness edit');
  check((await revision()) === startRevision, '3D preview drag created an uncommitted journal revision');
  await mouse('mouseReleased', solidStart.finishX, solidStart.finishY);
  await eventually(async () => (await revision()) !== startRevision, '3D thickness commit');
  check(await numberValue('Thickness') === '11', '3D direct-edit transaction changed unexpected value');
  await screenshot('06-solid-thickness-drag.png');

  // Losing focus must abandon an uncommitted thickness gesture.
  const solidNext = await thicknessHandlePosition();
  const afterCommitRevision = await revision();
  await mouse('mouseMoved', solidNext.x, solidNext.y);
  await mouse('mousePressed', solidNext.x, solidNext.y, 1);
  await mouse('mouseMoved', solidNext.finishX, solidNext.finishY, 1);
  await eventually(async () => (await numberValue('Thickness')) === '14', 'provisional thickness before blur');
  check(await evaluate("(() => {window.dispatchEvent(new Event('blur'));return true})()"), 'Failed to inject 3D gesture focus loss');
  await eventually(async () => (await numberValue('Thickness')) === '11', '3D blur cancellation');
  await mouse('mouseReleased', solidNext.finishX, solidNext.finishY);
  check((await revision()) === afterCommitRevision, 'Abandoned 3D gesture committed a phantom revision');

  // Undo/redo use exactly the same preview transaction history as 2D handles.
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    '3D thickness Undo unavailable');
  await eventually(async () => (await numberValue('Thickness')) === '8', '3D thickness single-command undo');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    '3D thickness Redo unavailable');
  await eventually(async () => (await numberValue('Thickness')) === '11', '3D thickness single-command redo');
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=solid-thickness-handle]');b?.focus();return document.activeElement===b})()"),
    '3D thickness handle is not keyboard-focusable');
  await key('ArrowUp', 'ArrowUp', 38);
  await eventually(async () => (await numberValue('Thickness')) === '12', '3D thickness keyboard nudge');
  await screenshot('07-solid-thickness-keyboard.png');
  // Real local File-input import is a non-undoable replacement. Review and
  // cancel must preserve edits; explicit acceptance can load invalid intent
  // without inventing a last-good 3D body or a cross-file undo stack.
  const injectImport = `(() => {
    const recovery = JSON.parse(localStorage.getItem('intuit3d.web-preview.recovery.v1.current'));
    const source = JSON.parse(recovery.previewJson);
    const incoming = { ...source, id: 'imported-preview-002', name: 'Imported negative plate',
      revision: 37, params: { ...source.params, width: 160, thickness: -2 },
      chronology: [...source.chronology, 'Imported fixture with unresolved thickness'] };
    const input = document.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(incoming)], 'invalid-plate.i3d-preview.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
  check(await evaluate(injectImport), 'Cannot inject local File input');
  await eventually(() => evaluate("Boolean(document.querySelector('[data-testid=import-review]'))"), 'preview import confirmation');
  check(await numberValue('Thickness') === '12', 'Import preview silently replaced current dimension before consent');
  check(await evaluate("document.querySelector('[data-testid=import-review]')?.textContent?.includes('Incoming preview has')"),
    'Invalid incoming geometry was not diagnosed before replacement');
  await screenshot('08-import-review.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='Cancel replacement');b?.click();return !!b})()"),
    'Cancel preview import button unavailable');
  await eventually(() => evaluate("!document.querySelector('[data-testid=import-review]')"), 'import review cancellation');
  check(await numberValue('Thickness') === '12', 'Canceled file import modified current preview');
  check(await evaluate(injectImport), 'Cannot retry local File input');
  await eventually(() => evaluate("Boolean(document.querySelector('[data-testid=import-review]'))"), 'import review re-entry');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='Replace preview document');b?.click();return !!b})()"),
    'Explicit preview replacement action missing');
  await eventually(async () => (await numberValue('Thickness')) === '-2' &&
    (await revision()).includes('revision 37'), 'accepted imported invalid preview');
  check(await evaluate("document.querySelector('.empty-overlay')?.textContent?.includes('No validated preview')"),
    'Invalid imported geometry incorrectly inherited a stale last-good mesh');
  check(await evaluate("document.querySelector('button[title=\"Open preview project\"]') !== null"),
    'Preview file controls vanished after import');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='Undo');return b?.disabled})()"),
    'Accepted file replacement retained another document undo history');
  await screenshot('09-imported-invalid-preview.png');
  // Real INTENT/SKETCH/RUNTIME consumer acceptance. This mode is separately
  // model-backed; only its display mesh remains a disposable tessellation.
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=enter-model-runtime]');b?.click();return !!b})()"),
    'Cannot open model-backed CAD workspace');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='preview_only'"),'model-backed plate evaluated');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'Unimplemented native cut was incorrectly reported exact');
  check(await evaluate("document.querySelector('[data-testid=runtime-exact-state]')?.textContent?.includes('NO EXACT KERNEL')"),
    'Model-backed exactness warning absent');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-3d-viewport] canvas'))"),'real profile 3D preview');
  await screenshot('10-model-runtime-solid.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(x=>x.textContent?.trim()==='Sketch');b?.click();return !!b})()"),
    'Model-backed sketch toggle unavailable');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-sketch]')?.querySelectorAll('[data-testid^=runtime-sketch-outline-hole-]').length===2"),
    'SKETCH solver profile did not display two holes');
  await screenshot('11-model-runtime-sketch.png');
  const modelRevision = await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-dimension-width]');e.focus();e.select();return document.activeElement===e})()"),
    'Model-backed historical width editor unavailable');
  await send('Input.insertText', {text:'90'});
  await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='blocked_dependency'"),
    'Crossing hole profile not blocked by real solver/discovery');
  check(await evaluate("Boolean(document.querySelector('[data-testid=runtime-empty]'))"),
    'Model-backed invalid sketch retained fabricated current mesh');
  check((await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent"))!==modelRevision,
    'Model-backed edit did not append an INTENT revision');
  await screenshot('12-model-runtime-blocked.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(x=>x.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'Model-backed undo missing');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='preview_only'"),
    'Model-backed undo failed to recover accepted sketch');
  check(await evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent?.includes('2 displayed circular holes')"),
    'Undo did not restore the admitted profile');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(x=>x.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    'Model-backed redo missing');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='blocked_dependency'"),
    'Model-backed redo did not restore invalid authored intent');
  // Save and open an actual browser Blob through File.text(), with explicit
  // destructive replacement review, rather than pretending preview JSON is CAD.
  check(await evaluate("(() => {window.__modelArchiveBlobs=[];window.__modelDownloadNames=[];document.addEventListener('click',e=>{if(e.target instanceof HTMLAnchorElement&&e.target.download.endsWith('.i3d-model.json'))window.__modelDownloadNames.push(e.target.download)},true);const prior=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{window.__modelArchiveBlobs.push(blob);return prior(blob)};return true})()"),
    'Cannot instrument browser model archive download');
  check(await evaluate("document.querySelector('[data-testid=runtime-archive-state]')?.textContent?.includes('UNEXPORTED')"),
    'new model not labelled as unexported');
  // Physical Ctrl+S in model-backed mode must download exactly ONE archive;
  // the unmounted preview sandbox must never save its separate document.
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83,modifiers:2});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'s',code:'KeyS',windowsVirtualKeyCode:83,modifiers:2});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17});
  await eventually(()=>evaluate("window.__modelArchiveBlobs?.length===1"),'single Ctrl+S model archive Blob');
  check(await evaluate("window.__modelArchiveBlobs.length===1"),'Preview sandbox also handled model-only save shortcut');
  check(await evaluate("window.__modelDownloadNames.length===1 && /^intuit3d-workbench[.]plate[.]one-r\\d+[.]i3d-model[.]json$/.test(window.__modelDownloadNames[0])"),
    'archive download filename failed project/revision identity check');
  check(await evaluate("document.querySelector('[data-testid=runtime-archive-state]')?.textContent?.includes('DOWNLOAD REQUESTED')"),
    'successful archive download request did not update export status');
  check(await evaluate("(async()=>{const content=await window.__modelArchiveBlobs[0].text();const f=JSON.parse(content);return f.format==='intuit3d.model-archive' || content.includes('intuit3d.model-archive')})()"),
    'Downloaded archive is not model history');
  check(await evaluate("(async()=>{const data=await window.__modelArchiveBlobs[0].text();const dt=new DataTransfer();dt.items.add(new File([data],'plate.i3d-model.json',{type:'application/json'}));const input=document.querySelector('.runtime-file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()"),
    'Cannot reinject saved model archive into real browser file input');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),'model archive import review');
  check(await evaluate("document.querySelector('[data-testid=runtime-import-incoming]')?.textContent?.includes('undo /')"),
    'model import review did not show incoming durable history');
  // The real browser offers a trace for the selected File. Its downloaded
  // contents must contain only stage/timing evidence, not the private source.
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-import-trace-review]');b?.click();return !!b})()"),
    'Privacy-safe import trace control absent at real browser confirmation');
  check(await evaluate("(async()=>{const blob=window.__modelArchiveBlobs.pop();if(!blob)return false;const text=await blob.text();const trace=JSON.parse(text);return trace.format==='intuit3d.browser-import-stage-trace'&&trace.stages.some(x=>x.stage==='file_selected')&&trace.stages.some(x=>x.stage==='confirmation_ready')&&!text.includes('plate.i3d-model.json')&&!text.includes('undoStack')&&!text.includes('projectId')})()"),
    'Real browser stage trace lacked source fence or exposed private archive data');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'Model archive replacement confirmation missing');
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-import-review]')"),'model archive reopened');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='blocked_dependency'"),
    'Save/reopen changed authored unsolved status');
  await screenshot('13-model-runtime-reopened.png');
  // A genuine browser DragEvent follows the same worker validation/review as file input.
  const beforeDrop=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(await evaluate("(async()=>{const data=await window.__modelArchiveBlobs[0].text();const dt=new DataTransfer();dt.items.add(new File([data],'dropped.i3d-model.json',{type:'application/json'}));return document.querySelector('.runtime-shell').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))===false})()"),
    'model archive drop did not prevent browser navigation');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),'drop archive review');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===beforeDrop,
    'dropped file replaced current model before confirmation');
  check(await evaluate("document.querySelector('[data-testid=runtime-import-incoming]')?.textContent?.includes('dropped.i3d-model.json')"),
    'dropped archive name missing from review');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(x=>x.textContent==='Cancel');b?.click();return !!b})()"),
    'drop replacement cancel unavailable');
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-import-review]')"),'drop cancellation');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===beforeDrop,
    'cancelling dropped model changed journal');
  check(await evaluate("(() => {const dt=new DataTransfer();dt.items.add(new File(['{}'],'1.json'));dt.items.add(new File(['{}'],'2.json'));document.querySelector('.runtime-shell').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));return true})()"),
    'cannot dispatch multiple-file drop');
  await eventually(()=>evaluate("document.querySelector('.runtime-message')?.textContent?.includes('exactly one')"),
    'multiple-file drop was not refused');

  // Create a genuinely new semantic project. Cancel must preserve the
  // unresolved prior project; accepting resets the journal and project ID.
  const oldProjectLabel = await evaluate("document.querySelector('.runtime-shell .browser-project')?.textContent");
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-new-plate]');b?.click();return !!b})()"),
    'New plate sketch command unavailable');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),'new project replacement review');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Cancel');b?.click();return !!b})()"),
    'New project cancellation unavailable');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='blocked_dependency'"),
    'Cancelled new project replaced the unresolved original');
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-new-plate]');b?.click();return !!b})()"),
    'Cannot reopen new project review');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),'new project review');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'New model project replacement cannot be confirmed');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='preview_only'"),'new sketch and extrude rebuild');
  check((await evaluate("document.querySelector('.runtime-shell .browser-project')?.textContent")) !== oldProjectLabel,
    'New project silently reused existing project identity');
  await screenshot('14-model-runtime-new-plate.png');

  // Sketch-first authoring: actual browser click + keyboard control.
  // No extrusion or cut exists in the project until its user command.
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-new-sketch]');b?.click();return !!b})()"),
    'New sketch-first project command unavailable');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'sketch-first replacement review');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'sketch-first replacement confirmation unavailable');
  await eventually(()=>evaluate("document.querySelector('[data-testid=\"runtime-status-sketch.plate\"]')?.textContent==='analytic_profile_only' && !document.querySelector('[data-testid=runtime-feature-plate]')"),
    'new project fabricated an already-extruded plate');
  check(await evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch]')) && document.querySelector('[data-testid=runtime-create-cut]')?.disabled"),
    'sketch-first profile or cutting command state wrong');
  await screenshot('15-sketch-first-solved.png');

  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-dimension-width]');e.focus();e.select();return document.activeElement===e})()"),
    'cannot dimension unextruded sketch');
  await send('Input.insertText',{text:'140'});
  await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-dimension-width]')?.value==='140'"),
    'sketch-first retrospective width dimension not applied');
  // E is a deliberate, keyboard-first two-stage authoring tool, never an
  // immediate destructive command. Escape must leave the model unchanged.
  await evaluate('document.activeElement?.blur()');
  await key('e','KeyE',69);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-combo]')?.textContent.includes('Extrude admitted sketch')"),
    'E combo did not propose extrusion for a sketch-only project');
  check(await evaluate("document.querySelector('[data-testid=runtime-combo-distance]')?.value==='8' && !document.querySelector('[data-testid=runtime-feature-plate]')"),
    'E combo silently authored extrusion before confirmation');
  await screenshot('15a-e-combo-extrusion.png');
  await key('Escape','Escape',27);
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-feature-combo]') && !document.querySelector('[data-testid=runtime-feature-plate]')"),
    'Escape from E combo created a solid or left dialog open');
  await key('e','KeyE',69);
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-combo-distance]'))"),
    'E combo failed to reopen');
  // The numeric distance is focused by the dialog and Enter commits the
  // real semantic feature. Existing ribbon commands remain available too.
  await eventually(()=>evaluate("document.activeElement?.matches('[data-testid=runtime-combo-distance]')"),
    'E distance field did not receive keyboard focus');
  await key('Enter','Enter',13);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='preview_only' && !document.querySelector('[data-testid=runtime-feature-combo]')"),
    'E combo did not commit the authoritative extrusion');
  check(await evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent.includes('0 displayed circular holes') && !document.querySelector('[data-testid=runtime-feature-cut]')"),
    'uncut extrusion falsely visualized already-Boolean holes');
  await screenshot('16-sketch-extruded-uncut.png');
  await key('e','KeyE',69);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-combo]')?.textContent.includes('Cut circular holes through body.plate')"),
    'E combo did not transition from extrusion to explicit target-body cut');
  check(await evaluate("!document.querySelector('[data-testid=runtime-feature-cut]') && document.querySelector('[data-testid=runtime-feature-combo]')?.textContent.includes('native provider')"),
    'E cut combo claimed native geometry or authored before confirmation');
  await screenshot('16a-e-combo-cut.png');
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-feature-combo-confirm]');b?.click();return !!b})()"),
    'cannot confirm explicit cut in E combo');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider' && !document.querySelector('[data-testid=runtime-feature-combo]')"),
    'E combo cut missing or erroneously exact');
  check(await evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent.includes('2 displayed circular holes')"),
    'cut-intent viewport failed to show intended hole locations');
  await screenshot('17-sketch-through-cut-pending-native.png');

  // Undo and redo the entire cut command; extrusion and sketch survive.
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'cut undo control missing');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-cut]')?.classList.contains('removed') && document.querySelector('[data-testid=runtime-status-plate]')?.textContent==='preview_only'"),
    'undo did not remove only the through-cut');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    'cut redo control missing');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'redo did not restore the same target-body cut');

  // Save and reopen the genuinely authored staged history through browser File.
  const countBeforeSketchSave=await evaluate('window.__modelArchiveBlobs.length');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Save model archive');b?.click();return !!b})()"),
    'cannot save sketch-first authored model');
  await eventually(()=>evaluate('window.__modelArchiveBlobs.length==='+String(countBeforeSketchSave+1)),
    'sketch-first model archive was not downloaded');
  check(await evaluate("((async()=>{const data=await window.__modelArchiveBlobs.at(-1).text();const dt=new DataTransfer();dt.items.add(new File([data],'staged.i3d-model.json',{type:'application/json'}));const input=document.querySelector('.runtime-file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})())"),
    'cannot reopen real staged model archive');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'staged project open review absent');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'staged archive replacement confirmation missing');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider' && document.querySelector('[data-testid=runtime-dimension-width]')?.value==='140'"),
    'reopened staged project lost dimension or semantic cut');
  await screenshot('18-sketch-cut-archive-reopened.png');


  // Real Chromium Ctrl+click multi-selection and shared centre drag. Both
  // semantic constraints must update in ONE revision; native remains pending.
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-mode-sketch]');b?.click();return !!b})()"),
    'cannot enter sketch for group move');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch-hole-holeA]') && document.querySelector('[data-testid=runtime-sketch-hole-holeB]'))"),
    'model-backed sketch handles absent for group move');
  const groupBefore=await evaluate("(() => {const input=id=>Number(document.querySelector('[data-testid=runtime-hole-'+id+'-x]')?.value);return {a:input('holeA'),b:input('holeB'),revision:document.querySelector('[data-testid=runtime-revision]')?.textContent}})()");
  const pointB=await evaluate("(() => {const r=document.querySelector('[data-testid=runtime-sketch-hole-holeB]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointB.x,y:pointB.y,modifiers:2});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pointB.x,y:pointB.y,button:'left',buttons:1,clickCount:1,modifiers:2});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pointB.x,y:pointB.y,button:'left',buttons:0,clickCount:1,modifiers:2});
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-layout-select-holeA]')?.checked && document.querySelector('[data-testid=runtime-layout-select-holeB]')?.checked"),
    'Ctrl+click did not additive-select both authored holes');
  await screenshot('19-multi-hole-selected.png');
  const pointA=await evaluate("(() => {const r=document.querySelector('[data-testid=runtime-sketch-hole-holeA]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await mouse('mouseMoved',pointA.x,pointA.y);
  await mouse('mousePressed',pointA.x,pointA.y,1);
  await mouse('mouseMoved',pointA.x+24,pointA.y,1);
  await mouse('mouseReleased',pointA.x+24,pointA.y);
  const groupAfter=await eventually(async()=>{
    const value=await evaluate("(() => {const input=id=>Number(document.querySelector('[data-testid=runtime-hole-'+id+'-x]')?.value);return {a:input('holeA'),b:input('holeB'),revision:document.querySelector('[data-testid=runtime-revision]')?.textContent}})()");
    return value.a!==groupBefore.a&&value.b!==groupBefore.b?value:null;
  },'real multi-hole group translation');
  check(Math.abs((groupAfter.a-groupBefore.a)-(groupAfter.b-groupBefore.b))<1e-9,
    'Ctrl-selected group changed relative hole spacing or did not move atomically');
  check(groupAfter.revision!==groupBefore.revision,
    'group drag made no authoritative journal revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'group move claimed an unexecuted native cut');
  await screenshot('20-multi-hole-atomic-drag.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'group drag undo unavailable');
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)==="+groupBefore.a+" && Number(document.querySelector('[data-testid=runtime-hole-holeB-x]')?.value)==="+groupBefore.b),
    'group drag undo did not restore both constraints');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    'group drag redo unavailable');
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)==="+groupAfter.a+" && Number(document.querySelector('[data-testid=runtime-hole-holeB-x]')?.value)==="+groupAfter.b),
    'group drag redo did not reapply both constraints');
  const priorGroupSave=await evaluate('window.__modelArchiveBlobs.length');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Save model archive');b?.click();return !!b})()"),
    'cannot save multi-hole-edited model');
  await eventually(()=>evaluate('window.__modelArchiveBlobs.length==='+String(priorGroupSave+1)),
    'multi-hole archive absent');
  check(await evaluate("((async()=>{const data=await window.__modelArchiveBlobs.at(-1).text();const dt=new DataTransfer();dt.items.add(new File([data],'moved-holes.i3d-model.json',{type:'application/json'}));const input=document.querySelector('.runtime-file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})())"),
    'cannot reopen multi-hole archive');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'multi-hole archive review absent');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'multi-hole archive acceptance unavailable');
  await eventually(()=>evaluate("Number(document.querySelector('[data-testid=runtime-hole-holeA-x]')?.value)==="+groupAfter.a+" && Number(document.querySelector('[data-testid=runtime-hole-holeB-x]')?.value)==="+groupAfter.b),
    'archive reopening lost selected group constraints');
  await screenshot('21-multi-hole-archive-reopened.png');

  // Actual model-first Ctrl+N keyboard regression on the CI-executed Chromium
  // path. Cancellation must retain the existing journal and STEP state;
  // confirmation must replace it with a solved sketch, not a fabricated solid.
  const projectBeforeCtrlN=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  const sendCtrlN=async()=>{
    const shortcut={key:'n',code:'KeyN',windowsVirtualKeyCode:78,modifiers:2};
    await send('Input.dispatchKeyEvent',{type:'keyDown',...shortcut});
    await send('Input.dispatchKeyEvent',{type:'keyUp',...shortcut});
  };
  await sendCtrlN();
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'Ctrl+N did not present a project replacement review');
  await key('Escape','Escape',27);
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-import-review]')"),
    'Escape failed to cancel Ctrl+N');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===projectBeforeCtrlN &&
    await evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'Cancel Ctrl+N changed the current model or its pending native state');
  await sendCtrlN();
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'Ctrl+N could not reopen the project replacement review');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'Cannot confirm fresh sketch-only project');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-create-extrusion]')?.disabled===false && !document.querySelector('[data-testid=runtime-feature-plate]')"),
    'Confirmed Ctrl+N did not create an editable solved sketch without a solid');
  check((await evaluate("document.querySelector('.project-title')?.textContent?.includes('Sketch project')")) &&
      (await evaluate("document.querySelector('[data-testid=runtime-status-cut]')===null")),
    'New sketch project inherited a former native cut or incorrect title');
  await screenshot('22-ctrl-n-new-sketch.png');


  // WORKBENCH #177: actual Chromium file-selection flow. Reopen validation
  // must execute in a disposable module Worker, not block the React thread.
  const importWorkerInstrumented=await evaluate(`(() => {
    const PreviousWorker=window.Worker;
    window.__modelImportWorkerStarts=0;
    window.__modelImportFilePayloads=[];
    window.__modelMainFileTextReads=0;
    File.prototype.text=function(){
      window.__modelMainFileTextReads++;
      throw Error('Main-thread File.text() is forbidden during model import');
    };
    window.Worker=class extends PreviousWorker {
      constructor(...args){super(...args);window.__modelImportWorkerStarts++;}
      postMessage(payload,...rest){
        window.__modelImportFilePayloads.push(payload?.file instanceof File &&
          !Object.hasOwn(payload,'source'));
        if(window.__modelHoldNextWorkerRequest){
          window.__modelHoldNextWorkerRequest=false;
          return; // Simulate indefinitely delayed disk access on this Worker.
        }
        return super.postMessage(payload,...rest);
      }
    };
    return typeof window.Worker==='function';
  })()`);
  check(importWorkerInstrumented,'Cannot instrument real archive-validation worker');
  const beforeInvalidImport=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(await evaluate(`(() => {
    const dt=new DataTransfer();
    dt.items.add(new File(['invalid JSON {'],'broken.i3d-model.json',{type:'application/json'}));
    const input=document.querySelector('.runtime-file-input');
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`),'Cannot inject malformed archive through file input');
  await eventually(()=>evaluate("document.querySelector('.runtime-message')?.textContent?.includes('Open rejected')"),
    'malformed archive was not rejected by the isolated validator');
  check(await evaluate("window.__modelImportWorkerStarts===1"),
    'Malformed archive was not validated by a separate Worker');
  check(await evaluate("!document.querySelector('[data-testid=runtime-import-review]')"),
    'Malformed archive must not offer replacement');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===beforeInvalidImport,
    'Malformed archive changed the existing model');

  check(await evaluate(`(() => {
    const dt=new DataTransfer();
    dt.items.add(new File([new Uint8Array(4*1024*1024+1)],'oversized.i3d-model.json',
      {type:'application/json'}));
    const input=document.querySelector('.runtime-file-input');
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`),'Cannot inject oversized archive through file input');
  await eventually(()=>evaluate("document.querySelector('.runtime-message')?.textContent?.includes('4 MiB')"),
    'oversized file was not refused before reading');
  check(await evaluate("window.__modelImportWorkerStarts===1"),
    'Oversized archive should be rejected before creating a Worker');

  const archiveUndoCount=await evaluate("(async()=>JSON.parse(await window.__modelArchiveBlobs.at(-1).text()).history.undoStack.length)()");
  check(archiveUndoCount>=2,'Synthetic replay fixture lacks multiple durable undo frames');
  check(await evaluate(`(async()=>{
    const data=await window.__modelArchiveBlobs.at(-1).text();
    const dt=new DataTransfer();
    dt.items.add(new File([data],'multi-edit.i3d-model.json',{type:'application/json'}));
    const input=document.querySelector('.runtime-file-input');
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`),'Cannot inject multi-edit saved archive');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'valid multi-edit archive did not reach replacement review');
  check(await evaluate("window.__modelImportWorkerStarts===2"),
    'Valid archive did not pass through isolated Worker');
  check(await evaluate("window.__modelMainFileTextReads===0 && window.__modelImportFilePayloads.length===2 && window.__modelImportFilePayloads.every(Boolean)"),
    'The OS File was decoded on the UI thread or Worker received decoded JSON instead of the File');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===beforeInvalidImport,
    'Validation replaced the existing model before user consent');
  await screenshot('23-worker-import-confirmation.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(x=>x.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'Cannot confirm isolated validated multi-edit import');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-status-cut]')?.textContent==='pending_exact_provider'"),
    'Valid archive lost pending native status after replacement');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")!==beforeInvalidImport,
    'Confirmed archive did not replace model journal');
  await screenshot('24-worker-import-reopened.png');

  // A stalled file read must leave React responsive, expose cancellation and
  // never replace the journal. This holds just ONE real Worker request rather
  // than trying to fake a slow synchronous UI-thread parser.
  const beforeCancelledFile=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(await evaluate(`(() => {
    window.__modelHoldNextWorkerRequest=true;
    window.__modelImportHeartbeat=0;
    const dt=new DataTransfer();
    dt.items.add(new File(['{}'],'stalled.i3d-model.json',{type:'application/json'}));
    const input=document.querySelector('.runtime-file-input');
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    setTimeout(()=>{window.__modelImportHeartbeat++},0);
    return true;
  })()`),'Cannot simulate stalled File Worker');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-processing]'))"),
    'stalled Worker did not expose cancellable progress');
  await eventually(()=>evaluate("window.__modelImportHeartbeat===1"),'UI thread stopped processing timers during stalled file import');
  check(await evaluate("document.querySelector('[data-testid=runtime-import-stage]')?.textContent?.includes('Reading selected file')"),
    'Stalled file import has no visible reading-stage diagnostic');
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-import-processing-cancel]');b?.click();return !!b})()"),
    'Cancel control unavailable while Worker is stalled');
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-import-processing]')"),
    'Cancelling stalled Worker did not restore editor');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===beforeCancelledFile,
    'Cancelling stalled File Worker mutated authoritative document');
  check(await evaluate("!document.querySelector('[data-testid=runtime-import-review]') && window.__modelImportWorkerStarts===3 && window.__modelMainFileTextReads===0"),
    'Cancellation accepted unverified archive or main-thread read');

  // Actual Chromium pointer events on the model-backed selected-hole stamp.
  // A fresh default plate avoids accidental dependence on earlier imported
  // fixtures and verifies the real React controls rather than helper calls.
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-new-plate]');b?.click();return Boolean(b)})()"),
    'Cannot start fresh model-backed plate after archive import');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'new plate requested explicit replacement consent');
  check(await evaluate("(() => {const b=document.querySelector('[data-testid=runtime-import-review-confirm]');b?.click();return Boolean(b)})()"),
    'Cannot confirm a fresh plate for selected-hole acceptance');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-stamp-apply]') && document.querySelector('[data-testid=runtime-layout-select-holeB]') && !document.querySelector('[data-testid=runtime-import-review]'))"),
    'fresh model-backed selected-hole stamp editor');
  const clickControl=async selector=>{
    const point=await evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      if(!el||el.disabled)return null;
      el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    check(point&&Number.isFinite(point.x)&&Number.isFinite(point.y),
      'Pointer target missing or disabled: '+selector);
    await pause(120);
    await mouse('mouseMoved',point.x,point.y);
    await mouse('mousePressed',point.x,point.y,1);
    await mouse('mouseReleased',point.x,point.y);
  };
  // Imports/new-project confirmation preserve purely local selection state.
  // Make the exact two-source selection explicit regardless of prior tests.
  for(const id of ['holeA','holeB']){
    if(!await evaluate(`document.querySelector(${JSON.stringify('[data-testid="runtime-layout-select-'+id+'"]')})?.checked`))
      await clickControl('[data-testid="runtime-layout-select-'+id+'"]');
  }
  await eventually(()=>evaluate(
    "document.querySelector('[data-testid=runtime-layout-select-holeA]')?.checked===true && document.querySelector('[data-testid=runtime-layout-select-holeB]')?.checked===true"
  ),'physical two-hole selection');
  const stampBeforeRevision=await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent");
  await clickControl('[data-testid="runtime-stamp-apply"]');
  await eventually(()=>evaluate(
    "document.querySelectorAll('[data-testid^=\"runtime-hole-editor-stamp.\"]').length===2"
  ),'physical selected-hole batch stamp');
  check(await evaluate(
    "[...document.querySelectorAll('[data-testid^=\"runtime-layout-select-stamp.\"]')].filter(e=>e.checked).length===2"
  ),'Stamped semantic IDs not selected for subsequent group operations');
  check(await evaluate(
    "document.querySelector('[data-testid=runtime-revision]')?.textContent"
  )!==stampBeforeRevision,'Stamped holes did not advance authoritative revision');
  await screenshot('25-model-selected-hole-stamp.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Undo');b?.click();return Boolean(b)})()"),
    'Undo unavailable after selected-hole stamp');
  await eventually(()=>evaluate(
    "document.querySelectorAll('[data-testid^=\"runtime-hole-editor-stamp.\"]').length===0"
  ),'single-step selected-hole stamp undo');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Redo');b?.click();return Boolean(b)})()"),
    'Redo unavailable after selected-hole stamp undo');
  await eventually(()=>evaluate(
    "document.querySelectorAll('[data-testid^=\"runtime-hole-editor-stamp.\"]').length===2"
  ),'selected-hole stamp redo');
  // Selection is local UI state, not an undoable model artefact. Explicitly
  // reselect the two stamped IDs after the authoritative journal redo.
  const stampedCheckboxes=await evaluate(
    "[...document.querySelectorAll('[data-testid^=\"runtime-layout-select-stamp.\"]')].map(e=>e.dataset.testid)"
  );
  check(stampedCheckboxes.length===2,'No stable stamped IDs after redo');
  for(const id of stampedCheckboxes)
    if(!await evaluate(`document.querySelector(${JSON.stringify('[data-testid="'+id+'"]')})?.checked`))
      await clickControl('[data-testid="'+id+'"]');
  await clickControl('[data-testid="runtime-stamp-remove-selected"]');
  await eventually(()=>evaluate(
    "document.querySelectorAll('[data-testid^=\"runtime-hole-editor-stamp.\"]').length===0"
  ),'physical atomic batch deletion of two custom holes');
  check(await evaluate("document.querySelectorAll('[data-testid^=\"runtime-hole-editor-hole\"]').length")===2,
    'Batch deletion removed a protected base hole');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Undo');b?.click();return Boolean(b)})()"),
    'Undo unavailable after selected-hole batch removal');
  await eventually(()=>evaluate(
    "document.querySelectorAll('[data-testid^=\"runtime-hole-editor-stamp.\"]').length===2"
  ),'batch removal single-step undo');
  await screenshot('26-model-batch-delete-undo.png');

  // Actual Chromium controlled inputs and clicks for the newly admitted
  // selected-edge RUNTIME editor. The edge selector is populated from the
  // authoritative solved contour, not DOM/mesh edge-number inference.
  check(await evaluate("Boolean(document.querySelector('[data-testid=runtime-edge-hole-profile]'))"),
    'selected-edge RUNTIME inspector is not ready on a solved plate');
  const edgeBefore=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  for(const [field,value] of [['alongMm','12'],['insetMm','12'],['radiusMm','3']]){
    const selector='[data-testid="runtime-edge-hole-'+field+'"]';
    check(await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e?.focus();return document.activeElement===e})()`),
      'cannot focus real edge field '+field);
    await send('Input.insertText',{text:value});
    await eventually(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`),
      'selected-edge input '+field+' not accepted');
  }
  await clickControl('[data-testid="runtime-edge-hole-commit"]');
  const createdEdge=await eventually(()=>evaluate(
    "document.querySelector('[data-testid^=\"runtime-anchored-hole-hole.edge.\"]')?.dataset.testid || null"),
    'real selected-edge hole did not become authored SKETCH constraints');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")!==edgeBefore,
    'selected-edge edit did not advance the authoritative model revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-exact-state]')?.textContent?.toLowerCase().includes('exact')"),
    'exactness state disappeared after anchored-hole authoring');
  await screenshot('27-model-edge-anchored-hole.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'Undo unavailable after selected-edge hole');
  await eventually(()=>evaluate(`!document.querySelector(${JSON.stringify('[data-testid="'+createdEdge+'"]')})`),
    'selected-edge one-step undo retained the authored hole');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Redo');b?.click();return Boolean(b)})()"),
    'Redo unavailable after anchored hole undo');
  await eventually(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify('[data-testid="'+createdEdge+'"]')}))`),
    'selected-edge one-step redo lost stable hole ID');
  const beforeEdgeSave=await evaluate('window.__modelArchiveBlobs.length');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Save model archive');b?.click();return !!b})()"),
    'cannot save an edge-anchored authoritative journal');
  await eventually(()=>evaluate('window.__modelArchiveBlobs.length==='+String(beforeEdgeSave+1)),
    'edge-anchored model archive download absent');
  check(await evaluate("((async()=>{const data=await window.__modelArchiveBlobs.at(-1).text();const dt=new DataTransfer();dt.items.add(new File([data],'edge-anchor.i3d-model.json',{type:'application/json'}));const input=document.querySelector('.runtime-file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})())"),
    'cannot reopen edge-anchored model archive');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'edge-anchored archive validation did not reach review');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('[data-testid=runtime-import-review] button')].find(e=>e.textContent==='Replace with model archive');b?.click();return !!b})()"),
    'edge-anchored archive confirmation unavailable');
  await eventually(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify('[data-testid="'+createdEdge+'"]')}))`),
    'reopened edge-anchored journal lost semantic hole');
  await screenshot('28-model-edge-hole-archive-reopened.png');

  // Genuine browser pointer test: from zero sketch entities, not a seeded plate.
  // All mouse events travel through Chromium CDP → SVG coordinate conversion
  // → ephemeral preview → SKETCH acceptance → RUNTIME one-event journal.
  await clickControl('[data-testid="runtime-new-empty-sketch"]');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'empty-sketch project requires explicit replacement consent');
  await clickControl('[data-testid="runtime-import-review-confirm"]');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-blank-sketch]'))"),
    'real blank SVG canvas did not render without an admitted profile');
  const blankBefore=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(await evaluate("!document.querySelector('[data-testid=runtime-sketch]') && Boolean(document.querySelector('[data-testid=runtime-structural-sketch-dimensions]'))"),
    'empty sketch was replaced with a fabricated seeded profile');
  // A fixed 240 x 160 SVG used to trap actual from-empty authoring at one
  // scale. Exercise native DOM/CDP wheel + middle-pointer navigation BEFORE
  // any profile exists. Neither changes INTENT nor an unfinished sketch draft.
  const blankCanvasBox=await evaluate(`(() => {
    const s=document.querySelector('[data-testid=runtime-blank-sketch]');
    const b=s.getBoundingClientRect();
    return {x:b.left+b.width/2,y:b.top+b.height/2};
  })()`);
  check(blankCanvasBox&&Number.isFinite(blankCanvasBox.x),'blank SVG has no screen bounds');
  const anchorBefore=await evaluate(`(() => {
    const s=document.querySelector('[data-testid=runtime-blank-sketch]');
    const p=new DOMPoint(${blankCanvasBox.x},${blankCanvasBox.y}).matrixTransform(s.getScreenCTM().inverse());
    return {x:p.x,y:p.y};
  })()`);
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:blankCanvasBox.x,
    y:blankCanvasBox.y,deltaX:0,deltaY:-260});
  await eventually(()=>evaluate(`Number(document.querySelector('[data-testid=runtime-blank-sketch]').getAttribute('viewBox').split(' ')[2])<240`),
    'actual browser wheel failed to zoom the first empty sketch');
  const anchorAfter=await evaluate(`(() => {
    const s=document.querySelector('[data-testid=runtime-blank-sketch]');
    const p=new DOMPoint(${blankCanvasBox.x},${blankCanvasBox.y}).matrixTransform(s.getScreenCTM().inverse());
    return {x:p.x,y:p.y};
  })()`);
  check(Math.hypot(anchorAfter.x-anchorBefore.x,anchorAfter.y-anchorBefore.y)<0.01,
    'wheel zoom moved the sketch coordinate beneath the pointer');
  const beforePan=await evaluate(`document.querySelector('[data-testid=runtime-blank-sketch]').getAttribute('viewBox')`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',
    x:blankCanvasBox.x,y:blankCanvasBox.y,buttons:0});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',
    x:blankCanvasBox.x,y:blankCanvasBox.y,button:'middle',buttons:4,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',
    x:blankCanvasBox.x+42,y:blankCanvasBox.y+24,button:'middle',buttons:4});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',
    x:blankCanvasBox.x+42,y:blankCanvasBox.y+24,button:'middle',buttons:0,clickCount:1});
  await eventually(()=>evaluate(`document.querySelector('[data-testid=runtime-blank-sketch]').getAttribute('viewBox')!==${JSON.stringify(beforePan)}`),
    'actual middle-button pointer drag did not pan the empty sketch');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===blankBefore,
    'wheel or middle-pan mutated the authoritative empty sketch revision');
  await screenshot('29-blank-sketch-wheel-middle-pan.png');
  await clickControl('[data-testid="runtime-blank-view-reset"]');
  await eventually(()=>evaluate(`document.querySelector('[data-testid=runtime-blank-sketch]').getAttribute('viewBox')==='-20 -20 240 160'`),
    'Reset view failed to restore the original pointer drawing extent');
  await clickControl('[data-testid="runtime-blank-zoom-in"]');
  await eventually(()=>evaluate(`Number(document.querySelector('[data-testid=runtime-blank-sketch]').getAttribute('viewBox').split(' ')[2])<240`),
    'Zoom in button failed on blank canvas');
  await clickControl('[data-testid="runtime-blank-view-reset"]');
  await eventually(()=>evaluate(`document.querySelector('[data-testid=runtime-blank-sketch]').getAttribute('viewBox')==='-20 -20 240 160'`),
    'Zoom/reset controls did not restore the real pointer mapping');
  // Adversarial *real pointer* admission before the successful journey:
  // a bow-tie's four legitimate clicks must never silently author a profile.
  // Escape after SKETCH's refusal must discard only ephemeral draft vertices.
  const clickBlankVertex=async(x,y)=>{
    const point=await evaluate('(() => {const svg=document.querySelector("[data-testid=runtime-blank-sketch]");const m=svg?.getScreenCTM();if(!m)return null;const p=new DOMPoint('+x+','+(120-y)+').matrixTransform(m);return {x:p.x,y:p.y}})()');
    check(point&&Number.isFinite(point.x)&&Number.isFinite(point.y),
      'no real screen-matrix mapping for blank sketch vertex');
    await mouse('mouseMoved',point.x,point.y);
    await mouse('mousePressed',point.x,point.y,1);
    await mouse('mouseReleased',point.x,point.y);
  };
  await clickControl('[data-testid="runtime-outline-tool"]');
  for(const [x,y] of [[0,0],[120,80],[0,80],[120,0]])
    await clickBlankVertex(x,y);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-contour-vertex-count]')?.textContent?.includes('4 / 12')"),
    'crossing sketch did not collect four actual pointer vertices');
  await clickControl('[data-testid="runtime-close-contour"]');
  await eventually(()=>evaluate("document.querySelector('.runtime-message')?.textContent?.includes('SKETCH refused this outline')"),
    'crossing contour did not surface an authoritative SKETCH refusal');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===blankBefore &&
    await evaluate("!document.querySelector('[data-testid=runtime-sketch]')"),
    'crossing contour refusal mutated the journal or published a solved profile');
  await screenshot('29a-crossing-outline-refused.png');
  await key('Escape','Escape',27);
  await eventually(()=>evaluate("!document.querySelector('[data-testid=runtime-contour-vertex-count]')"),
    'Escape did not cancel the invalid pointer draft');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===blankBefore &&
    await evaluate("Boolean(document.querySelector('[data-testid=runtime-blank-sketch]'))"),
    'Escape after crossing refusal changed the original empty model');
  await screenshot('29b-crossing-outline-escape.png');
  // Real CDP pointer pixels cannot guarantee the ideal subpixel SVG inverse.
  // The authored point must land on an integer 1 mm grid, near the requested
  // location; never demand a literal ideal origin from rounded screen pixels.
  await clickControl('[data-testid="runtime-outline-tool"]');
  await clickBlankVertex(0.24,0.29);
  await eventually(()=>evaluate("(() => {const p=document.querySelector('[data-testid=runtime-draft-vertex-0]');if(!p)return false;const x=Number(p.getAttribute('cx')),y=Number(p.getAttribute('cy'));return Number.isInteger(x)&&Number.isInteger(y)&&Math.hypot(x-0.24,y-0.29)<1.3})()"),
    'actual pointer was not quantized to a nearby integer-mm sketch vertex');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===blankBefore,
    'grid-snapped ephemeral click changed the authoritative journal');
  await clickControl('[data-testid="runtime-undo-contour-point"]');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-contour-vertex-count]')?.textContent?.includes('0 / 12')"),
    'Undo vertex failed after snapped pointer click');
  // A genuinely Shift-modified CDP click must preserve off-grid coordinates.
  // This is browser event delivery, not a synthetic React onClick invocation.
  const fineScreen=await evaluate('(() => {const svg=document.querySelector("[data-testid=runtime-blank-sketch]");const m=svg?.getScreenCTM();if(!m)return null;const p=new DOMPoint(0.237,119.711).matrixTransform(m);return {x:p.x,y:p.y}})()');
  check(fineScreen&&Number.isFinite(fineScreen.x),'no fine-grain screen matrix');
  for(const [type,buttons] of [['mouseMoved',0],['mousePressed',1],['mouseReleased',0]])
    await send('Input.dispatchMouseEvent',{type,x:fineScreen.x,y:fineScreen.y,
      button:'left',buttons,clickCount:1,modifiers:8});
  await eventually(()=>evaluate("(() => {const p=document.querySelector('[data-testid=runtime-draft-vertex-0]');if(!p)return false;const x=Number(p.getAttribute('cx')),y=Number(p.getAttribute('cy'));return Number.isFinite(x)&&Number.isFinite(y)&&(Math.abs(x-Math.round(x))>=0.001||Math.abs(y-Math.round(y))>=0.001)&&Math.hypot(x-0.237,y-0.289)<1.3})()"),
    'Shift-modified pointer was not admitted at a nearby off-grid sketch coordinate');
  await clickControl('[data-testid="runtime-undo-contour-point"]');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-contour-vertex-count]')?.textContent?.includes('0 / 12')"),
    'Undo vertex failed after Shift fine placement');
  // A new independent gesture on the unchanged zero-entity sketch succeeds.
  for(const [x,y] of [[0,0],[120,0],[120,80],[0,80]])
    await clickBlankVertex(x,y);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-contour-vertex-count]')?.textContent?.includes('4 / 12')"),
    'four genuine pointer clicks did not create ephemeral vertices');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")===blankBefore,
    'unclosed pointer vertices incorrectly modified the INTENT journal');
  await screenshot('29-from-empty-pointer-four-vertices.png');
  await clickControl('[data-testid="runtime-close-contour"]');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch]'))"),
    'Close did not commit SKETCH through versioned RUNTIME structural authoring');
  const closedRevision=await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent");
  check(closedRevision!==blankBefore,'Close did not commit one authoritative revision');
  check(await evaluate("document.querySelector('[data-testid=runtime-boundary]')?.textContent?.includes('4 outline vertices')"),
    'user-created polygon did not become the admitted analytic sketch preview');
  await screenshot('30-from-empty-authoritative-closed-contour.png');
  // One authoritative Undo removes the whole contour, not a single point.
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'undo button unavailable after contour close');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-blank-sketch]'))"),
    'undo did not remove the full original contour in one history frame');
  check(await evaluate("document.querySelector('[data-testid=runtime-revision]')?.textContent")!==closedRevision,
    'undo failed to advance the immutable revision');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    'redo button unavailable after contour undo');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch]'))"),
    'redo did not re-admit the source-bound contour');
  const savedCount=await evaluate('window.__modelArchiveBlobs.length');
  await clickControl('[data-testid="runtime-save-archive"]');
  await eventually(()=>evaluate('window.__modelArchiveBlobs.length === '+(savedCount+1)),
    'drawn sketch failed to download an authoritative model archive');
  check(await evaluate("((async()=>{const blob=window.__modelArchiveBlobs.at(-1);const text=await blob.text();const dt=new DataTransfer();dt.items.add(new File([text],'blank-drawn.i3d-model.json',{type:'application/json'}));const input=document.querySelector('.runtime-file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})())"),
    'cannot select saved drawn-sketch archive through real browser File input');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'drawn-sketch archive did not reach isolated Worker validation review');
  await clickControl('[data-testid="runtime-import-review-confirm"]');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-sketch]'))"),
    'drawn-sketch archive reopened without authored contour');
  check(await evaluate("!document.querySelector('[data-testid=runtime-blank-sketch]')"),
    'reopened authoritative contour was discarded or replaced by empty sketch');
  await screenshot('31-from-empty-authoritative-save-reopen.png');
  const originalDrawnVertex=await evaluate(`(() => {
    const text=document.querySelector('[data-testid=runtime-sketch] polygon')?.getAttribute('points')||'';
    const pair=text.trim().split(/\\s+/)[2]?.split(',').map(Number);
    return pair?.length===2&&pair.every(Number.isFinite)?{x:pair[0],y:pair[1]}:null;
  })()`);
  check(originalDrawnVertex&&Number.isFinite(originalDrawnVertex.x),
    'missing solver-derived original drawn vertex for undo baseline');


  // Re-select the genuinely authored contour after archive import, not a
  // template-based pointer fixture. The persisted SKETCH vertices are handles.
  await clickControl('[data-testid="runtime-profile-select-mode"]');
  const drawnPick=await evaluate(`(() => {
    const svg=document.querySelector('[data-testid=runtime-sketch]');
    if(!svg||!svg.getScreenCTM())return null;
    const p=new DOMPoint(45,35).matrixTransform(svg.getScreenCTM());
    return {x:p.x,y:p.y};
  })()`);
  check(drawnPick&&Number.isFinite(drawnPick.x),'drawn contour selection had no real SVG projection');
  await mouse('mouseMoved',drawnPick.x,drawnPick.y);
  await mouse('mousePressed',drawnPick.x,drawnPick.y,1);
  await mouse('mouseReleased',drawnPick.x,drawnPick.y);
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-pointer-profile-selected]')?.textContent?.includes('Drawn outline')"),
    'user-drawn profile could not be semantically reselected after reopening');
  check(await evaluate(`(() => {
    const s=document.querySelector('[data-testid=runtime-drawn-vertex-select]');
    if(!s)return false;
    const o=[...s.options].find(item=>item.value.endsWith(':handle:2'));
    if(!o)return false;s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`),'semantic drawn vertex #2 not offered');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-drawn-contour-vertex-editor]'))"),
    'drawn vertex did not expose a numeric model-backed editor');
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-drawn-vertex-x]');e?.focus();e?.select();return document.activeElement===e})()"),
    'drawn vertex X cannot receive actual keyboard focus');
  await send('Input.insertText',{text:'135'});
  check(await evaluate("(() => {const e=document.querySelector('[data-testid=runtime-drawn-vertex-y]');e?.focus();e?.select();return document.activeElement===e})()"),
    'drawn vertex Y cannot receive actual keyboard focus');
  await send('Input.insertText',{text:'90'});
  check(await evaluate("document.querySelector('[data-testid=runtime-drawn-vertex-x]')?.value==='135' && document.querySelector('[data-testid=runtime-drawn-vertex-y]')?.value==='90'"),
    'physical keyboard values were not entered into the drawn vertex editor');
  await clickControl('[data-testid="runtime-drawn-vertex-commit"]');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-sketch] polygon')?.getAttribute('points')?.includes('135,90')"),
    'numeric drawn-vertex edit was not admitted as changed sketch geometry');
  await screenshot('34-drawn-vertex-numeric-edit.png');

  // Direct manipulation of the same explicitly chosen semantic handle goes
  // through the same versioned RUNTIME transaction, not a pixel-only preview.
  const vertexGesture=await evaluate(`(() => {
    const h=document.querySelector('[data-testid=runtime-profile-drag-handle]');
    if(!h||!h.getScreenCTM())return null;
    const matrix=h.getScreenCTM();
    const from=new DOMPoint(Number(h.getAttribute('cx')),Number(h.getAttribute('cy'))).matrixTransform(matrix);
    const to=new DOMPoint(140,92).matrixTransform(matrix);
    return {from:{x:from.x,y:from.y},to:{x:to.x,y:to.y}};
  })()`);
  check(vertexGesture&&Number.isFinite(vertexGesture.from.x),
    'semantic vertex drag marker did not project into screen coordinates');
  await mouse('mouseMoved',vertexGesture.from.x,vertexGesture.from.y);
  await mouse('mousePressed',vertexGesture.from.x,vertexGesture.from.y,1);
  await mouse('mouseMoved',vertexGesture.to.x,vertexGesture.to.y,1);
  await mouse('mouseReleased',vertexGesture.to.x,vertexGesture.to.y);
  // SVG screen-to-sketch inversion can have low-order floating-point noise.
  // Assert the real solved millimetre position, not a string representation
  // of a binary number such as 139.99999717325736.
  const drawnVertexAt=(x,y)=>evaluate(`(() => {
    const text=document.querySelector('[data-testid=runtime-sketch] polygon')?.getAttribute('points')||'';
    return text.trim().split(/\\s+/).some(item=>{
      const [px,py]=item.split(',').map(Number);
      return Number.isFinite(px)&&Number.isFinite(py)&&Math.hypot(px-${x},py-${y})<0.01;
    });
  })()`);
  try{
    await eventually(()=>drawnVertexAt(140,92),
      'actual pointer drag of a committed drawn vertex failed');
  }catch(failure){
    const detail=await evaluate(`(() => ({
      polygon:document.querySelector('[data-testid=runtime-sketch] polygon')?.getAttribute('points'),
      vertexHandle:document.querySelector('[data-testid=runtime-profile-drag-handle]')?.getAttribute('cx'),
      vertexY:document.querySelector('[data-testid=runtime-profile-drag-handle]')?.getAttribute('cy'),
      selected:document.querySelector('[data-testid=runtime-pointer-profile-selected]')?.textContent,
      message:document.querySelector('[data-testid=runtime-panel] [role="alert"]')?.textContent,
      allAlerts:[...document.querySelectorAll('[role="alert"]')].map(x=>x.textContent),
      status:[...document.querySelectorAll('.runtime-message')].map(x=>x.textContent),
      revision:document.querySelector('[data-testid=runtime-revision]')?.textContent,
      marker:document.querySelector('[data-testid=runtime-profile-drag-handle]')?.outerHTML?.slice(0,400)
    }))()`);
    await screenshot('35-drawn-vertex-pointer-failed.png');
    throw Error(String(failure)+'; drag diagnostics='+JSON.stringify(detail));
  }
  await screenshot('35-drawn-vertex-pointer-drag.png');
  const undoButton=()=>evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Undo');b?.click();return !!b})()");
  const redoButton=()=>evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Redo');b?.click();return !!b})()");
  check(await undoButton(),'undo unavailable after real drawn vertex drag');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-sketch] polygon')?.getAttribute('points')?.includes('135,90')"),
    'undo of pointer movement failed to restore the precise numeric vertex');
  check(await undoButton(),'undo unavailable after drawn vertex numeric edit');
  await eventually(()=>drawnVertexAt(originalDrawnVertex.x,originalDrawnVertex.y),
    'second undo failed to restore the actual pointer-drawn solver-authoritative vertex');
  check(await redoButton(),'redo unavailable after numeric vertex undo');
  await eventually(()=>drawnVertexAt(135,90),'first redo did not reapply numeric semantic vertex edit');
  check(await redoButton(),'redo unavailable after direct vertex undo');
  await eventually(()=>drawnVertexAt(140,92),
    'redo failed to recover the fully edited drawn vertex');
  await screenshot('36-drawn-vertex-undo-redo.png');
  const editedSavedCount=await evaluate('window.__modelArchiveBlobs.length');
  await clickControl('[data-testid="runtime-save-archive"]');
  await eventually(()=>evaluate('window.__modelArchiveBlobs.length === '+(editedSavedCount+1)),
    'edited drawn contour failed to save');
  check(await evaluate("((async()=>{const text=await window.__modelArchiveBlobs.at(-1).text();const dt=new DataTransfer();dt.items.add(new File([text],'drawn-vertex.i3d-model.json',{type:'application/json'}));const input=document.querySelector('.runtime-file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})())"),
    'edited drawn contour archive could not be selected');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'edited contour archive did not reach Worker validation');
  await clickControl('[data-testid="runtime-import-review-confirm"]');
  await eventually(()=>drawnVertexAt(140,92),
    'reopened authored contour lost the moved vertex');
  await screenshot('37-drawn-vertex-edit-reopened.png');

  // Continue on the SAME genuinely drawn project: model-backed extrusion,
  // accepted circular-hole operation, explicitly body-targeted cut and archive.
  await clickControl('[data-testid="runtime-create-extrusion"]');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-plate]')?.textContent?.includes('preview_only')"),
    'drawn contour failed to author a preview-only extrusion');
  check(await evaluate("!document.querySelector('[data-testid=runtime-feature-cut]')"),
    'cut was authored without user consent on the drawn project');
  await clickControl('[data-testid="runtime-add-hole"]');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-hole-inspector] .section-head')?.textContent?.includes('1')"),
    'actual selected sketch did not admit a user-authored circular hole');
  check(await evaluate("Boolean(document.querySelector('[data-testid=runtime-create-cut]:not([disabled])'))"),
    'explicit body-targeted cut did not become available after hole acceptance');
  await clickControl('[data-testid="runtime-create-cut"]');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-cut]')?.textContent?.includes('pending_exact_provider')"),
    'drawn-project cut did not retain honest pending native-exact status');
  await screenshot('32-from-empty-extrusion-hole-cut.png');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Undo');b?.click();return !!b})()"),
    'undo unavailable after explicit drawn-project cut');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-cut]')?.classList.contains('removed')"),
    'cut undo failed to tombstone only the cut feature');
  check(await evaluate("(() => {const b=[...document.querySelectorAll('.runtime-shell button')].find(e=>e.textContent?.trim()==='Redo');b?.click();return !!b})()"),
    'redo unavailable after drawn-project cut undo');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-cut]')?.textContent?.includes('pending_exact_provider')"),
    'cut redo failed to restore semantic target and pending native status');
  const drawnCutSavedCount=await evaluate('window.__modelArchiveBlobs.length');
  await clickControl('[data-testid="runtime-save-archive"]');
  await eventually(()=>evaluate('window.__modelArchiveBlobs.length === '+(drawnCutSavedCount+1)),
    'complete drawn contour / extrusion / cut archive not downloaded');
  check(await evaluate("((async()=>{const data=await window.__modelArchiveBlobs.at(-1).text();const dt=new DataTransfer();dt.items.add(new File([data],'drawn-cut.i3d-model.json',{type:'application/json'}));const el=document.querySelector('.runtime-file-input');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));return true})())"),
    'cannot reselect complete drawn CAD project in real Chromium File input');
  await eventually(()=>evaluate("Boolean(document.querySelector('[data-testid=runtime-import-review]'))"),
    'complete drawn CAD archive did not reach isolated Worker review');
  await clickControl('[data-testid="runtime-import-review-confirm"]');
  await eventually(()=>evaluate("document.querySelector('[data-testid=runtime-feature-cut]')?.textContent?.includes('pending_exact_provider')"),
    'complete drawn CAD archive lost cut or falsely promoted native state');
  await screenshot('33-from-empty-extrusion-cut-reopened.png');
  check(exceptions.length === 0, 'Browser exceptions: ' + exceptions.join('; '));
  const report = {
    actualThreeDimensionalThicknessManipulation: true,
    blurredThicknessGestureCancelled: true,
    thicknessDragMm: 11, thicknessKeyboardMm: 12,
    cursorVisualOriginVerifiedWithoutEdit: true,
    blurredGestureCancelledWithoutRevision: true,
    missingAndSingularSvgProjectionFailClosed: true,
    previewUnitExpressionCommittedAndUndoable: true,
    invalidExpressionRejectedWithoutRevision: true,
    roundedAwayDimensionEditRejectedWithoutRevision: true,
    explicitProjectImportReviewCancelAndInvalidAcceptance: true,
    expressionEscapeAbandonedUncommittedEdit: true,
    evidence: 'actual Chromium software-WebGL React preview and CDP pointer/keyboard/recovery interactions',
    initialWidthMm: 120, draggedWidthMm: 128, recoveredWidthMm: 128,
    keyboardHoleDiameterMm: 13, recoveredHoleDiameterMm: 13,
    screenshots: ['00-model-first-start.png', '01-solid.png', '02-sketch.png', '02a-invalid-expression.png', '02b-precision-loss.png', '02-cursor-snap.png', '03-width-drag.png', '04-keyboard-edit.png', '05-recovered.png', '06-solid-thickness-drag.png', '07-solid-thickness-keyboard.png', '08-import-review.png', '09-imported-invalid-preview.png', '10-model-runtime-solid.png', '11-model-runtime-sketch.png', '12-model-runtime-blocked.png', '13-model-runtime-reopened.png', '14-model-runtime-new-plate.png', '15-sketch-first-solved.png', '15a-e-combo-extrusion.png', '16-sketch-extruded-uncut.png', '16a-e-combo-cut.png', '17-sketch-through-cut-pending-native.png', '18-sketch-cut-archive-reopened.png','19-multi-hole-selected.png','20-multi-hole-atomic-drag.png','21-multi-hole-archive-reopened.png','22-ctrl-n-new-sketch.png','23-worker-import-confirmation.png','24-worker-import-reopened.png','25-model-selected-hole-stamp.png','26-model-batch-delete-undo.png','27-model-edge-anchored-hole.png','28-model-edge-hole-archive-reopened.png','29a-crossing-outline-refused.png','29b-crossing-outline-escape.png','29-from-empty-pointer-four-vertices.png','30-from-empty-authoritative-closed-contour.png','31-from-empty-authoritative-save-reopen.png','32-from-empty-extrusion-hole-cut.png','33-from-empty-extrusion-cut-reopened.png','34-drawn-vertex-numeric-edit.png','35-drawn-vertex-pointer-drag.png','36-drawn-vertex-undo-redo.png','37-drawn-vertex-edit-reopened.png'],
    modelBackedJournalSketchRuntimeBrowserEvidence: true,
    modelBackedSaveOpenInvalidIntentPreserved: true,
    ctrlSScopeIsolatedToModelArchive: true,
    newModelProjectRequiresConsentAndFreshIdentity: true,
    actualSketchFirstExtrudeCutInteraction: true,
    uncutExtrusionHonestPreview: true,
    stagedCutUndoRedoAndArchiveReopen: true,
    keyboardEComboExtrusionAndCut: true,
    physicalCtrlClickMultiHoleAtomicDragAndArchive: true,
    actualChromiumCtrlNCancelAndSolvedNewSketch: true,
    comboEscapeLeavesJournalUnchanged: true,
    archiveValidationRunsInRealChromiumWorker: true,
    malformedAndOversizedFileSelectionPreservesExistingModel: true,
    multiUndoHistoryWorkerImportRequiresConfirmation: true,
    actualChromiumSelectedHoleStampAndBatchDeleteUndo: true,
    actualChromiumSelectedEdgeHoleCreateUndoRedoArchive: true,
    actualCrossingContourRefusedAndEscapePreservesEmptyHistory: true,
    realChromiumBlankGridSnapPreservesDraftAndUndo: true,
    realChromiumShiftFineBlankPointerRemainsOffGrid: true,
    genuineEmptySketchFourPointerVerticesAuthoritativeContourUndoRedoSaveReopen: true,
    genuineDrawnContourExtrusionHoleCutUndoRedoSaveReopen: true,
    genuinelyDrawnVertexNumericAndPointerEditUndoRedoReopen: true,
    limits: 'Legacy mode is preview only; model-backed mode uses INTENT/SKETCH/RUNTIME but does not establish exact OCCT, independent STEP or human acceptance.'
  };
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('WORKBENCH_HANDLE_BROWSER_PASS ' + JSON.stringify(report));
}
main().catch(error => {
  console.error('WORKBENCH_HANDLE_BROWSER_FAIL', String(error?.stack || error));
  process.exitCode = 1;
}).finally(async () => {
  try { ws?.close(); } catch {}
  for (const child of children.reverse()) {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch { try { child.kill('SIGKILL'); } catch {} }
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  await pause(100);
  try { rmSync(home, { recursive: true, force: true }); } catch {}
});
