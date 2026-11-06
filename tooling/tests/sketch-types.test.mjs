/**
 * Cross-package compile admission for sketch's published v1 declaration.
 * SKETCH deliberately has no package-local typecheck script. Keep this CI-owned
 * consumer check until its lane adopts a package-local equivalent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tsc = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));

test('SKETCH type-contract fixture compiles on real TypeScript 5.8.3', () => {
  const args = [
    tsc, '--noEmit', '--strict', '--target', 'ES2022',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    // Prevent unrelated optional web @types from polluting this SKETCH-only
    // published declaration contract; keep strict lib checking enabled.
    '--typeRoots', 'tooling/contract-type-roots',
    'packages/sketch/test/type-contract.mts',
  ];
  const result = spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,
    ['TypeScript sketch contract failed (fail closed)',result.stdout,result.stderr,
     result.error?.message||''].filter(Boolean).join('\n'));
});
