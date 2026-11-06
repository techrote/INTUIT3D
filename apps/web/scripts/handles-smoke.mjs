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
  await eventually(async () => evaluate("Boolean(document.querySelector('canvas') && document.querySelector('.ribbon-button'))"), 'hydrated 3D workbench');
  await screenshot('01-solid.png');

  check(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Sketch');b?.click();return !!b})()"),
    'Sketch ribbon unavailable');
  await eventually(async () => evaluate("Boolean(document.querySelector('[data-testid=dimension-handle-width]'))"), 'sketch handles');
  await screenshot('02-sketch.png');
  check(await numberValue('Plate width') === '120', 'Unexpected initial width');

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
  check(exceptions.length === 0, 'Browser exceptions: ' + exceptions.join('; '));
  const report = {
    cursorVisualOriginVerifiedWithoutEdit: true,
    evidence: 'actual Chromium software-WebGL React preview and CDP pointer/keyboard/recovery interactions',
    initialWidthMm: 120, draggedWidthMm: 128, recoveredWidthMm: 128,
    keyboardHoleDiameterMm: 13, recoveredHoleDiameterMm: 13,
    screenshots: ['01-solid.png', '02-sketch.png', '02-cursor-snap.png', '03-width-drag.png', '04-keyboard-edit.png', '05-recovered.png'],
    limits: 'Preview only; no SKETCH solver, exact B-rep/OCCT, independent STEP or human acceptance.'
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
