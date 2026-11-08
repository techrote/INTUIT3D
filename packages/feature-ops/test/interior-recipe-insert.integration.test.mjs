import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  INTERIOR_RECIPE_INSERT_FORMAT,INTERIOR_RECIPE_INSERT_VERSION,
  inspectInteriorRecipeInsertion,applyInteriorRecipeInsertion,
} from '@intuit3d/feature-ops/interior-recipe-insert/v1';
import {runInteriorRecipeInsertion}
  from '../examples/interior-recipe-insert.mjs';

test('versioned browser-consumable interior insertion surface is exported',()=>{
  assert.equal(INTERIOR_RECIPE_INSERT_FORMAT,
    'intuit3d.feature-ops.interior-recipe-insert');
  assert.equal(INTERIOR_RECIPE_INSERT_VERSION,1);
  assert.equal(typeof inspectInteriorRecipeInsertion,'function');
  assert.equal(typeof applyInteriorRecipeInsertion,'function');
});
test('real dependent rail insertion remains atomic, archival and source-preserving',()=>{
  const result=runInteriorRecipeInsertion();
  assert.equal(result.kind,'real_SKETCH_INTENT_RUNTIME_interior_recipe_insertion');
  assert.equal(result.sourceBody,'body.guard');
  assert.equal(result.targetBody,'body.backer');
  assert.deepEqual(result.targetWriterOrder,[
    'extrude.backer','cut.backer.pilot',
    'cut.backer.relief.insert','cut.backer.bore.insert','cut.backer.finish']);
  assert.deepEqual(result.insertedCuts,[
    'cut.backer.relief.insert','cut.backer.bore.insert']);
  assert.equal(result.oneUndoFrame,true);
  assert.ok(result.events>=4&&result.events<=5);
  assert.ok(result.negativeSelectionsRefused>=19);
  assert.deepEqual(result.bodyActions,
    ['preserve_candidate','rebuild','preserve_candidate']);
  assert.equal(result.sourceTailPreserved,true);
  assert.equal(result.archiveUndoRedo,true);
  assert.ok(result.retrospectiveSourceInvalidation.includes('cut.guard.relief'));
  assert.ok(result.retrospectiveSourceInvalidation.includes('cut.backer.relief.insert'));
  assert.equal(result.exactAuthority,false);
  assert.equal(result.nativeSTEP,'not_executed');
});
test('public example runs in a clean Node process through package exports',()=>{
  const file=fileURLToPath(new URL('../examples/interior-recipe-insert.mjs',import.meta.url));
  const result=spawnSync(process.execPath,['--experimental-strip-types',file],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(result.status,0,
    result.stderr||result.stdout||String(result.error));
  const data=JSON.parse(result.stdout);
  assert.equal(data.oneUndoFrame,true);
  assert.equal(data.insertedCuts.length,2);
});
