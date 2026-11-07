import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction, serializeUndoHistory,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  CUT_PROFILE_SOURCE_FORMAT, CUT_PROFILE_SOURCE_VERSION,
  inspectCutProfileSource, previewCutProfileSourceEdit,
  commitUndoableCutProfileSourceEdit,
} from '../src/cut-profile-source.ts';

const make=(id,kind,dependsOn=[],writeTargets=[],payload={})=>({
  eventId:'create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
const status=(doc,id)=>planProject(doc).features.find(x=>x.feature.id===id)?.status;
const feature=(doc,id)=>featuresOf(doc).find(f=>f.id===id);

function fixture({retireOld=true}={}) {
  let doc=newProject('project.retarg.plate');
  doc=commitEvent(doc,make('sketch.plate','sketch',[],['sketch.plate'],{
    widthMm:120,heightMm:80,profileId:'cycle:plate',
  }));
  doc=commitEvent(doc,make('sketch.holes.old','sketch',[],['sketch.holes.old'],{
    diameterMm:10,profileId:'cycle:holes.old',
  }));
  doc=commitEvent(doc,make('feature.extrude','extrude',['sketch.plate'],['body.plate'],{
    sourceSketchId:'sketch.plate',thicknessMm:8,
  }));
  doc=commitEvent(doc,make('feature.cut','cut',
    ['feature.extrude','sketch.holes.old'],['body.plate'],{
      sourceSketchId:'sketch.holes.old',targetBodyId:'body.plate',
      profileCandidateId:'cycle:holes.old',throughAll:true,
    }));
  doc=commitEvent(doc,make('feature.pocket','cut',
    ['feature.cut','sketch.plate'],['body.plate'],{
      sourceSketchId:'sketch.plate',targetBodyId:'body.plate',
      profileCandidateId:'cycle:pocket',throughAll:false,depthMm:3,
    }));
  doc=commitEvent(doc,make('feature.spacer','extrude',[],['body.spacer'],{
    thicknessMm:4,
  }));
  if(retireOld) doc=commitEvent(doc,{
    eventId:'remove.holes.old',type:'feature.remove',featureId:'sketch.holes.old',
  });
  doc=commitEvent(doc,make('sketch.holes.new','sketch',[],['sketch.holes.new'],{
    diameterMm:14,profileId:'cycle:holes.new',
  }));
  return doc;
}

const request=(doc,overrides={})=>({
  format:CUT_PROFILE_SOURCE_FORMAT,version:CUT_PROFILE_SOURCE_VERSION,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  eventId:'edit.cut.source',cutFeatureId:'feature.cut',targetBodyId:'body.plate',
  expectedSourceSketchId:'sketch.holes.old',
  expectedProfileCandidateId:'cycle:holes.old',
  sourceSketchId:'sketch.holes.new',profileCandidateId:'cycle:holes.new',
  releasePreviousSketchDependency:true,admission:'require_ready',
  ...overrides,
});

test('retarget deleted hole sketch to new profile; preserve cut/body IDs, dependent pocket and independent body',()=>{
  const before=fixture(), frozen=serializeProject(before);
  assert.equal(status(before,'feature.cut'),'pending');
  assert.equal(status(before,'feature.pocket'),'blocked');
  const inspect=inspectCutProfileSource(before,'feature.cut','body.plate');
  assert.equal(inspect.sourceActive,false);
  assert.equal(inspect.semanticStatus,'pending');
  assert.equal(inspect.profileCandidateId,'cycle:holes.old');
  const edited=previewCutProfileSourceEdit(before,request(before));
  assert.equal(edited.semanticStatus,'ready');
  assert.equal(edited.requiresSketchAdmission,true);
  assert.equal(edited.requiresNativeRebuild,true);
  assert.equal(edited.exactGeometryAuthority,false);
  assert.equal(edited.document.revision,before.revision+1);
  assert.deepEqual(edited.invalidation.readyToEvaluate,
    ['feature.cut','feature.pocket']);
  assert.ok(edited.invalidation.unchangedReady.includes('feature.spacer'));
  const cut=feature(edited.document,'feature.cut');
  assert.deepEqual(cut.dependsOn,['feature.extrude','sketch.holes.new']);
  assert.deepEqual(cut.writeTargets,['body.plate']);
  assert.equal(cut.payload.targetBodyId,'body.plate');
  assert.equal(cut.payload.sourceSketchId,'sketch.holes.new');
  assert.equal(cut.payload.profileCandidateId,'cycle:holes.new');
  assert.equal(feature(edited.document,'feature.pocket').dependsOn[0],'feature.cut');
  assert.equal(status(edited.document,'feature.pocket'),'ready');
  assert.equal(serializeProject(before),frozen);
});

test('cut retarget is one undoable edit, survives save/reopen and retrospective plate resize',()=>{
  let history=startUndoHistory(fixture());
  history=commitUndoableCutProfileSourceEdit(history,request(history.document));
  assert.equal(history.undoStack.length,1);
  assert.equal(status(history.document,'feature.cut'),'ready');
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  assert.equal(feature(history.document,'feature.cut').payload.profileCandidateId,
    'cycle:holes.new');
  history=undoTransaction(history,['undo.cut.source']);
  assert.equal(feature(history.document,'feature.cut').payload.sourceSketchId,
    'sketch.holes.old');
  assert.equal(status(history.document,'feature.cut'),'pending');
  history=redoTransaction(history,['redo.cut.source']);
  assert.equal(feature(history.document,'feature.cut').payload.sourceSketchId,
    'sketch.holes.new');
  assert.equal(status(history.document,'feature.pocket'),'ready');
  const before=history.document;
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  // The original plate dimension changes later; only dependent body writes
  // rebuild. The independent spacer and hole sketch remain structurally reusable.
  const changed=commitEvent(history.document,{
    eventId:'edit.plate.width',type:'feature.edit',featureId:'sketch.plate',
    patch:{payload:{widthMm:150,heightMm:80,profileId:'cycle:plate'}},
  });
  const delta=planIncrementalEvaluation(before,changed);
  assert.ok(delta.readyToEvaluate.includes('feature.extrude'));
  assert.ok(delta.readyToEvaluate.includes('feature.cut'));
  assert.ok(delta.readyToEvaluate.includes('feature.pocket'));
  assert.ok(delta.unchangedReady.includes('feature.spacer'));
  assert.ok(delta.unchangedReady.includes('sketch.holes.new'));
  assert.equal(feature(changed,'feature.cut').payload.profileCandidateId,'cycle:holes.new');
});

test('changing selected loop on the same sketch is a one-event body-preserving edit',()=>{
  const doc=fixture({retireOld:false});
  const edited=previewCutProfileSourceEdit(doc,request(doc,{
    sourceSketchId:'sketch.holes.old',profileCandidateId:'cycle:another.hole',
    releasePreviousSketchDependency:false,
  }));
  assert.deepEqual(feature(edited.document,'feature.cut').dependsOn,
    ['feature.extrude','sketch.holes.old']);
  assert.equal(feature(edited.document,'feature.cut').payload.profileCandidateId,
    'cycle:another.hole');
  assert.equal(edited.semanticStatus,'ready');
});

test('author explicitly retains old sketch dependency, or permits a missing future source without fabricated readiness',()=>{
  const doc=fixture();
  assert.throws(()=>previewCutProfileSourceEdit(doc,request(doc,{
    releasePreviousSketchDependency:false,
  })),ProjectFormatError);
  const pending=previewCutProfileSourceEdit(doc,request(doc,{
    releasePreviousSketchDependency:false,admission:'permit_unresolved',
  }));
  assert.deepEqual(feature(pending.document,'feature.cut').dependsOn,
    ['feature.extrude','sketch.holes.old','sketch.holes.new']);
  assert.equal(pending.semanticStatus,'pending');
  const future=previewCutProfileSourceEdit(doc,request(doc,{
    sourceSketchId:'sketch.future.holes',profileCandidateId:'cycle:future.loop',
    admission:'permit_unresolved',
  }));
  assert.equal(future.semanticStatus,'pending');
  assert.equal(future.exactGeometryAuthority,false);
  const healed=commitEvent(future.document,make(
    'sketch.future.holes','sketch',[],['sketch.future.holes'],{diameterMm:6}));
  assert.equal(status(healed,'feature.cut'),'ready');
  assert.equal(status(healed,'feature.pocket'),'ready');
});

test('bad provenance, body, dependency, stale revision and invalid candidate fail atomically',()=>{
  const doc=fixture(), history=startUndoHistory(doc);
  const previous=serializeUndoHistory(history);
  for(const change of [
    {expectedRevision:doc.revision-1},
    {expectedProjectId:'project.other'},
    {cutFeatureId:'feature.extrude'},
    {targetBodyId:'body.spacer'},
    {expectedSourceSketchId:'sketch.other'},
    {expectedProfileCandidateId:'cycle:old.other'},
    {sourceSketchId:'feature.extrude'},
    {sourceSketchId:'feature.cut'},
    {sourceSketchId:'sketch.absent'},
    {sourceSketchId:'sketch.holes.old',profileCandidateId:'cycle:holes.old'},
    {profileCandidateId:'face:kernel.index.4'},
    {profileCandidateId:'cycle:'},
    {releasePreviousSketchDependency:'yes'},
    {admission:'skip-validation'},
    {eventId:'create.feature.cut'},
    {extraField:true},
  ]) {
    assert.throws(()=>commitUndoableCutProfileSourceEdit(history,request(doc,change)),
      /cut profile source|stale|journal/);
  }
  assert.equal(serializeUndoHistory(history),previous);
});

test('example source-retarget flow is executable', async()=>{
  await import('../examples/retarget-cut-profile.mjs');
});
