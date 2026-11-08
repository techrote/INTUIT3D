import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  CUT_RECIPE_COPY_FORMAT,CUT_RECIPE_COPY_VERSION,
  inspectCutRecipeCopy,copyCutRecipeToBody,
} from '@intuit3d/feature-ops/cut-recipe-copy/v1';
import {runCutRecipeCopy} from '../examples/cut-recipe-copy.mjs';

test('versioned mechanical recipe inspector and one-gesture commit are exported',()=>{
  assert.equal(CUT_RECIPE_COPY_FORMAT,'intuit3d.feature-ops.cut-recipe-copy');
  assert.equal(CUT_RECIPE_COPY_VERSION,1);
  assert.equal(typeof inspectCutRecipeCopy,'function');
  assert.equal(typeof copyCutRecipeToBody,'function');
});
test('real guard/backer: distinct cuts, explicit bodies, one undo, negative fences and shared-SKETCH invalidation',()=>{
  const result=runCutRecipeCopy();
  assert.equal(result.kind,'real_INTENT_SKETCH_RUNTIME_mechanical_consumer');
  assert.deepEqual(result.sourceCutIds,['cut.guard.relief','cut.guard.port']);
  assert.deepEqual(result.copiedCutIds,
    ['cut.backer.relief.copy','cut.backer.port.copy']);
  assert.deepEqual(result.copiedExtents,
    [{kind:'blind',depthMm:3},{kind:'through_all'}]);
  assert.deepEqual(result.copiedStatuses,
    ['pending_exact_provider','blocked_dependency']);
  assert.equal(result.authoringEvents,2);
  assert.equal(result.oneUndoFrame,true);
  assert.deepEqual(result.bodyActions,
    ['preserve_candidate','rebuild','preserve_candidate']);
  assert.ok(result.sharedSketchAffects.includes('cut.guard.port'));
  assert.ok(result.sharedSketchAffects.includes('cut.backer.port.copy'));
  assert.ok(!result.sharedSketchAffects.includes('extrude.shim'));
  assert.equal(result.guardThicknessMm,14);
  assert.equal(result.independentShimThicknessMm,3);
  assert.equal(result.negativeSelectionsRefused,15);
  assert.equal(result.sourceBlockNonTerminal,true);
  assert.equal(result.sourceTailPreserved,true);
  assert.equal(result.archiveUndoRedo,true);
  assert.equal(result.exactAuthority,false);
  assert.equal(result.nativeSTEP,'not_executed');
});
test('public executable example uses installed accepted consumer exports',()=>{
  const file=fileURLToPath(new URL('../examples/cut-recipe-copy.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  assert.equal(JSON.parse(run.stdout).oneUndoFrame,true);
});