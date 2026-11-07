/**
 * Real public INTENT/SKETCH/RUNTIME parameter-table example.
 * Run: node --experimental-strip-types packages/model/examples/parameter-table-plate.mjs
 * Semantic + analytic only: native OCCT8 and independent STEP are NOT executed.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import { createWorkflowRuntime } from '@intuit3d/workflow-runtime';
import {
  PARAMETER_TABLE_FORMAT, commitUndoableParameterTableEdit,
  previewParameterTableEdit,
} from '@intuit3d/model/parameter-table';

const runtime = createWorkflowRuntime({
  model, transactions, bindings, dimensions, archive, sketch, discovery,
});
const create = (eventId, feature) => ({ eventId, type: 'feature.create', feature });
const row = (report, id) => report.features.find((entry) => entry.featureId === id);
const literal = (value) => ({ op: 'literal', value, unit: 'mm' });
const ref = (featureId) => ({ op: 'ref', featureId });

export function runParameterTablePlate() {
  let session = transactions.startUndoHistory(
    model.newProject('demo.parameter.table.plate'));
  session = runtime.commit(session, [
    create('create.sketch', { id: 'sketch.plate', kind: 'sketch',
      dependsOn: [], writeTargets: [],
      payload: { sketch: sketch.plateSketchFixture() } }),
    create('create.extrude', { id: 'extrude.plate', kind: 'extrude',
      dependsOn: ['sketch.plate'], writeTargets: ['body.plate'],
      payload: { sourceSketchId: 'sketch.plate', thicknessMm: 8 } }),
    create('create.cut', { id: 'cut.holes', kind: 'cut',
      dependsOn: ['extrude.plate'], writeTargets: ['body.plate'],
      payload: { sourceSketchId: 'sketch.plate', targetBodyId: 'body.plate',
        holeOffsetMm: 16 } }),
    create('create.independent', { id: 'extrude.spacer', kind: 'extrude',
      dependsOn: [], writeTargets: ['body.spacer'],
      payload: { thicknessMm: 3 } }),
    create('create.thickness', { id: 'parameter.thickness', kind: 'parameter',
      dependsOn: [], writeTargets: [], payload: { parameter: {
        name: 'thickness', unit: 'mm', expression: literal(8) } } }),
    create('create.holeoffset', { id: 'parameter.holeoffset', kind: 'parameter',
      dependsOn: [], writeTargets: [], payload: { parameter: {
        name: 'holeOffset', unit: 'mm', expression: literal(16) } } }),
  ]);
  session = runtime.editDimensions(session, {
    format: dimensions.DIMENSION_BATCH_EDIT_FORMAT, version: 1,
    expectedRevision: session.document.revision, admission: 'require_admissible',
    edits: [
      { eventId: 'bind.thickness', featureId: 'extrude.plate',
        field: 'thicknessMm', binding: {
          unit: 'mm', expression: ref('parameter.thickness') } },
      { eventId: 'bind.holeoffset', featureId: 'cut.holes',
        field: 'holeOffsetMm', binding: {
          unit: 'mm', expression: ref('parameter.holeoffset') } },
    ],
  });
  const before = session;
  const request = {
    format: PARAMETER_TABLE_FORMAT, version: 1,
    expectedProjectId: before.document.projectId,
    expectedRevision: before.document.revision,
    admission: 'require_admissible',
    edits: [
      { eventId: 'edit.table.thickness', featureId: 'parameter.thickness',
        name: 'plateThickness', expression: literal(12) },
      { eventId: 'edit.table.holes', featureId: 'parameter.holeoffset',
        name: 'holePitch', expression: literal(20) },
    ],
  };
  const preview = previewParameterTableEdit(before.document, request);
  const edited = commitUndoableParameterTableEdit(before, request);
  const after = runtime.inspect(edited);
  const resolution = bindings.evaluateDimensionBindingPlan(
    model.planProject(edited.document));
  const cut = resolution.featureGates.find((g) => g.featureId === 'cut.holes');
  assert.equal(row(after, 'extrude.plate').thicknessMm, 12);
  assert.equal(cut.resolvedPayload.holeOffsetMm, 20);
  assert.equal(row(after, 'cut.holes').status, 'pending_exact_provider');
  assert.equal(after.exactGeometryAvailable, false);

  const reopened = runtime.reopen(runtime.save(edited));
  const undone = runtime.undo(reopened,
    ['undo.table.holes', 'undo.table.thickness']);
  assert.equal(row(runtime.inspect(undone), 'extrude.plate').thicknessMm, 8);
  const redone = runtime.redo(undone,
    ['redo.table.thickness', 'redo.table.holes']);
  assert.equal(row(runtime.inspect(redone), 'extrude.plate').thicknessMm, 12);
  assert.equal(bindings.evaluateDimensionBindingPlan(
    model.planProject(redone.document)).featureGates
    .find((g) => g.featureId === 'cut.holes').resolvedPayload.holeOffsetMm, 20);

  return {
    previousThicknessMm: 8, nextThicknessMm: 12,
    previousHoleOffsetMm: 16, nextHoleOffsetMm: 20,
    invalidated: preview.invalidation.invalidatedFeatureIds,
    unchanged: preview.invalidation.unchangedReady,
    parameterIds: preview.expressionChangedParameterIds,
    preservedBodyId: model.featuresOf(redone.document)
      .find((f) => f.id === 'cut.holes').payload.targetBodyId,
    reopenUndoRedo: true,
    nativeExact: false, independentSTEP: false,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(runParameterTablePlate(), null, 2) + '\n');
}
