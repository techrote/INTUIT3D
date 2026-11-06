import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject, ProjectFormatError,
  ProjectRevisionError, serializeProject, deserializeProject,
} from '../src/index.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  previewTransaction, commitTransaction, startUndoHistory,
  commitUndoableTransaction, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory, parseUndoHistory,
  MAX_TRANSACTION_EVENTS, UNDO_HISTORY_FORMAT,
} from '../src/transactions.ts';

const feature = (id, deps = [], writes = [], payload = {}) =>
  ({ id, kind: 'feature', dependsOn: deps, writeTargets: writes, payload });
const create = (eventId, id, deps = [], writes = [], payload = {}) =>
  ({ eventId, type: 'feature.create', feature: feature(id, deps, writes, payload) });
const edit = (eventId, id, patch) =>
  ({ eventId, type: 'feature.edit', featureId: id, patch });
const remove = (eventId, id) =>
  ({ eventId, type: 'feature.remove', featureId: id });
const restore = (eventId, id) =>
  ({ eventId, type: 'feature.restore', featureId: id });
const names = (doc) => featuresOf(doc).map(f => f.id);

test('speculative group previews future dependencies without mutating authoritative source', () => {
  const base = newProject('project.preview');
  const staged = [
    create('event.cut', 'feature.cut', ['feature.extrude'], ['body.plate']),
    create('event.other', 'feature.other', [], ['body.other']),
  ];
  const preview = previewTransaction(base, staged);
  assert.equal(base.revision, 0);
  assert.equal(preview.document.revision, 2);
  assert.equal(preview.plan.features.find(x => x.feature.id === 'feature.cut').status, 'pending');
  assert.deepEqual(preview.plan.executableOrder, ['feature.other']);
  const finished = commitTransaction(preview.document,
    [create('event.extrude', 'feature.extrude', [], ['body.plate'])], 2);
  assert.deepEqual(planProject(finished).executableOrder, [
    'feature.other', 'feature.extrude', 'feature.cut',
  ]);
  assert.deepEqual(names(base), []);
});

test('transaction rejects invalid second event and leaves original revision/identity unchanged', () => {
  const base = newProject('project.atomic');
  const changes = [
    create('event.good', 'feature.good'),
    edit('event.bad', 'feature.missing', {payload: {heightMm: 12}}),
  ];
  assert.throws(() => previewTransaction(base, changes), ProjectFormatError);
  assert.throws(() => commitTransaction(base, changes), ProjectFormatError);
  assert.equal(base.revision, 0);
  assert.deepEqual(base.journal, []);
});

test('stale expected revision and repeated event IDs fail closed atomically', () => {
  let base = newProject('project.concurrent');
  base = commitEvent(base, create('event.one', 'feature.one'));
  assert.throws(() => previewTransaction(base,
    [create('event.two', 'feature.two')], 0), ProjectRevisionError);
  assert.throws(() => previewTransaction(base, [
    create('event.same', 'feature.two'),
    create('event.same', 'feature.three'),
  ]), ProjectFormatError);
  assert.deepEqual(names(base), ['feature.one']);
});

test('unordered same-body writes remain explicitly conflicted, never auto-reordered', () => {
  const preview = previewTransaction(newProject('project.body'), [
    create('event.a', 'feature.a', [], ['body.plate']),
    create('event.b', 'feature.b', [], ['body.plate']),
  ]);
  assert.deepEqual(preview.plan.executableOrder, []);
  assert.deepEqual(preview.plan.features.map(f => f.status),
    ['conflicted', 'conflicted']);
  assert.ok(preview.plan.features.every(f =>
    f.diagnostics.some(d => d.code === 'UNORDERED_MUTATION')));
});

test('undo and redo preserve a created semantic ID without reusing feature.create', () => {
  const base = newProject('project.identity');
  let h = startUndoHistory(base);
  assert.equal(h.format, UNDO_HISTORY_FORMAT);
  h = commitUndoableTransaction(h, [create('event.create', 'feature.plate')]);
  const before = h.document;
  assert.deepEqual(names(before), ['feature.plate']);
  h = undoTransaction(h, ['event.undo.one']);
  assert.deepEqual(names(h.document), []);
  assert.equal(h.document.journal.at(-1).type, 'feature.remove');
  h = redoTransaction(h, ['event.redo.one']);
  assert.deepEqual(names(h.document), ['feature.plate']);
  assert.equal(h.document.journal.at(-1).type, 'feature.restore');
  assert.equal(before.revision, 1);
  assert.equal(h.document.revision, 3);
  assert.deepEqual(names(deserializeProject(serializeProject(h.document))),
    ['feature.plate']);
});

test('grouped create/edit inverses use current values and replay in reverse', () => {
  let h = startUndoHistory(newProject('project.group'));
  h = commitUndoableTransaction(h, [
    create('event.create', 'feature.plate', [], [], {depthMm: 5}),
    edit('event.edit', 'feature.plate', {payload: {depthMm: 8}}),
  ]);
  assert.equal(featuresOf(h.document)[0].payload.depthMm, 8);
  assert.deepEqual(h.undoStack.at(-1).map(c => c.type),
    ['feature.edit', 'feature.remove']);
  h = undoTransaction(h, ['event.undo.edit', 'event.undo.create']);
  assert.deepEqual(names(h.document), []);
  h = redoTransaction(h, ['event.redo.restore', 'event.redo.edit']);
  assert.equal(featuresOf(h.document)[0].payload.depthMm, 8);
  assert.equal(h.document.journal.at(-2).type, 'feature.restore');
  assert.equal(h.document.revision, 6);
});

test('undo of parameter edit triggers full dependent invalidation; recovery after reopen', () => {
  let base = newProject('project.dimensions');
  base = commitEvent(base, create('event.param', 'parameter.width', [], [],
    {valueMm: 120}));
  base = commitEvent(base, create('event.sketch', 'feature.sketch',
    ['parameter.width'], ['sketch.plate']));
  base = commitEvent(base, create('event.extrude', 'feature.extrude',
    ['feature.sketch'], ['body.plate']));
  base = commitEvent(base, create('event.other', 'feature.other', [], ['body.other']));
  let h = startUndoHistory(base);
  h = commitUndoableTransaction(h, [
    edit('event.dimension', 'parameter.width', {payload: {valueMm: 95}}),
  ]);
  const delta = planIncrementalEvaluation(base, h.document);
  assert.deepEqual(delta.readyToEvaluate,
    ['parameter.width', 'feature.sketch', 'feature.extrude']);
  assert.deepEqual(delta.unchangedReady, ['feature.other']);
  h = deserializeUndoHistory(serializeUndoHistory(h));
  h = undoTransaction(h, ['event.undo.dimension']);
  assert.equal(featuresOf(h.document)[0].payload.valueMm, 120);
  h = deserializeUndoHistory(serializeUndoHistory(h));
  h = redoTransaction(h, ['event.redo.dimension']);
  assert.equal(featuresOf(h.document)[0].payload.valueMm, 95);
  assert.equal(h.undoStack.length, 1);
  assert.equal(h.redoStack.length, 0);
});

test('undo remove restores exact authored semantic intent; redo removes again', () => {
  let base = commitEvent(newProject('project.remove'),
    create('event.create', 'feature.part', ['feature.future'], [], {profile: 'p'}));
  let h = startUndoHistory(base);
  h = commitUndoableTransaction(h, [remove('event.remove', 'feature.part')]);
  assert.deepEqual(names(h.document), []);
  h = undoTransaction(h, ['event.undo.remove']);
  assert.deepEqual(names(h.document), ['feature.part']);
  assert.equal(featuresOf(h.document)[0].payload.profile, 'p');
  assert.equal(planProject(h.document).features[0].status, 'pending');
  h = redoTransaction(h, ['event.redo.remove']);
  assert.deepEqual(names(h.document), []);
});

test('redo invalidates after divergent new user edit, not resurrected as stale', () => {
  let h = startUndoHistory(newProject('project.branch'));
  h = commitUndoableTransaction(h, [create('event.a', 'feature.a')]);
  h = undoTransaction(h, ['event.undo.a']);
  assert.equal(h.redoStack.length, 1);
  h = commitUndoableTransaction(h, [create('event.b', 'feature.b')]);
  assert.equal(h.redoStack.length, 0);
  assert.throws(() => redoTransaction(h, ['event.redo.a']), ProjectRevisionError);
  assert.deepEqual(names(h.document), ['feature.b']);
});

test('history round-trips deterministic command frames and document fence', () => {
  let h = startUndoHistory(newProject('project.durable'));
  h = commitUndoableTransaction(h, [create('event.a', 'feature.a')]);
  h = commitUndoableTransaction(h, [edit('event.b', 'feature.a',
    {kind: 'changed', writeTargets: ['body.plate'], payload: {depthMm: 9}})]);
  const persisted = serializeUndoHistory(h);
  assert.equal(serializeUndoHistory(deserializeUndoHistory(persisted)), persisted);
  h = deserializeUndoHistory(persisted);
  h = undoTransaction(h, ['event.undo.b']);
  assert.equal(featuresOf(h.document)[0].kind, 'feature');
  h = undoTransaction(h, ['event.undo.a']);
  assert.deepEqual(names(h.document), []);
  h = redoTransaction(h, ['event.redo.a']);
  h = redoTransaction(h, ['event.redo.b']);
  assert.equal(featuresOf(h.document)[0].payload.depthMm, 9);
  assert.deepEqual(featuresOf(h.document)[0].writeTargets, ['body.plate']);
});

test('corrupted, stale, extra-key, and unsupported history data are rejected', () => {
  let h = startUndoHistory(newProject('project.guard'));
  h = commitUndoableTransaction(h, [create('event.a', 'feature.a')]);
  const raw = JSON.parse(serializeUndoHistory(h));
  assert.throws(() => parseUndoHistory({...raw, version: 2}), ProjectFormatError);
  assert.throws(() => parseUndoHistory({...raw, geometryCache: {exact: true}}),
    ProjectFormatError);
  assert.throws(() => parseUndoHistory({...raw, documentFence: 'wrong'}),
    ProjectRevisionError);
  assert.throws(() => parseUndoHistory({...raw,
    document: newProject('project.guard')}), ProjectRevisionError);
  assert.throws(() => deserializeUndoHistory('{'), ProjectFormatError);
  assert.throws(() => parseUndoHistory({...raw, undoStack: [[{
    type: 'feature.edit', featureId: 'feature.a',
    patch: {payload: {depth: Infinity}},
  }]]}), ProjectFormatError);
  assert.throws(() => parseUndoHistory({...raw, redoStack: [[{
    type: 'feature.remove', featureId: 'feature.a', unexpected: 1,
  }]]}), ProjectFormatError);
});

test('undo errors are atomic: wrong ID count, duplicate IDs and stale revision', () => {
  let h = startUndoHistory(newProject('project.errors'));
  h = commitUndoableTransaction(h, [create('event.a', 'feature.a')]);
  const persisted = serializeUndoHistory(h);
  assert.throws(() => undoTransaction(h, []), ProjectFormatError);
  assert.throws(() => undoTransaction(h, ['event.undo'], 0), ProjectRevisionError);
  assert.throws(() => undoTransaction(h, ['event.a']), ProjectFormatError);
  assert.equal(serializeUndoHistory(h), persisted);
  h = undoTransaction(h, ['event.undo']);
  assert.throws(() => redoTransaction(h, []), ProjectFormatError);
  assert.equal(names(h.document).length, 0);
});

test('bounded event group rejects oversized or empty transactions without loss', () => {
  const h = startUndoHistory(newProject('project.bounds'));
  const events = Array.from({length: MAX_TRANSACTION_EVENTS + 1},
    (_, i) => create('event.' + i, 'feature.' + i));
  assert.throws(() => commitUndoableTransaction(h, events), ProjectFormatError);
  assert.throws(() => commitUndoableTransaction(h, []), ProjectFormatError);
  assert.equal(h.document.revision, 0);
});

test('successive undo/redo sessions append journal events, retain stable IDs', () => {
  let h = startUndoHistory(newProject('project.long'));
  for (let i = 0; i < 20; i++) {
    h = commitUndoableTransaction(h,
      [create('event.create.' + i, 'feature.n' + i)]);
  }
  assert.equal(h.undoStack.length, 20);
  for (let i = 19; i >= 0; i--) {
    h = undoTransaction(h, ['event.undo.' + i]);
  }
  assert.deepEqual(names(h.document), []);
  h = deserializeUndoHistory(serializeUndoHistory(h));
  for (let i = 0; i < 20; i++) {
    h = redoTransaction(h, ['event.redo.' + i]);
  }
  assert.equal(h.document.revision, 60);
  assert.deepEqual(names(h.document), Array.from({length: 20}, (_, i) => 'feature.n' + i));
  assert.equal(new Set(h.document.journal.map(x => x.eventId)).size, 60);
});

test('manual restore/remove sequence is invertible, preserving dependent diagnostics', () => {
  let doc = commitEvent(newProject('project.restore'),
    create('event.base', 'feature.a'));
  doc = commitEvent(doc, remove('event.initial.remove', 'feature.a'));
  let h = startUndoHistory(doc);
  h = commitUndoableTransaction(h, [restore('event.restore', 'feature.a')]);
  assert.deepEqual(names(h.document), ['feature.a']);
  h = undoTransaction(h, ['event.undo.restore']);
  assert.deepEqual(names(h.document), []);
  h = redoTransaction(h, ['event.redo.restore']);
  assert.deepEqual(names(h.document), ['feature.a']);
});
