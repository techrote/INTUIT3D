import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ADAPTED_RECIPE_FORMAT,ADAPTED_RECIPE_VERSION,
  inspectAdaptableCutRecipe,applyAdaptedCutRecipe}
  from '../src/adapted-cut-recipe.mjs';
test('stable versioned adapted recipe API',()=>{
  assert.equal(ADAPTED_RECIPE_FORMAT,'intuit3d.feature-ops.adapted-cut-recipe');
  assert.equal(ADAPTED_RECIPE_VERSION,1);
  assert.equal(typeof inspectAdaptableCutRecipe,'function');
  assert.equal(typeof applyAdaptedCutRecipe,'function');
});
test('real SKETCH/INTENT/RUNTIME independent-target mechanical workflow',()=>{
  const file=fileURLToPath(new URL('../examples/adapted-cut-recipe.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const out=JSON.parse(run.stdout);
  assert.equal(out.oneUndoFrame,true);
  assert.equal(out.archiveUndoRedo,true);
  assert.equal(out.negativeSelectionsRefused,16);
  assert.deepEqual(out.bodyActions,
    ['preserve_candidate','rebuild','preserve_candidate']);
  assert.equal(out.exactAuthority,false);
});
