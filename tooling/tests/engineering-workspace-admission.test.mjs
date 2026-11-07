import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaces, workspacePhaseArgs } from '../check-workspace.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('ENGINEERING is an explicitly reserved local workspace, never an unowned npm CI escape hatch', () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const name = '@intuit3d/engineering', path = 'packages/engineering';
  const manifestPath = join(root, path, 'package.json');
  const hasSource = existsSync(manifestPath);
  const link = lock.packages['node_modules/' + name];
  const pkg = lock.packages[path];
  // npm install --package-lock-only prunes the local symlink and marks
  // a pre-admitted but not-yet-present workspace as extraneous. Both
  // representations are valid before source admission; neither excuses
  // a missing link after packages/engineering is actually introduced.
  if (link === undefined) {
    assert.equal(hasSource, false, 'source-backed engineering may not lack its npm link');
    assert.equal(pkg?.extraneous, true, 'pre-admission lock must be explicitly extraneous');
  } else {
    assert.deepEqual(link, { resolved: path, link: true });
    assert.equal(pkg?.extraneous, undefined);
  }
  assert.equal(pkg?.name, name);
  assert.equal(pkg?.version, '0.1.0');
  assert.deepEqual(pkg?.engines, { node: '>=22' });
  if (hasSource) {
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, lock.packages[path].version);
    assert.deepEqual(pkg.engines, lock.packages[path].engines);
    assert.equal(typeof pkg.scripts.test, 'string');
    const actual = inspectWorkspaces(root).find(w => w.path === path);
    assert.equal(actual?.lane, 'ENGINEERING');
    assert.deepEqual(workspacePhaseArgs(actual, 'test'),
      ['run', '--workspace', name, 'test']);
  }
});

test('new approved ENGINEERING and INTERCHANGE lanes run actual workspace tests when introduced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'intuit3d-engineering-admission-'));
  try {
    for (const [path, name] of [
      ['packages/engineering', '@intuit3d/engineering'],
      ['packages/interchange', '@intuit3d/interchange']
    ]) {
      mkdirSync(join(dir, path), { recursive: true });
      writeFileSync(join(dir, path, 'package.json'),
        JSON.stringify({name, scripts:{test:'node --test test/*.test.mjs'}}));
    }
    const found = inspectWorkspaces(dir);
    assert.deepEqual(found.map(w => [w.path, w.lane]), [
      ['packages/engineering', 'ENGINEERING'],
      ['packages/interchange', 'INTERCHANGE']
    ]);
    for (const workspace of found) {
      assert.deepEqual(workspacePhaseArgs(workspace,'test'),
        ['run','--workspace',workspace.name,'test']);
    }
    mkdirSync(join(dir, 'packages/unsupported'), { recursive: true });
    writeFileSync(join(dir, 'packages/unsupported/package.json'),
      JSON.stringify({name:'@intuit3d/unsupported',scripts:{test:'node --test'}}));
    assert.equal(inspectWorkspaces(dir).find(x=>x.name==='@intuit3d/unsupported').lane,'UNASSIGNED');
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
