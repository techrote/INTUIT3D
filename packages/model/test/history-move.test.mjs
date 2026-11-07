import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, deserializeProject, featuresOf, newProject, planProject,
  ProjectFormatError, ProjectRevisionError, serializeProject, featureTimelineOf,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import {
  moveHistoryFeature, HISTORY_MOVE_FORMAT, HISTORY_MOVE_VERSION,
} from '../src/history-move.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import { evaluateParameterPlan } from '../src/parameters.ts';

const feature = (id, kind = 'sketch', deps = [], writes = [], payload = {}) =>
  ({ id, kind, dependsOn: deps, writeTargets: writes, payload });
const create = (id, kind, deps = [], writes = [], payload = {}) =>
  ({ eventId: 'event.create.' + id, type: 'feature.create',
     feature: feature(id, kind, deps, writes, payload) });
const order = doc => planProject(doc).authoredOrder;
const request = (history, eventId, featureId, afterFeatureId) => ({
  eventId, featureId, afterFeatureId,
  expectedProjectId: history.document.projectId,
  expectedRevision: history.document.revision,
});
function plate() {
  let doc = newProject('project.history.move');
  doc = commitEvent(doc, create('parameter.depth', 'parameter', [], [], { parameter: {
    name: 'depth', unit: 'mm', expression: { op: 'literal', value: 8, unit: 'mm' },
  } }));
  doc = commitEvent(doc, create('feature.sketch', 'sketch', [], ['sketch.plate'], { holes: 2 }));
  // The cut is deliberately authored before the extrude: intent remains valid.
  doc = commitEvent(doc, create('feature.cut', 'cut', ['feature.extrude'], ['body.plate']));
  doc = commitEvent(doc, create('feature.extrude', 'extrude',
    ['feature.sketch', 'parameter.depth'], ['body.plate']));
  doc = commitEvent(doc, create('feature.label', 'annotation', [], ['annotation.title']));
  return doc;
}

test('moving authored cut after extrude preserves dependency evaluation and requires no geometry rebuild', () => {
  const before = plate();
  assert.equal(evaluateParameterPlan(planProject(before)).featureGates.find(
    gate => gate.featureId === 'parameter.depth').status,'admissible');
  const session = startUndoHistory(before);
  const moved = moveHistoryFeature(session,
    request(session, 'event.move.cut', 'feature.cut', 'feature.extrude'));
  assert.equal(moved.format, HISTORY_MOVE_FORMAT);
  assert.equal(moved.version, HISTORY_MOVE_VERSION);
  assert.equal(moved.fromIndex, 2);
  assert.equal(moved.toIndex, 3);
  assert.deepEqual(moved.shiftedFeatureIds, ['feature.extrude', 'feature.cut']);
  assert.deepEqual(order(moved.history.document), [
    'parameter.depth', 'feature.sketch', 'feature.extrude', 'feature.cut', 'feature.label',
  ]);
  assert.deepEqual(planProject(before).executableOrder, moved.plan.executableOrder);
  assert.deepEqual(moved.structuralInvalidation.changedFeatureIds, []);
  assert.deepEqual(moved.structuralInvalidation.readyToEvaluate, []);
  assert.deepEqual(moved.structuralInvalidation.invalidatedFeatureIds, []);
  assert.deepEqual(featuresOf(moved.history.document).find(f => f.id === 'feature.cut').writeTargets,
    ['body.plate']);
  assert.deepEqual(planIncrementalEvaluation(before, moved.history.document).unchangedReady,
    moved.plan.executableOrder);
  assert.deepEqual(order(before), [
    'parameter.depth', 'feature.sketch', 'feature.cut', 'feature.extrude', 'feature.label',
  ]);
});

test('independent timeline move changes evaluation tie-break without reattesting exact geometry', () => {
  const before = plate();
  const result = moveHistoryFeature(startUndoHistory(before), {
    eventId: 'event.label.first', featureId: 'feature.label',
    afterFeatureId: null, expectedRevision: before.revision,
    expectedProjectId: before.projectId,
  });
  assert.equal(result.plan.executableOrder[0], 'feature.label');
  assert.equal(result.plan.features.find(x => x.feature.id === 'feature.cut').status, 'ready');
  assert.deepEqual(result.structuralInvalidation.readyToEvaluate, []);
  assert.deepEqual(result.structuralInvalidation.changedFeatureIds, []);
  assert.equal(result.history.document.journal.at(-1).type, 'feature.move');
});

test('two same-body writers remain conflicted: timeline move is not a dependency edge', () => {
  let doc = newProject('project.conflicting.writers');
  doc = commitEvent(doc, create('feature.a', 'cut', [], ['body.plate']));
  doc = commitEvent(doc, create('feature.b', 'cut', [], ['body.plate']));
  const moved = moveHistoryFeature(startUndoHistory(doc), {
    eventId: 'event.move.b', featureId: 'feature.b', afterFeatureId: null,
    expectedProjectId: doc.projectId, expectedRevision: doc.revision,
  });
  assert.deepEqual(moved.plan.executableOrder, []);
  assert.deepEqual(moved.plan.features.map(f => f.status), ['conflicted','conflicted']);
  assert.ok(moved.plan.features.every(f =>
    f.diagnostics.some(d => d.code === 'UNORDERED_MUTATION')));
});

test('undo/redo and model archive restore preserve move events, stable IDs and future dependency edits', () => {
  const initial = plate();
  let h = startUndoHistory(initial);
  h = moveHistoryFeature(h, request(h, 'event.move', 'feature.cut', 'feature.extrude')).history;
  const serialized = serializeModelArchive(createModelArchive(h));
  h = deserializeModelArchive(serialized).history;
  assert.deepEqual(order(h.document).slice(2,4), ['feature.extrude','feature.cut']);
  h = undoTransaction(h, ['event.undo.move']);
  assert.deepEqual(order(h.document).slice(2,4), ['feature.cut','feature.extrude']);
  h = deserializeUndoHistory(serializeUndoHistory(h));
  h = redoTransaction(h, ['event.redo.move']);
  assert.deepEqual(order(h.document).slice(2,4), ['feature.extrude','feature.cut']);
  const beforeEdit = h.document;
  h = { ...h }; // undo history stays an immutable, parsed JSON-compatible object.
  const edited = commitEvent(h.document, {
    eventId: 'event.edit.depth', type: 'feature.edit',
    featureId: 'parameter.depth', patch: { payload: { parameter: { name: 'depth', unit: 'mm',
      expression: { op: 'literal', value: 12, unit: 'mm' } } } },
  });
  const delta = planIncrementalEvaluation(beforeEdit, edited);
  assert.deepEqual(delta.readyToEvaluate,
    ['parameter.depth','feature.extrude','feature.cut']);
  assert.deepEqual(delta.unchangedReady, ['feature.sketch','feature.label']);
  assert.deepEqual(order(deserializeProject(serializeProject(edited))),
    order(edited));
  assert.equal(featuresOf(edited).find(f => f.id === 'parameter.depth').payload.parameter.expression.value, 12);
});

test('removed feature remains a tombstone anchor for invertible move/restore', () => {
  let doc = newProject('project.tombstone');
  for (const id of ['feature.a','feature.b','feature.c']) {
    doc = commitEvent(doc, create(id, 'annotation'));
  }
  doc = commitEvent(doc, { eventId:'event.remove.b', type:'feature.remove',
    featureId:'feature.b' });
  let h = startUndoHistory(doc);
  h = moveHistoryFeature(h, request(h, 'event.move.c','feature.c',null)).history;
  assert.deepEqual(order(h.document), ['feature.c','feature.a']);
  h = undoTransaction(h, ['event.undo.move']);
  assert.deepEqual(order(h.document), ['feature.a','feature.c']);
  assert.deepEqual(featureTimelineOf(h.document).map(x => [x.featureId,x.active]), [
    ['feature.a',true],['feature.b',false],['feature.c',true],
  ]);
  const restored = commitEvent(h.document, {
    eventId:'event.restore.b', type:'feature.restore', featureId:'feature.b',
  });
  assert.deepEqual(order(restored), ['feature.a','feature.b','feature.c']);
});

test('revisions, malformed moves, missing anchors and inactive targets refuse atomically', () => {
  const doc = plate(), before = serializeProject(doc);
  const h = startUndoHistory(doc);
  assert.throws(() => moveHistoryFeature(h, {
    ...request(h,'event.stale','feature.cut','feature.extrude'),
    expectedRevision: doc.revision-1,
  }), ProjectRevisionError);
  assert.throws(() => moveHistoryFeature(h, {
    ...request(h,'event.wrongproject','feature.cut','feature.extrude'),
    expectedProjectId: 'project.other',
  }), ProjectRevisionError);
  assert.throws(() => moveHistoryFeature(h,
    request(h,'event.self','feature.cut','feature.cut')), ProjectFormatError);
  assert.throws(() => moveHistoryFeature(h,
    request(h,'event.missing','feature.cut','feature.absent')), ProjectFormatError);
  assert.throws(() => moveHistoryFeature(h,
    request(h,'event.noop','feature.cut','feature.sketch')), ProjectFormatError);
  assert.throws(() => commitEvent(doc, {
    eventId:'event.missingkey',type:'feature.move',featureId:'feature.cut',
  }), ProjectFormatError);
  assert.throws(() => commitEvent(doc, {
    eventId:'event.unknown',type:'feature.move',featureId:'feature.cut',
    afterFeatureId:'feature.absent',
  }), ProjectFormatError);
  assert.throws(() => commitEvent(doc, {
    eventId:'event.malformed',type:'feature.move',featureId:'feature.cut',
    afterFeatureId:null,extra:1,
  }), ProjectFormatError);
  const removed = commitEvent(doc, {
    eventId:'event.remove.cut',type:'feature.remove',featureId:'feature.cut',
  });
  assert.throws(() => moveHistoryFeature(startUndoHistory(removed),
    request(startUndoHistory(removed),'event.move.removed','feature.cut',null)),
    ProjectFormatError);
  assert.equal(serializeProject(doc),before);
  assert.deepEqual(order(doc), order(deserializeProject(before)));
});

test('published plate-history move example executes with the same model contracts', async () => {
  await import('../examples/plate-history-move.mjs');
});
