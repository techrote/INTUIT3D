/**
 * CAD authoring example: replace the sketch supplying TWO through-cuts in a
 * plate, retire the old sketch, edit an earlier plate dimension, undo/redo and
 * reopen the authoritative archive. MODEL is semantic intent, not a B-rep.
 */
import assert from 'node:assert/strict';
import { newProject, commitEvent, featuresOf, planProject } from '../src/index.ts';
import { startUndoHistory, undoTransaction, redoTransaction } from '../src/transactions.ts';
import { createModelArchive, serializeModelArchive, deserializeModelArchive } from '../src/archive.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  previewCutProfileSourceBatch, commitUndoableCutProfileSourceBatch,
} from '../src/cut-profile-source.ts';

const created = (id,kind,dependsOn,writeTargets,payload) => ({
  eventId:'create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
let doc=newProject('project.demo.sketch.swap');
for (const event of [
  created('sketch.plate','sketch',[],['sketch.plate'],
    {widthMm:120,heightMm:80,profileId:'cycle:plate'}),
  created('sketch.old','sketch',[],['sketch.old'],
    {diameterMm:10,profileId:'cycle:two.bores'}),
  created('extrude.plate','extrude',['sketch.plate'],['body.plate'],
    {sourceSketchId:'sketch.plate',thicknessMm:8}),
  created('cut.left','cut',['extrude.plate','sketch.old'],['body.plate'],
    {targetBodyId:'body.plate',sourceSketchId:'sketch.old',
      profileCandidateId:'cycle:left.old',throughAll:true}),
  created('cut.right','cut',['cut.left','sketch.old'],['body.plate'],
    {targetBodyId:'body.plate',sourceSketchId:'sketch.old',
      profileCandidateId:'cycle:right.old',throughAll:true}),
  created('extrude.spacer','extrude',[],['body.spacer'],{thicknessMm:4}),
]) doc=commitEvent(doc,event);
const request={
  format:'intuit3d.cut-profile-source-batch',version:1,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  admission:'require_ready',
  replacementSketch:{
    eventId:'create.sketch.new',
    feature:{id:'sketch.new',kind:'sketch',dependsOn:[],
      writeTargets:['sketch.new'],payload:{
        diameterMm:14,profileId:'cycle:two.new.bores',
      }},
  },
  edits:[
    {
      eventId:'edit.cut.left',cutFeatureId:'cut.left',targetBodyId:'body.plate',
      expectedSourceSketchId:'sketch.old',expectedProfileCandidateId:'cycle:left.old',
      sourceSketchId:'sketch.new',profileCandidateId:'cycle:left.new',
      releasePreviousSketchDependency:true,
    },
    {
      eventId:'edit.cut.right',cutFeatureId:'cut.right',targetBodyId:'body.plate',
      expectedSourceSketchId:'sketch.old',expectedProfileCandidateId:'cycle:right.old',
      sourceSketchId:'sketch.new',profileCandidateId:'cycle:right.new',
      releasePreviousSketchDependency:true,
    },
  ],
  retireSketch:{eventId:'retire.sketch.old',featureId:'sketch.old'},
};
const preview=previewCutProfileSourceBatch(doc,request);
assert.deepEqual(preview.cutStatuses,[
  {featureId:'cut.left',status:'ready'},
  {featureId:'cut.right',status:'ready'},
]);
assert.ok(preview.invalidation.unchangedReady.includes('extrude.spacer'));
let session=commitUndoableCutProfileSourceBatch(startUndoHistory(doc),request);
session=deserializeModelArchive(
  serializeModelArchive(createModelArchive(session))).history;
assert.ok(!featuresOf(session.document).some((f)=>f.id==='sketch.old'));
session=undoTransaction(session,[
  'undo.retire','undo.cut.right','undo.cut.left','undo.sketch.new',
]);
assert.equal(featuresOf(session.document).find((f)=>f.id==='cut.left')
  .payload.sourceSketchId,'sketch.old');
session=redoTransaction(session,[
  'redo.sketch.new','redo.cut.left','redo.cut.right','redo.retire',
]);
assert.equal(featuresOf(session.document).find((f)=>f.id==='cut.right')
  .payload.profileCandidateId,'cycle:right.new');
const initial=session.document;
const edited=commitEvent(initial,{
  eventId:'edit.plate.width',type:'feature.edit',featureId:'sketch.plate',
  patch:{payload:{widthMm:150,heightMm:80,profileId:'cycle:plate'}},
});
const delta=planIncrementalEvaluation(initial,edited);
assert.ok(delta.readyToEvaluate.includes('extrude.plate'));
assert.ok(delta.readyToEvaluate.includes('cut.left'));
assert.ok(delta.readyToEvaluate.includes('cut.right'));
assert.ok(delta.unchangedReady.includes('extrude.spacer'));
assert.equal(planProject(edited).features.find((s)=>s.feature.id==='cut.right').status,'ready');

console.log(JSON.stringify({
  contract:'@intuit3d/model/cut-profile-source-batch/v1',
  projectId:edited.projectId,revision:edited.revision,
  replacementDiameterMm:14,plateWidthMm:150,
  preservedBody:'body.plate',preservedCutIds:['cut.left','cut.right'],
  retiredSketch:'sketch.old',newSketch:'sketch.new',
  readyToEvaluate:delta.readyToEvaluate,
  structurallyReusable:delta.unchangedReady,
  archiveReopened:true,oneStepUndoRedo:true,
  sketchAdmissionRequired:true,nativeRebuildRequired:true,
  exactGeometryAuthority:false,independentStepVerified:false,
},null,2));
