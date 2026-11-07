import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, featuresOf, planProject, ProjectRevisionError,
  ProjectFormatError, serializeProject,
} from '../src/index.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import {
  PARAMETER_TABLE_FORMAT, PARAMETER_TABLE_VERSION,
  previewParameterTableEdit, commitUndoableParameterTableEdit,
} from '../src/parameter-table.ts';
import { runParameterTablePlate } from '../examples/parameter-table-plate.mjs';

const lit = (value, unit = 'mm') => ({ op: 'literal', value, unit });
const ref = (featureId) => ({ op: 'ref', featureId });
const param = (id, name, expression = lit(8), deps = []) => ({
  id, kind: 'parameter', dependsOn: deps, writeTargets: [],
  payload: { parameter: { name, unit: 'mm', expression } },
});
const make = (eventId, feature) => ({ eventId, type: 'feature.create', feature });
function fixture() {
  let history = startUndoHistory(newProject('project.table'));
  history = commitUndoableTransaction(history, [
    make('create.s', { id: 'sketch', kind: 'sketch', dependsOn: [],
      writeTargets: [], payload: {} }),
    make('create.e', { id: 'extrude', kind: 'extrude',
      dependsOn: ['sketch', 'pa'], writeTargets: ['body.plate'],
      payload: { thicknessMm: 8,
        dimensionBindings: { format: 'intuit3d.dimension-bindings',
          version: 1, entries: [{ field: 'thicknessMm', unit: 'mm',
            expression: ref('pa') }] } } }),
    make('create.c', { id: 'cut', kind: 'cut',
      dependsOn: ['extrude', 'pb'], writeTargets: ['body.plate'],
      payload: { holeOffsetMm: 16, dimensionBindings: {
        format: 'intuit3d.dimension-bindings', version: 1,
        entries: [{ field: 'holeOffsetMm', unit: 'mm',
          expression: ref('pb') }] } } }),
    make('create.spacer', { id: 'spacer', kind: 'extrude',
      dependsOn: [], writeTargets: ['body.spacer'],
      payload: { thicknessMm: 3 } }),
    make('create.pa', param('pa', 'thickness')),
    make('create.pb', param('pb', 'holeOffset', lit(16))),
  ]);
  return history;
}
const row = (doc, id) => featuresOf(doc).find((feature) => feature.id === id);
const gate = (doc, id) => evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find((entry) => entry.featureId === id);
const request = (doc, edits, admission = 'require_admissible') => ({
  format: PARAMETER_TABLE_FORMAT, version: PARAMETER_TABLE_VERSION,
  expectedProjectId: doc.projectId, expectedRevision: doc.revision,
  admission, edits,
});
const edit = (eventId, featureId, name, expression) => ({
  eventId, featureId, name, ...(expression === undefined ? {} : { expression }),
});

test('two-row parameter edit atomically rebuilds plate and holes, not spacer; archive, undo/redo', () => {
  const old = fixture();
  const req = request(old.document, [
    edit('edit.a', 'pa', 'plateThickness', lit(12)),
    edit('edit.b', 'pb', 'holePitch', lit(20)),
  ]);
  const frozen = serializeProject(old.document);
  const preview = previewParameterTableEdit(old.document, req);
  assert.equal(preview.document.revision, old.document.revision + 2);
  assert.deepEqual(preview.renamedParameterIds, ['pa','pb']);
  assert.deepEqual(preview.expressionChangedParameterIds, ['pa','pb']);
  assert.equal(preview.exactGeometryAuthority, false);
  assert.equal(gate(preview.document, 'extrude').resolvedPayload.thicknessMm, 12);
  assert.equal(gate(preview.document, 'cut').resolvedPayload.holeOffsetMm, 20);
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('extrude'));
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('cut'));
  assert.ok(preview.invalidation.unchangedReady.includes('spacer'));
  assert.equal(serializeProject(old.document), frozen);
  const changed = commitUndoableParameterTableEdit(old, req);
  assert.equal(changed.undoStack.length, old.undoStack.length + 1);
  assert.equal(changed.undoStack.at(-1).length, 2);
  const reopened = deserializeModelArchive(
    serializeModelArchive(createModelArchive(changed))).history;
  assert.equal(row(reopened.document, 'pa').payload.parameter.name, 'plateThickness');
  const undo = undoTransaction(reopened, ['undo.pb','undo.pa']);
  assert.equal(gate(undo.document, 'extrude').resolvedPayload.thicknessMm, 8);
  assert.equal(gate(undo.document, 'cut').resolvedPayload.holeOffsetMm, 16);
  const redo = redoTransaction(undo, ['redo.pa','redo.pb']);
  assert.equal(gate(redo.document, 'extrude').resolvedPayload.thicknessMm, 12);
  assert.equal(row(redo.document, 'cut').writeTargets[0], 'body.plate');
  assert.equal(row(redo.document, 'pa').id, 'pa');
});

test('simultaneous parameter display-name swap keeps stable reference IDs', () => {
  const h = fixture();
  const p = previewParameterTableEdit(h.document, request(h.document, [
    edit('swap.a', 'pa', 'holeOffset'),
    edit('swap.b', 'pb', 'thickness'),
  ]));
  assert.equal(row(p.document, 'pa').payload.parameter.name, 'holeOffset');
  assert.equal(row(p.document, 'pb').payload.parameter.name, 'thickness');
  assert.equal(gate(p.document, 'extrude').resolvedPayload.thicknessMm, 8);
  assert.equal(gate(p.document, 'cut').resolvedPayload.holeOffsetMm, 16);
  assert.deepEqual(p.expressionChangedParameterIds, []);
});

test('strict admission evaluates all final expressions, not transient rows', () => {
  const h = fixture();
  const req = request(h.document, [
    edit('expr.a', 'pa', 'thickness', ref('pb')),
    edit('expr.b', 'pb', 'holeOffset', lit(12)),
  ]);
  const p = previewParameterTableEdit(h.document, req);
  assert.equal(gate(p.document, 'extrude').resolvedPayload.thicknessMm, 12);
  assert.equal(gate(p.document, 'cut').resolvedPayload.holeOffsetMm, 12);
  assert.deepEqual(row(p.document, 'pa').dependsOn, ['pb']);
});

test('strict mode refuses unresolved final dependencies, permissive retains null gates', () => {
  const h = fixture();
  const req = request(h.document, [
    edit('future.a', 'pa', 'futureThickness', ref('future.parameter')),
    edit('future.b', 'pb', 'holeOffset', lit(20)),
  ]);
  assert.throws(() => previewParameterTableEdit(h.document, req), ProjectFormatError);
  const staged = previewParameterTableEdit(h.document,
    { ...req, admission: 'permit_unresolved' });
  assert.equal(gate(staged.document, 'extrude').status, 'unready');
  assert.equal(gate(staged.document, 'extrude').resolvedPayload, null);
  assert.equal(gate(staged.document, 'cut').status, 'unready');
  assert.equal(gate(staged.document, 'cut').resolvedPayload, null);
});

test('bad later row, event reuse, duplicate names and malformed requests are atomic', () => {
  const history = fixture(), doc = history.document;
  const original = JSON.stringify(history);
  const valid = edit('edit.valid','pa','plateThickness',lit(12));
  for (const edits of [
    [valid, edit('edit.invalid','pb','holeOffset', {op:'ref',featureId:'cut'})],
    [valid, edit('edit.duplicate','pb','plateThickness',lit(18))],
    [valid, edit('edit.valid','pb','newHoleOffset',lit(20))],
    [valid, edit('edit.other','pa','anotherName',lit(20))],
    [valid, edit('edit.bad','pb','invalid name',lit(20))],
    [valid, edit('create.pb','pb','newName',lit(20))],
  ]) assert.throws(() => commitUndoableParameterTableEdit(history,
    request(doc, edits)), ProjectFormatError);
  for (const broken of [
    { ...request(doc,[valid]), version:2 },
    { ...request(doc,[valid]), expectedProjectId:'other.project' },
    { ...request(doc,[valid]), expectedRevision: doc.revision - 1 },
    { ...request(doc,[valid]), unexpected:true },
    request(doc,[]),
    request(doc,[edit('noop','pa','thickness')]),
    request(doc,[{...valid, extra:true}]),
  ]) assert.throws(() => previewParameterTableEdit(doc, broken));
  assert.equal(JSON.stringify(history), original);
  assert.throws(() => previewParameterTableEdit(doc,
    {...request(doc,[valid]),expectedRevision:doc.revision-1}),ProjectRevisionError);
});

test('public INTENT/SKETCH/RUNTIME example edits named table, reopens and replays', () => {
  const r = runParameterTablePlate();
  assert.equal(r.previousThicknessMm, 8);
  assert.equal(r.nextThicknessMm, 12);
  assert.equal(r.previousHoleOffsetMm, 16);
  assert.equal(r.nextHoleOffsetMm, 20);
  assert.equal(r.preservedBodyId, 'body.plate');
  assert.equal(r.reopenUndoRedo, true);
  assert.equal(r.nativeExact, false);
  assert.equal(r.independentSTEP, false);
});
