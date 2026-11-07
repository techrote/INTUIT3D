#!/usr/bin/env node
/**
 * Deliberately small, dependency-free integration gate.
 * A green bootstrap means ONLY that existing targets executed; absent targets
 * are reported as not implemented, never as CAD/native/graphical acceptance.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lanes = Object.freeze({
  'apps/web': 'WORKBENCH',
  'packages/model': 'INTENT',
  'packages/sketch': 'SKETCH',
  'packages/kernel-contract': 'KERNEL',
  'packages/workflow-runtime': 'RUNTIME',
});
const phases = ['typecheck', 'lint', 'test', 'build'];

function isDirectory(path) {
  return existsSync(path) && lstatSync(path).isDirectory();
}

export function inspectWorkspaces(projectRoot = root) {
  const seen = new Set();
  const found = [];
  for (const parent of ['apps', 'packages']) {
    const parentPath = join(projectRoot, parent);
    if (!existsSync(parentPath)) continue;
    if (!isDirectory(parentPath)) throw Error(`${parent} must be a directory, not a symlink or file`);
    for (const item of readdirSync(parentPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.')) continue;
      if (!item.isDirectory()) throw Error(`${parent}/${item.name} must be a directory`);
      const rel = `${parent}/${item.name}`;
      const manifest = join(projectRoot, rel, 'package.json');
      if (!existsSync(manifest)) throw Error(`${rel} exists but has no package.json (cannot qualify it)`);
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (!pkg.name || typeof pkg.name !== 'string') throw Error(`${rel}: missing package name`);
      if (seen.has(pkg.name)) throw Error(`duplicate workspace package name ${pkg.name}`);
      seen.add(pkg.name);
      if (!pkg.scripts || typeof pkg.scripts.test !== 'string' || !pkg.scripts.test.trim()) {
        throw Error(`${rel}: executable 'test' script required for integration`);
      }
      if (/^\s*(?:echo\b|true\s*$|exit\s+0\s*$)/i.test(pkg.scripts.test)) {
        throw Error(`${rel}: no-op/placeholder 'test' script is not accepted`);
      }
      found.push({ path: rel, name: pkg.name, lane: lanes[rel] || 'UNASSIGNED', scripts: pkg.scripts });
    }
  }
  return found;
}

export function inspectNative(projectRoot = root) {
  const native = join(projectRoot, 'native');
  if (!existsSync(native)) return { kind: 'not_implemented', detail: 'native/ absent: NO native qualification performed' };
  if (!isDirectory(native)) throw Error('native/ must be a directory');
  const smoke = join(native, 'ci.sh');
  if (!existsSync(smoke) || !lstatSync(smoke).isFile()) {
    throw Error('native/ exists but native/ci.sh is missing; native test gate cannot be skipped');
  }
  return { kind: 'ready', command: 'bash native/ci.sh' };
}

/**
 * Web's @types/three auto-registers an ambient WebGPU type absent from strict
 * SKETCH-only declaration consumers. Isolate the SKETCH compiler's automatic
 * type-package discovery instead of suppressing declaration checks or changing
 * the lane-owned package script. Explicit SKETCH imports remain fully checked.
 */
export function workspacePhaseArgs(workspace, phase) {
  const args = ['run', '--workspace', workspace.name, phase];
  if (workspace.path === 'packages/sketch' && phase === 'typecheck') {
    return [...args, '--', '--typeRoots', '../../tooling/contract-type-roots'];
  }
  return args;
}

function invoke(command, args, cwd = root, shell = false) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} ${args.join(' ')} failed (exit ${result.status ?? 'signal'})`);
}

export function main(args = process.argv.slice(2)) {
  const nativeOnly = args.includes('--native');
  if (args.some(a => a !== '--native')) throw Error(`unknown argument(s): ${args.join(' ')}`);
  if (nativeOnly) {
    const state = inspectNative();
    if (state.kind === 'not_implemented') {
      console.log(`NATIVE_NOT_IMPLEMENTED: ${state.detail}`);
      return;
    }
    invoke('bash', ['native/ci.sh']);
    console.log('NATIVE_SMOKE_EXECUTED: see native/ci.sh logs; independent STEP/engineering evidence is separate');
    return;
  }

  const workspaces = inspectWorkspaces();
  if (!workspaces.length) console.log('WORKSPACES_NOT_IMPLEMENTED: no app/packages yet; no application, sketch or model tests executed');
  const encountered = new Set();
  for (const workspace of workspaces) {
    console.log(`WORKSPACE ${workspace.lane}: ${workspace.path} (${workspace.name})`);
    if (workspace.lane === 'UNASSIGNED') throw Error(`unowned workspace ${workspace.path}; coordinate a new lane boundary`);
    encountered.add(workspace.lane);
    for (const phase of phases) {
      if (!workspace.scripts[phase]) {
        console.log(`NOT_IMPLEMENTED: ${workspace.path} script ${phase}`);
        continue;
      }
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      invoke(npm, workspacePhaseArgs(workspace, phase), root, process.platform === 'win32');
      console.log(`EXECUTED: ${workspace.path} ${phase}`);
    }
  }
  for (const lane of ['WORKBENCH', 'INTENT', 'SKETCH', 'KERNEL', 'RUNTIME']) {
    if (!encountered.has(lane)) console.log(`LANE_NOT_IMPLEMENTED: ${lane}`);
  }
  console.log('WORKSPACE_GATE_COMPLETE: only listed executed phases are qualified; no implied CAD or graphical acceptance');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('INTEGRATION_GATE_FAILED:', error.message); process.exitCode = 1; }
}
