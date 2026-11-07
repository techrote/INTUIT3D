import test from 'node:test';
import assert from 'node:assert/strict';
import {runInspectorDimensionEdit} from '../examples/edit-inspector-dimension.mjs';

test('public RUNTIME+SKETCH consumer applies inspector field edit at parameter source, rebuild-plans and replays',()=>{
  const result=runInspectorDimensionEdit();
  assert.equal(result.projectId,'demo.inspector.plate.holes');
  assert.equal(result.authoritativeSourceId,'parameter.thickness');
  assert.equal(result.initialThicknessMm,8);
  assert.equal(result.editedThicknessMm,12);
  assert.equal(result.replayVerified,true);
  assert.equal(result.sketchStatus,'analytic_profile_only');
  assert.equal(result.cutStatus,'pending_exact_provider');
  assert.equal(result.exactGeometryAvailable,false);
  assert.deepEqual(result.authoredOrder,
    ['sketch.plate','extrude.plate','cut.holes','parameter.thickness']);
  assert.deepEqual(result.evaluationOrder,
    ['sketch.plate','parameter.thickness','extrude.plate','cut.holes']);
  assert.ok(result.invalidatedFeatureIds.includes('extrude.plate'));
  assert.ok(result.invalidatedFeatureIds.includes('cut.holes'));
  assert.ok(result.archiveBytes>0);
});
