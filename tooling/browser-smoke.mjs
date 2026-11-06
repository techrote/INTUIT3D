#!/usr/bin/env node
/**
 * An actual hosted Chromium/React rendering and edit/recovery smoke.
 * No external test runner or cloud service: Chrome DevTools Protocol (CDP)
 * via Node's built-in WebSocket, with the locally built Vite preview.
 * Does not validate OCCT/B-rep, exported STEP or human UX.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:4173';
const artifactDir = process.env.INTUIT3D_BROWSER_ARTIFACTS || 'browser-evidence';
const home = mkdtempSync(join(tmpdir(), 'intuit3d-browser-'));
const owned = [];
let browserErrors = [];
const assert = (test, message) => { if (!test) throw Error(message); };
const eventually = async (f, label, attempts = 80) => {
  for (let i = 0; i < attempts; i++) {
    try { const result = await f(); if (result) return result; } catch {}
    await pause(150);
  }
  throw Error('Timed out: ' + label);
};
const browserExecutable = () => {
  for (const executable of ['google-chrome', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [executable], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw Error('No Chromium executable in hosted runner');
};
let ws;
const requests = new Map();
let seq = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { requests.delete(id); reject(Error('CDP timeout: ' + method)); }, 10000);
  requests.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (reply.exceptionDetails) throw Error('Browser JavaScript exception: ' + JSON.stringify(reply.exceptionDetails));
  return reply.result?.value;
};
async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const vite = spawn('npm', ['run', 'preview', '--workspace', '@intuit3d/web',
    '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  owned.push(vite);
  let serverLog = '';
  vite.stdout.on('data', data => serverLog += data.toString());
  vite.stderr.on('data', data => serverLog += data.toString());
  await eventually(async () => (await fetch(origin)).ok, 'local Vite preview');
  assert(!vite.exitCode, 'Vite exited before browser startup');

  const chrome = spawn(browserExecutable(), [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--window-size=1360,900', '--remote-debugging-port=0', '--user-data-dir=' + home,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  owned.push(chrome);
  let chromeLog = '';
  chrome.stderr.on('data', data => { chromeLog = (chromeLog + data.toString()).slice(-12000); });
  const portText = await eventually(() => existsSync(join(home, 'DevToolsActivePort')) &&
    readFileSync(join(home, 'DevToolsActivePort'), 'utf8'), 'Chromium CDP port');
  const port = Number(portText.split('\n')[0]);
  assert(Number.isSafeInteger(port) && port > 0, 'invalid CDP port');
  const targets = await eventually(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const targets = await response.json();
    return targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, 'Chromium page target');
  ws = new WebSocket(targets.webSocketDebuggerUrl);
  ws.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if (packet.method === 'Runtime.exceptionThrown') {
      browserErrors.push(packet.params?.exceptionDetails?.text || 'Browser exception');
    }
    if (!requests.has(packet.id)) return;
    const pending = requests.get(packet.id);
    requests.delete(packet.id); clearTimeout(pending.timer);
    if (packet.error) pending.reject(Error(JSON.stringify(packet.error)));
    else pending.resolve(packet.result);
  });
  await eventually(() => ws.readyState === WebSocket.OPEN, 'CDP websocket');
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: origin });
  const hydrated = await eventually(async () => evaluate(
    "Boolean(document.querySelector('[data-testid=solid-viewport]') && document.querySelector('input[type=number]') && document.querySelector('canvas'))"
  ), 'React workbench + WebGL canvas hydration');
  assert(hydrated, 'Missing hydrated workbench viewport');
  const first = await evaluate("({name:document.querySelector('input[type=number]').getAttribute('aria-label'),value:document.querySelector('input[type=number]').value})");
  assert(first?.name && first?.value, 'Missing editable numeric dimension input');

  const before = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(artifactDir, '01-render.png'), Buffer.from(before.data, 'base64'));

  await evaluate("(() => {const e=document.querySelector('input[type=number]'); e.focus();e.select();return true})()");
  await send('Input.insertText', { text: '133' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  const edited = await eventually(async () => evaluate(
    "(() => {const e=document.querySelector('input[type=number]');return e?.value==='133' && Boolean(localStorage.getItem('intuit3d:web-preview-recovery:current') || [...Array(localStorage.length)].some((_,i)=>localStorage.key(i)?.includes('recovery')))})()"
  ), 'parameter edit and browser-local recovery commit');
  assert(edited, 'Parameter change was not persisted');

  const after = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(artifactDir, '02-edit.png'), Buffer.from(after.data, 'base64'));
  await send('Page.reload', { ignoreCache: true });
  const dialog = await eventually(() => evaluate("Boolean(document.querySelector('[data-testid=recovery-dialog]'))"), 'explicit recovery dialog');
  assert(dialog, 'Browser did not offer recovery after reload');
  const recoveryButton = await evaluate(
    "(() => {let btn=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='Recover draft'); if(!btn)return false;btn.click();return true})()");
  assert(recoveryButton, 'Recover draft button unavailable');
  await eventually(async () => evaluate(
    "(() => !document.querySelector('[data-testid=recovery-dialog]') && document.querySelector('input[type=number]')?.value==='133')()"
  ), 'recovered edited dimension');
  const recovered = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(artifactDir, '03-recovered.png'), Buffer.from(recovered.data, 'base64'));
  assert(browserErrors.length === 0, 'Browser runtime exceptions: ' + browserErrors.join('; '));
  const report = {
    evidence: 'graphical: actual Chromium React/Vite rendering and CDP edit/reload/recover',
    browserExecutable: browserExecutable(), origin, input: first, editedValue: '133',
    recoveryModalPresented: dialog, recoveredDimension: '133',
    screenshots: ['01-render.png', '02-edit.png', '03-recovered.png'],
    limits: 'Polygonal WebGL preview only; no OCCT exact geometry, independent STEP or human acceptance.'
  };
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('BROWSER_GRAPHICAL_SMOKE_PASSED ' + JSON.stringify(report));
}
main().catch(error => {
  console.error('BROWSER_GRAPHICAL_SMOKE_FAILED', String(error?.stack || error));
  process.exitCode = 1;
}).finally(async () => {
  try { ws?.close(); } catch {}
  for (const child of owned.reverse()) { try { child.kill('SIGKILL'); } catch {} }
  await pause(100);
  try { rmSync(home, { recursive: true, force: true }); } catch {}
});
