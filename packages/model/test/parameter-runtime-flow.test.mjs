import test from 'node:test';
import assert from 'node:assert/strict';
import { runPlateParameterLifecycle } from '../examples/plate-parameter-lifecycle.mjs';

test('real public RUNTIME+SKETCH consumer replays plate, two holes, edited thickness and archive',()=>{
  const result=runPlateParameterLifecycle();
  assert.equal(result.projectId,'demo.plate.holes.retrospective');
  assert.equal(result.sketchStatus,'analytic_profile_only');
  assert.equal(result.extrudeStatus,'preview_only');
  assert.equal(result.cutStatus,'pending_exact_provider');
  assert.equal(result.initialThicknessMm,8);
  assert.equal(result.editedThicknessMm,12);
  assert.deepEqual(result.authoredOrder,
    ['sketch.plate','extrude.plate','cut.holes','parameter.thickness']);
  assert.deepEqual(result.evaluationOrder,
    ['sketch.plate','parameter.thickness','extrude.plate','cut.holes']);
  assert.deepEqual(result.invalidatedFeatureIds,
    ['extrude.plate','cut.holes','parameter.thickness']);
  assert.equal(result.exactGeometryAvailable,false);
  assert.equal(result.replayVerified,true);
  assert.ok(result.archiveBytes>0);
});
