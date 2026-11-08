import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ORDERED_CUT_MOVE_FORMAT,ORDERED_CUT_MOVE_VERSION,
  inspectOrderedBodyCutMove,moveOrderedBodyCut}
  from '@intuit3d/feature-ops/ordered-cut-move/v1';

test('public versioned inspector and multi-step move exports exist',()=>{
  assert.equal(ORDERED_CUT_MOVE_FORMAT,'intuit3d.feature-ops.ordered-cut-move');
  assert.equal(ORDERED_CUT_MOVE_VERSION,1);
  assert.equal(typeof inspectOrderedBodyCutMove,'function');
  assert.equal(typeof moveOrderedBodyCut,'function');
});
test('real four-cut manifold drag/drop is one atomic undo with replay and invalid-target refusal',()=>{
  const path=fileURLToPath(new URL('../examples/valve-manifold-cut-drag.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',path],{
    encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.kind,'real_SKETCH_INTENT_RUNTIME_consumer');
  assert.deepEqual(result.writerOrderBefore,
    ['extrude.manifold','cut.slot','cut.pocket','cut.window','cut.vent']);
  assert.deepEqual(result.writerOrderAfter,
    ['extrude.manifold','cut.pocket','cut.window','cut.vent','cut.slot']);
  assert.equal(result.swapSteps,3);
  assert.equal(result.eventCount,8);
  assert.equal(result.manifoldDepthMm,15);
  assert.equal(result.unchangedClampDepthMm,4);
  assert.equal(result.undoRedoArchive,'passed');
  assert.equal(result.invalidSelections,'refused_before_mutation');
  assert.equal(result.nativeBrep,'not_executed');
  assert.equal(result.step,'not_executed');
  assert.equal(result.exactAuthority,false);
  assert.ok(result.invalidated.includes('cut.vent'));
});
