import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectNative, inspectWorkspaces } from '../check-workspace.mjs';

function withRepo(action) {
  const dir = mkdtempSync(join(tmpdir(), 'intuit3d-check-'));
  try { action(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function workspace(dir, relative, pkg) {
  const subdir = join(dir, relative);
  mkdirSync(subdir, { recursive: true });
  if (pkg !== undefined) writeFileSync(join(subdir, 'package.json'), JSON.stringify(pkg));
}

test('empty repository has no implied workspaces or native validation', () => withRepo(dir => {
  assert.deepEqual(inspectWorkspaces(dir), []);
  assert.equal(inspectNative(dir).kind, 'not_implemented');
}));

test('workspace detection requires a real test script and unique package identity', () => withRepo(dir => {
  workspace(dir, 'apps/web', { name: '@intuit3d/web', scripts: { test: 'node --test' } });
  workspace(dir, 'packages/model', { name: '@intuit3d/model', scripts: { test: 'node --test' } });
  assert.deepEqual(inspectWorkspaces(dir).map(x => x.lane), ['WORKBENCH', 'INTENT']);
  workspace(dir, 'packages/sketch', { name: '@intuit3d/model', scripts: { test: 'node --test' } });
  assert.throws(() => inspectWorkspaces(dir), /duplicate/);
}));

test('missing and fake tests fail closed', () => withRepo(dir => {
  workspace(dir, 'apps/web');
  assert.throws(() => inspectWorkspaces(dir), /no package.json/);
  workspace(dir, 'apps/web', { name: '@intuit3d/web', scripts: {} });
  assert.throws(() => inspectWorkspaces(dir), /test.*required/);
  workspace(dir, 'apps/web', { name: '@intuit3d/web', scripts: { test: 'echo no tests' } });
  assert.throws(() => inspectWorkspaces(dir), /no-op/);
}));

test('native code requires an executable smoke entrypoint; never silently skips it', () => withRepo(dir => {
  mkdirSync(join(dir, 'native'));
  assert.throws(() => inspectNative(dir), /native\/ci.sh/);
  writeFileSync(join(dir, 'native', 'ci.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  assert.equal(inspectNative(dir).kind, 'ready');
}));
