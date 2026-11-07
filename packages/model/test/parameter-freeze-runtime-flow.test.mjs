import test from 'node:test';
import assert from 'node:assert/strict';
import {runFreezeParametricPlate} from '../examples/freeze-parametric-plate.mjs';

test('accepted SKETCH + RUNTIME consumer freezes edited dimension and replays two-hole plate',()=>{
  const result=runFreezeParametricPlate();
  assert.equal(result.frozenThicknessMm,12);
  assert.equal(result.stableBodyId,'body.plate');
  assert.equal(result.parameterRetired,true);
  assert.equal(result.bindingDependencyReleased,true);
  assert.equal(result.sketchStatus,'analytic_profile_only');
  assert.equal(result.extrudeStatus,'preview_only');
  assert.equal(result.cutStatus,'pending_exact_provider');
  assert.equal(result.exactGeometryAvailable,false);
  assert.equal(result.archiveReopened,true);
  assert.equal(result.undoRedo,true);
  assert.ok(result.archiveBytes>0);
});
