import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  MULTI_TARGET_CUT_RECIPE_FORMAT,MULTI_TARGET_CUT_RECIPE_VERSION,
  inspectMultiTargetCutRecipe,applyMultiTargetCutRecipe,
} from '@intuit3d/feature-ops/multi-target-cut-recipe/v1';
import {runMultiTargetRecipe}
  from '../examples/multi-target-cut-recipe.mjs';

test('versioned multi-target machining inspection and commit exports',()=>{
  assert.equal(MULTI_TARGET_CUT_RECIPE_FORMAT,
    'intuit3d.feature-ops.multi-target-cut-recipe');
  assert.equal(MULTI_TARGET_CUT_RECIPE_VERSION,1);
  assert.equal(typeof inspectMultiTargetCutRecipe,'function');
  assert.equal(typeof applyMultiTargetCutRecipe,'function');
});
test('real multi-body mechanical recipe transaction preserves source, undo and archive',()=>{
  const x=runMultiTargetRecipe();
  assert.equal(x.kind,'real_INTENT_SKETCH_RUNTIME_multi_target_recipe');
  assert.equal(x.oneUndoFrame,true);
  assert.equal(x.events,4);
  assert.deepEqual(x.targetModes,['copy','adapt']);
  assert.deepEqual(x.copiedCuts,[
    ['cut.backer.relief.batch','cut.backer.bore.batch'],
    ['cut.shim.relief.batch','cut.shim.bore.batch']]);
  assert.ok(x.negativeSelectionsRefused>=14);
  assert.equal(x.sourceTailPreserved,true);
  assert.deepEqual(x.bodyActions,['preserve_candidate','rebuild','rebuild']);
  assert.ok(x.crossBodyInvalidation.includes('cut.backer.bore.batch'));
  assert.ok(x.crossBodyInvalidation.includes('cut.shim.bore.batch'));
  assert.ok(!x.crossBodyInvalidation.includes('cut.guard.bore'));
  for(const f of ['cut.guard.relief','cut.backer.relief.batch',
    'cut.shim.relief.batch'])
    assert.ok(x.sharedProfileInvalidation.includes(f));
  assert.equal(x.archiveUndoRedo,true);
  assert.equal(x.guardThicknessMm,14);
  assert.equal(x.exactAuthority,false);
  assert.equal(x.nativeSTEP,'not_executed');
});
test('public example executes with accepted installed package exports',()=>{
  const file=fileURLToPath(new URL(
    '../examples/multi-target-cut-recipe.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const output=JSON.parse(run.stdout);
  assert.equal(output.oneUndoFrame,true);
  assert.equal(output.events,4);
});
