#!/usr/bin/env node
/**
 * Seal / verify a source-pinned Windows evaluation folder. This is a content
 * and startup-custody check, NOT a CAD B-rep, STEP or Firefox qualification.
 *
 * node evaluation/pack.mjs seal <folder> <40-character-source-commit>
 * node evaluation/pack.mjs verify <folder>
 *
 * Run seal only after npm ci in the staging folder. Windows npm uses workspace
 * junctions; materialize those links before making a portable ZIP archive.
 */
import {
  cpSync, existsSync, lstatSync, readFileSync,
  readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';

const [mode, folder, sourceSha] = process.argv.slice(2);
const base = folder ? resolve(folder) : null;
const manifestName = 'EVALUATION-MANIFEST.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const normalized = path => path.split(sep).join('/');

function materializeWorkspaceLinks() {
  const namespace = join(base, 'node_modules', '@intuit3d');
  if (!existsSync(namespace)) fail('Missing installed @intuit3d workspaces; run npm ci in the staged folder first');
  for (const name of readdirSync(namespace).sort()) {
    const alias = join(namespace, name);
    if (!lstatSync(alias).isSymbolicLink()) continue;
    const target = realpathSync(alias);
    const temp = join(namespace, name + '.evaluation-copy');
    if (existsSync(temp)) fail('Unexpected existing temporary workspace copy ' + temp);
    cpSync(target, temp, { recursive: true, dereference: true, force: false, errorOnExist: true });
    unlinkSync(alias);
    renameSync(temp, alias);
  }
}

function inventory() {
  const entries = {};
  function traverse(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, item.name);
      const path = normalized(relative(base, absolute));
      if (path === manifestName) continue;
      if (item.isSymbolicLink()) fail('Portable ZIP cannot contain symlink: ' + path);
      if (item.isDirectory()) { traverse(absolute); continue; }
      if (!item.isFile()) fail('Unexpected non-file bundle entry: ' + path);
      const bytes = readFileSync(absolute);
      entries[path] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
  }
  traverse(base);
  return Object.fromEntries(Object.entries(entries).sort(([a],[b]) => a.localeCompare(b)));
}

function validateBase() {
  if (!base || !existsSync(base) || !lstatSync(base).isDirectory()) fail('Expected an existing staging directory');
  for (const path of [
    'package.json', 'package-lock.json', 'START-HERE.md', 'Start INTUIT3D.cmd',
    'evaluation/pack.mjs', 'tooling/dev-local.mjs', 'apps/web/package.json',
    'node_modules/vite/bin/vite.js', 'node_modules/@intuit3d/model/package.json'
  ]) if (!existsSync(join(base, path))) fail('Missing bundle component: ' + path);
}

function seal() {
  if (process.platform !== 'win32') fail('Release bundle sealing is Windows-only; do not claim Linux packages are Windows-evaluated');
  if (!/^[0-9a-f]{40}$/.test(sourceSha || '')) fail('Supply the checked-out exact 40-character source commit');
  validateBase();
  if (existsSync(join(base, manifestName))) fail('Already sealed; use verify, not a silent overwrite');
  materializeWorkspaceLinks();
  const files = inventory();
  const manifest = {
    schema: 'intuit3d-evaluation-bundle/v1',
    source: { repository: 'techrote/INTUIT3D', commit: sourceSha },
    target: { platform: process.platform, arch: process.arch, node: process.version },
    provider: 'Default local companion is experimental OCP; no Windows OCCT8 / independent STEP qualification',
    limitations: 'Windows source/startup tests and original Chromium evidence are not Windows Firefox human acceptance',
    lockedDependencies: files['package-lock.json']?.sha256,
    fileCount: Object.keys(files).length,
    files
  };
  writeFileSync(join(base, manifestName), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log('INTUIT3D_EVAL_SEALED source=' + sourceSha + ' files=' + manifest.fileCount +
    ' manifest_sha256=' + sha256(readFileSync(join(base, manifestName))));
}

function verify() {
  validateBase();
  const manifest = JSON.parse(readFileSync(join(base, manifestName), 'utf8'));
  if (manifest.schema !== 'intuit3d-evaluation-bundle/v1') fail('Unknown manifest version');
  if (!/^[0-9a-f]{40}$/.test(manifest.source?.commit || '')) fail('Invalid source identity');
  if (manifest.target?.platform !== process.platform || manifest.target?.arch !== process.arch)
    fail('Bundle was built for a different host platform / architecture');
  const files = inventory();
  const expected = manifest.files;
  if (!expected || Object.keys(files).length !== manifest.fileCount ||
      JSON.stringify(files) !== JSON.stringify(expected))
    fail('Bundle contents differ from sealed source manifest: file missing, changed, or unexpectedly added');
  if (files['package-lock.json'].sha256 !== manifest.lockedDependencies)
    fail('Package lock digest mismatch');
  console.log('INTUIT3D_EVAL_VERIFY_PASS source=' + manifest.source.commit +
    ' files=' + manifest.fileCount);
}

try {
  if (mode !== 'seal' && mode !== 'verify') fail('Usage: node evaluation/pack.mjs seal|verify <folder> [source-sha]');
  validateBase();
  if (mode === 'seal') seal(); else verify();
} catch (error) {
  console.error('INTUIT3D_EVAL_BUNDLE_ERROR: ' + (error?.stack || error));
  process.exitCode = 1;
}
