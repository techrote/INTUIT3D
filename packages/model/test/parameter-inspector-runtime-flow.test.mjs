import test from 'node:test';
import assert from 'node:assert/strict';
import {runParameterInspectorPlate} from '../examples/parameter-inspector-plate.mjs';

test('public INTENT/SKETCH/RUNTIME plate inspector renames and edits 8→12, undo and archive',()=>{
  const r=runParameterInspectorPlate();
  assert.equal(r.beforeThicknessMm,8);
  assert.equal(r.afterThicknessMm,12);
  assert.equal(r.parameterLabel,'plateThickness');
  assert.equal(r.retainedParameterId,'parameter.thickness');
  assert.deepEqual(r.invalidated,
    ['extrude.plate','cut.holes','parameter.thickness']);
  assert.equal(r.unaffectedSketch,'analytic_profile_only');
  assert.equal(r.cutStatus,'pending_exact_provider');
  assert.equal(r.reopened,true);
  assert.equal(r.undoRedo,true);
  assert.equal(r.exactGeometryAvailable,false);
  assert.equal(r.independentInteroperability,false);
});
