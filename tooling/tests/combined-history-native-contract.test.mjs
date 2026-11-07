/**
 * Accepted-main cross-lane product contract:
 * deliberate authored timeline move -> atomic real SKETCH edit -> semantic
 * cut invalidation -> undo/redo -> archive -> native plate-v1 request.
 *
 * This is an executable no-native regression. Native/BRep/STEP and actual
 * Chromium have separate explicitly named, already-running acceptance gates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import {moveHistoryFeature} from '@intuit3d/model/history-move';
import {expectedPlateMetrics} from '@intuit3d/kernel-contract/plate-v1';
import {
  runtime,newPlateHistory,plateRequestFromHistory,editPlateThickness,
} from '../model-native-plate.mjs';

const cutState = history =>
  runtime.inspect(history).features.find(f => f.featureId === 'cut');
const holeRadii = history =>
  plateRequestFromHistory(history).request.plate.holes.map(h => h.radius);

test('one durable history: reorder, batch-edit real hole constraints, undo/reopen, rebuild request', () => {
  const original=newPlateHistory();
  const originalRequest=plateRequestFromHistory(original).request;
  assert.deepEqual(holeRadii(original),[6,6]);
  assert.equal(cutState(original).status,'pending_exact_provider');

  const moved=moveHistoryFeature(original,{
    eventId:'integration.move.cut',
    featureId:'cut',afterFeatureId:'parameter.t',
    expectedProjectId:original.document.projectId,
    expectedRevision:original.document.revision,
  });
  assert.deepEqual(moved.plan.authoredOrder,
    ['sketch.plate','plate','parameter.t','cut']);
  assert.deepEqual(moved.structuralInvalidation.changedFeatureIds,[]);
  assert.deepEqual(moved.structuralInvalidation.invalidatedFeatureIds,[]);
  assert.deepEqual(plateRequestFromHistory(moved.history).request.plate,
    originalRequest.plate);
  assert.deepEqual(model.featuresOf(moved.history.document).map(f=>f.id),
    ['sketch.plate','plate','parameter.t','cut']);

  const edited=runtime.editSketchConstraints(moved.history,{
    sketchFeatureId:'sketch.plate',
    eventId:'integration.edit.holes',
    expectedRevision:moved.history.document.revision,
    admission:'require_admissible',
    edits:[
      {constraintId:'holeA:diameter',patch:{value:5}},
      {constraintId:'holeB:diameter',patch:{value:5}},
    ],
  });
  assert.equal(edited.kind,'committed',JSON.stringify(edited));
  assert.equal(edited.history.document.revision,moved.history.document.revision+1);
  assert.equal(edited.sketchStatus,'analytic_profile_only');
  assert.equal(edited.report.exactGeometryAvailable,false);
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('plate'));
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('cut'));
  assert.deepEqual(holeRadii(edited.history),[5,5]);
  assert.equal(cutState(edited.history).status,'pending_exact_provider');
  assert.ok(expectedPlateMetrics(plateRequestFromHistory(edited.history).request.plate).volumeMm3 >
    expectedPlateMetrics(originalRequest.plate).volumeMm3);

  const saved=runtime.save(edited.history);
  const reopened=runtime.reopen(saved);
  assert.equal(runtime.save(reopened),saved);
  assert.deepEqual(holeRadii(reopened),[5,5]);
  assert.deepEqual(runtime.inspect(reopened).authoredOrder,
    ['sketch.plate','plate','parameter.t','cut']);
  const undone=runtime.undo(reopened,['integration.undo.holes']);
  assert.deepEqual(holeRadii(undone),[6,6]);
  const redone=runtime.redo(undone,['integration.redo.holes']);
  assert.deepEqual(holeRadii(redone),[5,5]);

  const thicker=editPlateThickness(redone,12);
  const revisedRequest=plateRequestFromHistory(thicker).request;
  assert.equal(revisedRequest.plate.thickness,12);
  assert.deepEqual(revisedRequest.plate.holes.map(h=>h.radius),[5,5]);
  assert.ok(runtime.diff(redone,thicker).invalidatedFeatureIds.includes('cut'));
  assert.equal(cutState(thicker).status,'pending_exact_provider');
  assert.equal(runtime.inspect(thicker).exactGeometryAvailable,false);
  assert.deepEqual(plateRequestFromHistory(runtime.reopen(runtime.save(thicker))).request.plate,
    revisedRequest.plate);
});

test('inadmissible sketch cannot be silently promoted to a native cut/STEP request',()=>{
  const history=newPlateHistory();
  const before=runtime.save(history);
  const refused=runtime.editSketchConstraints(history,{
    sketchFeatureId:'sketch.plate',eventId:'integration.refuse.width',
    expectedRevision:history.document.revision,
    admission:'require_admissible',
    edits:[{constraintId:'width',patch:{value:90}}],
  });
  assert.equal(refused.kind,'refused',JSON.stringify(refused));
  assert.equal(refused.notCommitted,true);
  assert.equal(runtime.save(history),before);
  assert.deepEqual(holeRadii(history),[6,6]);

  const unresolved=runtime.editSketchConstraints(history,{
    sketchFeatureId:'sketch.plate',eventId:'integration.keep.invalid',
    expectedRevision:history.document.revision,
    admission:'preserve_unresolved',
    edits:[{constraintId:'width',patch:{value:90}}],
  });
  assert.equal(unresolved.kind,'committed');
  assert.equal(unresolved.sketchStatus,'invalid_profile');
  assert.equal(cutState(unresolved.history).status,'blocked_dependency');
  assert.throws(()=>plateRequestFromHistory(unresolved.history),
    /no current admitted plate preview/);
  const recovered=runtime.editSketchConstraints(unresolved.history,{
    sketchFeatureId:'sketch.plate',eventId:'integration.repair.width',
    expectedRevision:unresolved.history.document.revision,
    admission:'require_admissible',
    edits:[{constraintId:'width',patch:{value:120}}],
  });
  assert.equal(recovered.kind,'committed',JSON.stringify(recovered));
  assert.deepEqual(holeRadii(recovered.history),[6,6]);
  assert.equal(cutState(recovered.history).status,'pending_exact_provider');
});
