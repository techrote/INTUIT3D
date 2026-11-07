import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaces, workspacePhaseArgs } from '../check-workspace.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const proposed = [
  ['KERNEL', '@intuit3d/kernel-contract', 'packages/kernel-contract', '>=22'],
  ['RUNTIME', '@intuit3d/workflow-runtime', 'packages/workflow-runtime', '>=22.6.0'],
];

test('new workspace reservations are exact local links with pinned package identity', () => {
  assert.deepEqual(lock.packages[''].workspaces, ['apps/*', 'packages/*']);
  for (const [, name, path, nodeVersion] of proposed) {
    assert.deepEqual(lock.packages['node_modules/' + name],
      { resolved: path, link: true }, name + ' must remain a local workspace');
    const pkg = lock.packages[path];
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.engines.node, nodeVersion);
    assert.equal(Object.hasOwn(pkg, 'resolved'), false);
    // Before feature PR admission, pre-registration is explicitly allowed.
    // After admission, a mismatch must fail rather than silently installing a stale contract.
    const manifestPath = join(root, path, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.name, pkg.name);
      assert.equal(manifest.version, pkg.version);
      assert.deepEqual(manifest.engines, pkg.engines);
      assert.deepEqual(manifest.peerDependencies ?? {}, pkg.peerDependencies ?? {});
    }
  }
  assert.deepEqual(lock.packages['packages/workflow-runtime'].peerDependencies,
    {'@intuit3d/model': '0.1.0', '@intuit3d/sketch': '0.1.0'});
});

test('KERNEL and RUNTIME are owned executable workspaces and retain exact phase routing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'intuit3d-workspace-admission-'));
  try {
    for (const [, name, path] of proposed) {
      mkdirSync(join(dir, path), {recursive: true});
      writeFileSync(join(dir, path, 'package.json'),
        JSON.stringify({name, scripts: {test: 'node --test test/*.test.mjs', typecheck: 'tsc --noEmit'}}));
    }
    const found = inspectWorkspaces(dir);
    assert.deepEqual(found.map(x => [x.lane, x.name]), [
      ['KERNEL', '@intuit3d/kernel-contract'], ['RUNTIME', '@intuit3d/workflow-runtime'],
    ]);
    for (const workspace of found) {
      for (const phase of ['test', 'typecheck']) {
        assert.deepEqual(workspacePhaseArgs(workspace, phase),
          ['run', '--workspace', workspace.name, phase]);
      }
    }
    mkdirSync(join(dir, 'packages/unsanctioned'), {recursive:true});
    writeFileSync(join(dir, 'packages/unsanctioned/package.json'),
      JSON.stringify({name:'@intuit3d/unowned', scripts:{test:'node --test'}}));
    assert.equal(inspectWorkspaces(dir).find(w => w.name === '@intuit3d/unowned').lane, 'UNASSIGNED');
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
});

test('runtime admission cannot silently replace actual tests with placeholders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'intuit3d-runtime-noop-'));
  try {
    mkdirSync(join(dir, 'packages/workflow-runtime'), {recursive:true});
    const manifest = join(dir, 'packages/workflow-runtime/package.json');
    writeFileSync(manifest, JSON.stringify({name:'@intuit3d/workflow-runtime',scripts:{test:'echo ok'}}));
    assert.throws(() => inspectWorkspaces(dir), /no-op\/placeholder/);
    writeFileSync(manifest, JSON.stringify({name:'@intuit3d/workflow-runtime',scripts:{test:'node --test'}}));
    assert.equal(inspectWorkspaces(dir)[0].lane, 'RUNTIME');
  } finally {
    rmSync(dir, {recursive:true,force:true});
  }
});
