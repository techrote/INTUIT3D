import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject,
  ProjectFormatError, ProjectRevisionError, serializeProject,
} from '../src/index.ts';
import {
  commitUndoableTransaction, redoTransaction, undoTransaction,
  serializeUndoHistory, startUndoHistory, MAX_HISTORY_FRAMES,
} from '../src/transactions.ts';
import {
  MODEL_ARCHIVE_FORMAT, MAX_MODEL_ARCHIVE_BYTES,
  createModelArchive, parseModelArchive, serializeModelArchive,
  deserializeModelArchive, checkpointUndoHistory,
  inspectModelArchiveRecovery,
} from '../src/archive.ts';

const create = (eventId, id, deps = [], payload = {}) => ({
  eventId, type: 'feature.create',
  feature: {id, kind:'feature', dependsOn:deps, writeTargets:[], payload},
});
const edit = (eventId, id, payload) => ({
  eventId, type:'feature.edit', featureId:id, patch:{payload},
});
const archive = h => serializeModelArchive(createModelArchive(h));

test('one-file archive preserves semantic document, append-only undo and redo across reopen', () => {
  let h = startUndoHistory(newProject('project.archive'));
  h = commitUndoableTransaction(h, [
    create('event.cut', 'feature.cut', ['feature.extrude'], {diameterMm:4}),
    create('event.extrude', 'feature.extrude', [], {thicknessMm:6}),
  ]);
  assert.deepEqual(planProject(h.document).executableOrder,
    ['feature.extrude', 'feature.cut']);
  const serialized = archive(h);
  const restored = deserializeModelArchive(serialized);
  assert.equal(restored.format, MODEL_ARCHIVE_FORMAT);
  assert.equal(restored.revision, 2);
  assert.equal(serializeModelArchive(restored), serialized);
  assert.deepEqual(featuresOf(restored.history.document).map(x=>x.id),
    ['feature.cut','feature.extrude']);
  const undone = undoTransaction(restored.history, ['event.undo.extrude','event.undo.cut']);
  assert.deepEqual(featuresOf(undone.document), []);
  const redone = redoTransaction(undone, ['event.redo.cut','event.redo.extrude']);
  assert.equal(redone.document.revision, 6);
  assert.deepEqual(featuresOf(redone.document).map(x=>x.id),
    ['feature.cut','feature.extrude']);
  assert.equal(new Set(redone.document.journal.map(x=>x.eventId)).size,6);
});

test('archive never fabricates geometric validity or repairs pending authored intent', () => {
  const h = startUndoHistory(commitEvent(newProject('project.pending'),
    create('event.cut','feature.cut',['feature.future'],{amountMm:2})));
  const reopened = deserializeModelArchive(archive(h));
  assert.equal(planProject(reopened.history.document).features[0].status, 'pending');
  assert.deepEqual(planProject(reopened.history.document).executableOrder, []);
  assert.equal('exactGeometry' in reopened, false);
});

test('parser refuses unsupported versions, cache claims, missing keys and mismatched metadata', () => {
  const value = createModelArchive(startUndoHistory(newProject('project.strict')));
  assert.throws(() => parseModelArchive({...value, version:2}),ProjectFormatError);
  assert.throws(() => parseModelArchive({...value, meshCache:{validatedExact:true}}),
    ProjectFormatError);
  assert.throws(() => parseModelArchive({...value, history:undefined}),ProjectFormatError);
  assert.throws(() => parseModelArchive({...value, revision:99}),ProjectRevisionError);
  assert.throws(() => parseModelArchive({...value, projectId:'project.other'}),
    ProjectRevisionError);
  assert.throws(() => deserializeModelArchive('not-json'),ProjectFormatError);
});

test('inner document/undo fence tampering is detected before archive is admitted', () => {
  let h = startUndoHistory(newProject('project.fence'));
  h = commitUndoableTransaction(h,[create('event.a','feature.a')]);
  const source = JSON.parse(archive(h));
  const damaged = {...source,history:{...source.history,documentFence:'different'}};
  assert.throws(() => parseModelArchive(damaged),ProjectRevisionError);
  const wrongJournal = {...source,history:{...source.history,document:
    {...source.history.document,journal:[],revision:0}}};
  assert.throws(() => parseModelArchive(wrongJournal),ProjectRevisionError);
});

test('checkpoint requires exact full-session fence and an explicit discard acknowledgement', () => {
  let h = startUndoHistory(newProject('project.checkpoint'));
  h = commitUndoableTransaction(h,[create('event.a','feature.a')]);
  const fence = serializeUndoHistory(h);
  assert.throws(() => checkpointUndoHistory(h,'stale','discard-undo-redo'),
    ProjectRevisionError);
  assert.throws(() => checkpointUndoHistory(h,fence,undefined),
    ProjectFormatError);
  const before = serializeProject(h.document);
  const cleared = checkpointUndoHistory(h,fence,'discard-undo-redo');
  assert.equal(cleared.undoStack.length,0);
  assert.equal(cleared.redoStack.length,0);
  assert.equal(serializeProject(cleared.document),before);
  assert.throws(() => undoTransaction(cleared,['event.undo.a']),
    ProjectRevisionError);
  const next = commitUndoableTransaction(cleared,[
    edit('event.b','feature.a',{widthMm:120}),
  ]);
  assert.equal(featuresOf(next.document)[0].payload.widthMm,120);
  assert.equal(next.undoStack.length,1);
  assert.deepEqual(h.undoStack.length,1);
});

test('checkpoint retains every journal event and all semantic feature identities at capacity', () => {
  let h = startUndoHistory(newProject('project.full-history'));
  for(let i=0;i<MAX_HISTORY_FRAMES;i++) {
    h = commitUndoableTransaction(h,[create('event.'+i,'feature.'+i)]);
  }
  assert.throws(()=>commitUndoableTransaction(h,[create('event.extra','feature.extra')]),
    ProjectFormatError);
  const checkpoint = checkpointUndoHistory(h,serializeUndoHistory(h),'discard-undo-redo');
  assert.equal(checkpoint.document.revision,MAX_HISTORY_FRAMES);
  assert.equal(checkpoint.document.journal.length,MAX_HISTORY_FRAMES);
  assert.equal(featuresOf(checkpoint.document).length,MAX_HISTORY_FRAMES);
  const continued = commitUndoableTransaction(checkpoint,
    [create('event.extra','feature.extra')]);
  assert.equal(continued.document.revision,MAX_HISTORY_FRAMES+1);
  assert.equal(continued.undoStack.length,1);
});

test('primary with ancestor backup is current; independent old backup does not replace it', () => {
  let base = startUndoHistory(newProject('project.rotation'));
  base = commitUndoableTransaction(base,[create('event.a','feature.a')]);
  const old = archive(base);
  const latest = commitUndoableTransaction(base,[create('event.b','feature.b')]);
  const inspected = inspectModelArchiveRecovery(archive(latest), old);
  assert.equal(inspected.status,'primary_current');
  assert.equal(inspected.primary.revision,2);
  assert.equal(inspected.backup.revision,1);
});

test('invalid/torn primary surfaces backup only as a recovery candidate', () => {
  let h = startUndoHistory(newProject('project.backup'));
  h = commitUndoableTransaction(h,[create('event.a','feature.a')]);
  const inspected = inspectModelArchiveRecovery(archive(h).slice(0,-12),archive(h));
  assert.equal(inspected.status,'backup_recovery');
  assert.equal(inspected.primary,null);
  assert.equal(inspected.backup.revision,1);
  assert.ok(inspected.diagnostics.some(d=>d.includes('primary:')));
});

test('backup that extends valid primary requires explicit restoration decision', () => {
  let base = startUndoHistory(newProject('project.ahead'));
  base = commitUndoableTransaction(base,[create('event.a','feature.a')]);
  const backup = commitUndoableTransaction(base,[create('event.b','feature.b')]);
  const inspected = inspectModelArchiveRecovery(archive(base),archive(backup));
  assert.equal(inspected.status,'backup_ahead');
  assert.equal(inspected.primary.revision,1);
  assert.equal(inspected.backup.revision,2);
});

test('same-revision divergent journals and different project IDs refuse automatic selection', () => {
  const initial = startUndoHistory(newProject('project.branches'));
  const one = commitUndoableTransaction(initial,[create('event.a','feature.a')]);
  const two = commitUndoableTransaction(initial,[create('event.b','feature.b')]);
  const inspected = inspectModelArchiveRecovery(archive(one),archive(two));
  assert.equal(inspected.status,'diverged');
  assert.ok(inspected.diagnostics.some(d=>d.includes('incompatible')));
  assert.equal(inspectModelArchiveRecovery(archive(one),
    archive(startUndoHistory(newProject('project.other')))).status,'diverged');
});

test('same journal with different undo stacks explicitly retains history ambiguity', () => {
  let active = startUndoHistory(newProject('project.stacks'));
  active = commitUndoableTransaction(active,[create('event.a','feature.a')]);
  const checkpoint = checkpointUndoHistory(active,serializeUndoHistory(active),
    'discard-undo-redo');
  const inspected = inspectModelArchiveRecovery(archive(active),archive(checkpoint));
  assert.equal(inspected.status,'history_ambiguity');
  assert.equal(inspected.primary.revision,inspected.backup.revision);
  assert.equal(inspected.primary.history.undoStack.length,1);
  assert.equal(inspected.backup.history.undoStack.length,0);
});

test('missing or invalid recovery sources remain explicit, never silently initialized', () => {
  assert.equal(inspectModelArchiveRecovery(undefined,null).status,'unrecoverable');
  assert.equal(inspectModelArchiveRecovery('bad','bad').status,'unrecoverable');
  const valid = archive(startUndoHistory(newProject('project.valid')));
  assert.equal(inspectModelArchiveRecovery(valid,undefined).status,'primary_current');
});

test('archive UTF-8 byte budget rejects oversized input and payload without truncation', () => {
  assert.throws(()=>deserializeModelArchive('x'.repeat(MAX_MODEL_ARCHIVE_BYTES+1)),
    ProjectFormatError);
  const h = startUndoHistory(commitEvent(newProject('project.large'),
    create('event.large','feature.large',[],{description:'e'.repeat(10000)})));
  assert.equal(deserializeModelArchive(archive(h)).history.document.revision,1);
});
