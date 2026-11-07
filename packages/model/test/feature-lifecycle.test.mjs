import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject, ProjectFormatError,
  ProjectRevisionError, serializeProject, featureTimelineOf,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction, serializeUndoHistory,
} from '../src/transactions.ts';
import {
  createModelArchive, deserializeModelArchive, serializeModelArchive,
} from '../src/archive.ts';
import {
  FEATURE_LIFECYCLE_FORMAT, FEATURE_LIFECYCLE_VERSION,
  inspectFeatureRemoval, previewFeatureRemoval, previewFeatureRestoration,
  commitUndoableFeatureRemoval, commitUndoableFeatureRestoration,
} from '../src/feature-lifecycle.ts';

const make = (id, kind, dependsOn = [], writeTargets = [], payload = {}) => ({
  eventId: 'event.create.' + id, type: 'feature.create',
  feature: { id, kind, dependsOn, writeTargets, payload },
});
function plate() {
  let doc = newProject('project.lifecycle.plate');
  doc = commitEvent(doc, make('parameter.thickness', 'parameter', [], [], {
    parameter: { name: 'thickness', unit: 'mm',
      expression: { op: 'literal', value: 8, unit: 'mm' } },
  }));
  doc = commitEvent(doc, make('feature.sketch', 'sketch',
    [], ['sketch.plate'], { widthMm:120, heightMm:80, holes:[{x:30,y:40,r:5}] }));
  doc = commitEvent(doc, make('feature.extrude', 'extrude',
    ['parameter.thickness','feature.sketch'], ['body.plate'],
    { thicknessMm:8, profileId:'sketch.plate' }));
  doc = commitEvent(doc, make('feature.cut', 'cut',
    ['feature.extrude'], ['body.plate'], { targetBodyId:'body.plate', throughAll:true }));
  doc = commitEvent(doc, make('feature.fillet', 'fillet',
    ['feature.cut'], ['body.plate'], { radiusMm:2 }));
  doc = commitEvent(doc, make('feature.unrelated', 'extrude',
    [], ['body.other'], { widthMm:15 }));
  assert.deepEqual(planProject(doc).features.map((x) => x.status),
    Array(6).fill('ready'));
  return doc;
}
const removeRequest = (doc, mode, eventIds, more = {}) => ({
  format:FEATURE_LIFECYCLE_FORMAT, version:FEATURE_LIFECYCLE_VERSION,
  action:'remove', expectedProjectId:doc.projectId, expectedRevision:doc.revision,
  featureId:'feature.extrude', mode, confirmCascade:false, eventIds, ...more,
});
const restoreRequest = (doc, featureIds, eventIds, admission = 'require_ready') => ({
  format:FEATURE_LIFECYCLE_FORMAT, version:FEATURE_LIFECYCLE_VERSION,
  action:'restore', expectedProjectId:doc.projectId, expectedRevision:doc.revision,
  featureIds, eventIds, admission,
});
const ids = doc => featuresOf(doc).map((feature) => feature.id);

test('the user sees real transitive impact before deleting a dimensioned plate extrusion', () => {
  const doc = plate();
  const impact = inspectFeatureRemoval(doc, 'feature.extrude');
  assert.equal(impact.projectId, doc.projectId);
  assert.equal(impact.revision, doc.revision);
  assert.deepEqual(impact.directDependents, ['feature.cut']);
  assert.deepEqual(impact.transitiveDependents, ['feature.cut','feature.fillet']);
  assert.deepEqual(impact.cascadeIds, ['feature.extrude','feature.cut','feature.fillet']);
  assert.throws(() => previewFeatureRemoval(doc,
    removeRequest(doc,'reject_if_referenced',['event.reject'])), ProjectFormatError);
  assert.equal(doc.revision,6);
});

test('keep dependents pending refuses stale geometry, preserves unrelated body and exact authored intent', () => {
  const before = plate();
  const preview = previewFeatureRemoval(before,
    removeRequest(before,'keep_dependents_pending',['event.remove.extrude']));
  assert.equal(preview.exactGeometryAuthority, false);
  assert.deepEqual(preview.affectedFeatureIds, ['feature.extrude']);
  assert.deepEqual(preview.invalidation.retiredFeatureIds, ['feature.extrude']);
  assert.deepEqual(preview.invalidation.unchangedReady, [
    'parameter.thickness','feature.sketch','feature.unrelated',
  ]);
  assert.deepEqual(preview.invalidation.unresolved.map((row) => [
    row.featureId,row.status,
  ]), [['feature.cut','pending'],['feature.fillet','blocked']]);
  assert.deepEqual(ids(preview.document), [
    'parameter.thickness','feature.sketch','feature.cut','feature.fillet','feature.unrelated',
  ]);
  assert.equal(featuresOf(preview.document).find((f) => f.id === 'feature.cut')
    .payload.targetBodyId, 'body.plate');
  assert.equal(ids(before).length,6);
  assert.equal(planProject(before).executableOrder.length,6);
});

test('confirmed cascade retires just the dependent branch, then undo/redo and archive preserve IDs', () => {
  const original = plate();
  let history = startUndoHistory(original);
  assert.throws(() => previewFeatureRemoval(original,
    removeRequest(original,'cascade_descendants',
      ['event.remove.fillet','event.remove.cut','event.remove.extrude'])),
  ProjectFormatError);
  history = commitUndoableFeatureRemoval(history,
    removeRequest(original,'cascade_descendants',
      ['event.remove.fillet','event.remove.cut','event.remove.extrude'],
      {confirmCascade:true}));
  assert.equal(history.undoStack.length,1);
  assert.deepEqual(ids(history.document),
    ['parameter.thickness','feature.sketch','feature.unrelated']);
  assert.deepEqual(history.document.journal.slice(-3).map((e) => e.featureId),
    ['feature.fillet','feature.cut','feature.extrude']);
  assert.deepEqual(featureTimelineOf(history.document).filter((row) => !row.active)
    .map((row) => row.featureId),
    ['feature.extrude','feature.cut','feature.fillet']);
  history = deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  history = undoTransaction(history,
    ['event.undo.extrude','event.undo.cut','event.undo.fillet']);
  assert.deepEqual(ids(history.document), ids(original));
  assert.equal(planProject(history.document).executableOrder.length,6);
  assert.equal(featuresOf(history.document).find((f) => f.id === 'feature.cut')
    .payload.throughAll,true);
  history = redoTransaction(history,
    ['event.redo.fillet','event.redo.cut','event.redo.extrude']);
  assert.deepEqual(ids(history.document),
    ['parameter.thickness','feature.sketch','feature.unrelated']);
  assert.equal(history.redoStack.length,0);
});

test('explicit restoration is one undoable action; permissive mode retains missing dependencies', () => {
  const doc = plate();
  const removed = previewFeatureRemoval(doc,
    removeRequest(doc,'cascade_descendants',
      ['event.remove.fillet','event.remove.cut','event.remove.extrude'],
      {confirmCascade:true})).document;
  const pending = previewFeatureRestoration(removed,
    restoreRequest(removed,['feature.cut'],['event.restore.cut'],'permit_unresolved'));
  assert.equal(pending.plan.features.find((row) => row.feature.id === 'feature.cut')
    .status,'pending');
  assert.throws(() => previewFeatureRestoration(removed,
    restoreRequest(removed,['feature.cut'],['event.reject.cut'])), ProjectFormatError);
  let history = startUndoHistory(removed);
  history = commitUndoableFeatureRestoration(history,
    restoreRequest(removed,['feature.extrude','feature.cut','feature.fillet'],
      ['event.restore.extrude','event.restore.cut','event.restore.fillet']));
  assert.deepEqual(planProject(history.document).executableOrder,
    planProject(doc).executableOrder);
  history = undoTransaction(history,
    ['event.undo.restore.fillet','event.undo.restore.cut','event.undo.restore.extrude']);
  assert.deepEqual(ids(history.document),['parameter.thickness','feature.sketch','feature.unrelated']);
});

test('stale sessions, duplicate event IDs, invalid tombstones and bounds reject atomically', () => {
  const doc = plate();
  const before = serializeProject(doc);
  const request = removeRequest(doc,'cascade_descendants',
    ['event.same','event.same','event.third'],{confirmCascade:true});
  assert.throws(() => previewFeatureRemoval(doc,request),ProjectFormatError);
  assert.throws(() => previewFeatureRemoval(doc,{
    ...removeRequest(doc,'keep_dependents_pending',['event.old']),
    expectedRevision:doc.revision-1,
  }),ProjectRevisionError);
  assert.throws(() => previewFeatureRemoval(doc,{
    ...removeRequest(doc,'keep_dependents_pending',['event.wrong.project']),
    expectedProjectId:'project.other',
  }),ProjectRevisionError);
  assert.throws(() => previewFeatureRemoval(doc,{
    ...removeRequest(doc,'keep_dependents_pending',['event.extra']),
    unsupported:true,
  }),ProjectFormatError);
  assert.throws(() => previewFeatureRestoration(doc,
    restoreRequest(doc,['feature.cut'],['event.restore.active'])),ProjectFormatError);
  const history = startUndoHistory(doc);
  const frozen = serializeUndoHistory(history);
  assert.throws(() => commitUndoableFeatureRemoval(history,{
    ...removeRequest(doc,'keep_dependents_pending',['event.stale']),
    expectedRevision:doc.revision + 1,
  }),ProjectRevisionError);
  assert.equal(serializeUndoHistory(history),frozen);
  assert.equal(serializeProject(doc),before);
});

test('retrospective dimension edit after recovery invalidates only the physical plate branch', async () => {
  const base = plate();
  let history = startUndoHistory(base);
  history = commitUndoableFeatureRemoval(history,
    removeRequest(base,'keep_dependents_pending',['event.remove.extrude']));
  history = commitUndoableFeatureRestoration(history,
    restoreRequest(history.document,['feature.extrude'],['event.restore.extrude']));
  const beforeEdit = history.document;
  history = { ...history };
  const edit = {
    eventId:'event.width.change',type:'feature.edit',featureId:'feature.sketch',
    patch:{payload:{widthMm:160,heightMm:80,holes:[{x:30,y:40,r:5}]}},
  };
  const { commitUndoableTransaction } = await import('../src/transactions.ts');
  history = commitUndoableTransaction(history,[edit]);
  const { planIncrementalEvaluation } = await import('../src/incremental.ts');
  const delta = planIncrementalEvaluation(beforeEdit,history.document);
  assert.deepEqual(delta.readyToEvaluate,
    ['feature.sketch','feature.extrude','feature.cut','feature.fillet']);
  assert.deepEqual(delta.unchangedReady,['parameter.thickness','feature.unrelated']);
});

test('published interactive plate recovery example executes without a native geometry claim', async () => {
  await import('../examples/recoverable-plate-cut.mjs');
});
