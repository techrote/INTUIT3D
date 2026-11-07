import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('real SKETCH/INTENT/RUNTIME manifold physical cut-order swap, undo/archive and dimension rebuild',()=>{
  const path=fileURLToPath(new URL('../examples/manifold-cut-resequence.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',path],{
    encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.kind,'real_SKETCH_INTENT_RUNTIME_consumer');
  assert.deepEqual(result.writerOrderBefore,
    ['extrude.manifold','cut.slot','cut.pocket','cut.window']);
  assert.deepEqual(result.writerOrderAfter,
    ['extrude.manifold','cut.pocket','cut.slot','cut.window']);
  assert.equal(result.manifoldDepthMm,15);
  assert.equal(result.unchangedClampDepthMm,4);
  assert.equal(result.undoRedoArchive,'passed');
  assert.equal(result.nativeBrep,'not_executed');
  assert.equal(result.step,'not_executed');
  assert.equal(result.exactAuthority,false);
  assert.ok(result.invalidatedAfterSwap.includes('cut.window'));
});