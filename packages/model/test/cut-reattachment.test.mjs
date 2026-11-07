import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject,
  ProjectFormatError, ProjectRevisionError, serializeProject,
} from '../src/index.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction,
  redoTransaction, serializeUndoHistory,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  CUT_REATTACHMENT_FORMAT, CUT_REATTACHMENT_VERSION,
  inspectCutReattachment, previewCutReattachment,
  commitUndoableCutReattachment,
} from '../src/cut-reattachment.ts';

function make(id,kind,dependsOn,writeTargets,payload) {
  return {type:'feature.create',eventId:'event.create.'+id,
    feature:{id,kind,dependsOn,writeTargets,payload}};
}
function fixture({unresolvedReplacement = false} = {}) {
  let doc = newProject('project.cut.recover');
  doc = commitEvent(doc,make('feature.sketch','sketch',[],['sketch.plate'],
    {widthMm:120,heightMm:80,holes:[{id:'hole.a',x:30,y:40,r:5}]}));
  doc = commitEvent(doc,make('feature.extrude.old','extrude',['feature.sketch'],
    ['body.plate'],{sourceSketchId:'feature.sketch',thicknessMm:8}));
  doc = commitEvent(doc,make('feature.cut','cut',['feature.extrude.old'],
    ['body.plate'],{targetBodyId:'body.plate',throughAll:true}));
  doc = commitEvent(doc,make('feature.fillet','fillet',['feature.cut'],
    ['body.plate'],{radiusMm:2}));
  doc = commitEvent(doc,make('feature.unrelated','extrude',[],
    ['body.other'],{thicknessMm:4}));
  assert.equal(planProject(doc).features.every(x=>x.status==='ready'),true);
  doc = commitEvent(doc,{
    eventId:'event.remove.old',type:'feature.remove',featureId:'feature.extrude.old'});
  doc = commitEvent(doc,make('feature.extrude.replacement','extrude',
    unresolvedReplacement?['feature.missing.sketch']:['feature.sketch'],
    ['body.plate'],{sourceSketchId:'feature.sketch',thicknessMm:12}));
  return doc;
}
const req = (doc, extras={}) => ({
  format:CUT_REATTACHMENT_FORMAT,version:CUT_REATTACHMENT_VERSION,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  cutFeatureId:'feature.cut',removedProducerId:'feature.extrude.old',
  replacementProducerId:'feature.extrude.replacement',
  bodyId:'body.plate',eventId:'event.reattach.cut',
  admission:'require_ready',...extras,
});
const status = (doc,id) => planProject(doc).features
  .find(x=>x.feature.id===id)?.status;

test('a deleted plate extrusion can be replaced without deleting the cut/fillet or rewriting the target body', () => {
  const before=fixture(), copy=serializeProject(before);
  const inspect=inspectCutReattachment(before,'feature.cut');
  assert.deepEqual(inspect.removedProducerIds,['feature.extrude.old']);
  assert.deepEqual(inspect.activeReplacementIds,['feature.extrude.replacement']);
  assert.equal(inspect.bodyId,'body.plate');
  assert.notEqual(inspect.currentStatus,'ready');
  const preview=previewCutReattachment(before,req(before));
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(preview.requiresNativeRebuild,true);
  assert.equal(preview.resultingStatus,'ready');
  assert.equal(preview.document.revision,before.revision+1);
  assert.deepEqual(preview.invalidation.readyToEvaluate,
    ['feature.extrude.replacement','feature.cut','feature.fillet']);
  assert.deepEqual(preview.invalidation.unchangedReady,
    ['feature.sketch','feature.unrelated']);
  assert.deepEqual(preview.invalidation.retiredFeatureIds,[]);
  assert.equal(status(preview.document,'feature.extrude.replacement'),'ready');
  const cut=featuresOf(preview.document).find(f=>f.id==='feature.cut');
  assert.deepEqual(cut.dependsOn,['feature.extrude.replacement']);
  assert.deepEqual(cut.writeTargets,['body.plate']);
  assert.equal(cut.payload.targetBodyId,'body.plate');
  assert.equal(featuresOf(preview.document).find(f=>f.id==='feature.fillet')
    .dependsOn[0],'feature.cut');
  assert.equal(serializeProject(before),copy);
});

test('repair is one undo frame and remains stable across undo, redo, archive and retrospective width edit', () => {
  const original=fixture();
  let history=startUndoHistory(original);
  history=commitUndoableCutReattachment(history,req(original));
  assert.equal(history.undoStack.length,1);
  assert.equal(status(history.document,'feature.cut'),'ready');
  const repaired=history.document;
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['event.undo.reattach']);
  assert.notEqual(status(history.document,'feature.cut'),'ready');
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.cut')
    .dependsOn[0],'feature.extrude.old');
  history=redoTransaction(history,['event.redo.reattach']);
  assert.equal(status(history.document,'feature.cut'),'ready');
  assert.deepEqual(featuresOf(history.document).find(f=>f.id==='feature.cut')
    .dependsOn,['feature.extrude.replacement']);
  const beforeEdit=history.document;
  history=commitUndoableTransaction(history,[{
    type:'feature.edit',eventId:'event.width.150',featureId:'feature.sketch',
    patch:{payload:{widthMm:150,heightMm:80,
      holes:[{id:'hole.a',x:30,y:40,r:5}]}},
  }]);
  const delta=planIncrementalEvaluation(beforeEdit,history.document);
  assert.deepEqual(delta.readyToEvaluate,[
    'feature.sketch','feature.extrude.replacement','feature.cut','feature.fillet',
  ]);
  assert.deepEqual(delta.unchangedReady,['feature.unrelated']);
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.sketch')
    .payload.widthMm,150);
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.cut')
    .payload.targetBodyId,'body.plate');
  assert.notEqual(repaired.revision,history.document.revision);
});

test('unresolved replacement stays explicitly unresolved when user requests permissive admission', () => {
  const before=fixture({unresolvedReplacement:true});
  assert.throws(()=>previewCutReattachment(before,req(before)),ProjectFormatError);
  const preview=previewCutReattachment(before,
    req(before,{admission:'permit_unresolved'}));
  assert.equal(preview.resultingStatus,'blocked');
  assert.deepEqual(preview.invalidation.unresolved.find(x=>x.featureId==='feature.cut')
    .diagnosticCodes,['BLOCKED_DEPENDENCY']);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(preview.plan.executableOrder.includes('feature.unrelated'),true);
});

test('wrong body, wrong producer, stale revision, forged intent and duplicate event IDs reject atomically', () => {
  const doc=fixture(), history=startUndoHistory(doc);
  const before=serializeUndoHistory(history);
  for(const change of [
    {bodyId:'body.other'},
    {replacementProducerId:'feature.unrelated'},
    {removedProducerId:'feature.never'},
    {removedProducerId:'feature.sketch'},
    {removedProducerId:'feature.extrude.replacement'},
    {replacementProducerId:'feature.cut'},
    {cutFeatureId:'feature.fillet'},
    {expectedProjectId:'project.other'},
    {expectedRevision:doc.revision-1},
    {eventId:'event.create.feature.cut'},
    {unexpected:true},
    {format:'intuit3d.unsupported'},
  ]) {
    assert.throws(()=>commitUndoableCutReattachment(history,req(doc,change)),
      /cut reattachment|journal|stale|repeats/);
  }
  assert.equal(serializeUndoHistory(history),before);
});

test('an active old extrusion is not silently treated as deleted or body-equivalent', () => {
  let doc=newProject('project.active.old');
  doc=commitEvent(doc,make('feature.extrude.old','extrude',[],['body.plate'],{}));
  doc=commitEvent(doc,make('feature.cut','cut',['feature.extrude.old'],
    ['body.plate'],{targetBodyId:'body.plate'}));
  doc=commitEvent(doc,make('feature.extrude.replacement','extrude',[],
    ['body.plate'],{}));
  assert.throws(()=>previewCutReattachment(doc,req(doc)),ProjectFormatError);
  const broken=fixture();
  broken.journal[2].feature.payload.targetBodyId='body.other';
  assert.throws(()=>previewCutReattachment(broken,req(broken)),ProjectFormatError);
});

test('public repair demonstration runs with semantic-only status', async () => {
  await import('../examples/reattach-cut.mjs');
});
