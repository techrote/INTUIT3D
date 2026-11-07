import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { inspectWorkspaces, workspacePhaseArgs } from '../check-workspace.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('FEATUREOPS is a source-backed, local-only, version-pinned workspace', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'packages/feature-ops/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const path = 'packages/feature-ops';
  assert.deepEqual(lock.packages['node_modules/@intuit3d/feature-ops'],
    { resolved: path, link: true });
  assert.equal(lock.packages[path].name, '@intuit3d/feature-ops');
  assert.equal(lock.packages[path].version, manifest.version);
  assert.deepEqual(lock.packages[path].peerDependencies, manifest.peerDependencies);
  assert.equal(lock.packages[path].engines.node, manifest.engines.node);
  const workspace = inspectWorkspaces(root).find(w => w.path === path);
  assert.ok(workspace, 'FEATUREOPS is discoverable and source-backed');
  assert.equal(workspace.lane, 'FEATUREOPS');
  assert.equal(workspace.name, manifest.name);
  assert.deepEqual(workspacePhaseArgs(workspace,'test'),
    ['run','--workspace',manifest.name,'test']);
  assert.ok(manifest.scripts.test.includes('node'), 'real test command required');
});
