import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CUT_BLOCK_PLACEMENT_FORMAT,CUT_BLOCK_PLACEMENT_VERSION,
  inspectCutBlockPlacement,moveCutBlock}
  from '@intuit3d/feature-ops/cut-block-placement/v1';

test('versioned browser-consumable cut block inspect/drag API is exported',()=>{
  assert.equal(CUT_BLOCK_PLACEMENT_FORMAT,'intuit3d.feature-ops.cut-block-placement');
  assert.equal(CUT_BLOCK_PLACEMENT_VERSION,1);
  assert.equal(typeof inspectCutBlockPlacement,'function');
  assert.equal(typeof moveCutBlock,'function');
});
test('real servo assembly: 2-cut atomic reorder, cross-body invalidation, archive, undo, retrospective dimensions and negatives',()=>{
  const path=fileURLToPath(new URL('../examples/servo-block-placement.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',path],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.kind,'real_SKETCH_INTENT_RUNTIME_consumer');
  assert.deepEqual(result.movedCutIds,['cut.shaft','cut.counterbore']);
  assert.deepEqual(result.writerOrderBefore,[
    'extrude.mount','cut.mount','cut.shaft','cut.counterbore',
    'cut.cable','cut.relief']);
  assert.deepEqual(result.writerOrderAfter,[
    'extrude.mount','cut.mount','cut.cable','cut.relief',
    'cut.shaft','cut.counterbore']);
  assert.equal(result.eventCount,2);
  assert.equal(result.oneUndoFrame,true);
  assert.equal(result.invalidSelections,'refused_before_mutation');
  assert.deepEqual(result.invalidatedBodyIds,['body.mount','body.bracket']);
  assert.deepEqual(result.bodyActions,['rebuild','rebuild','preserve_candidate']);
  assert.deepEqual(result.retrospectiveRebuild,['rebuild','rebuild','preserve_candidate']);
  assert.equal(result.archiveUndoRedo,true);
  assert.equal(result.nativeSTEP,'not_executed');
  assert.equal(result.exactGeometryAuthority,false);
});
