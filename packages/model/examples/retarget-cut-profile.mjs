/**
 * Editable plate → original hole sketch removed → cut reattached to new sketch
 * with a different hole diameter → downstream pocket rebuilt structurally →
 * undo/redo and archive. No native B-rep or STEP is claimed by this model demo.
 */
import assert from 'node:assert/strict';
import {newProject,commitEvent,featuresOf,planProject} from '../src/index.ts';
import {startUndoHistory,undoTransaction,redoTransaction} from '../src/transactions.ts';
import {createModelArchive,serializeModelArchive,deserializeModelArchive}
  from '../src/archive.ts';
import {previewCutProfileSourceEdit,commitUndoableCutProfileSourceEdit}
  from '../src/cut-profile-source.ts';

const make=(id,kind,dependsOn,writeTargets,payload)=>({
  eventId:'create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
let doc=newProject('project.plate.hole.retarget');
doc=commitEvent(doc,make('sketch.plate','sketch',[],['sketch.plate'],{
  widthMm:120,heightMm:80,profileId:'cycle:plate',
}));
doc=commitEvent(doc,make('sketch.hole.old','sketch',[],['sketch.hole.old'],{
  boreMm:10,profileId:'cycle:bore.old',
}));
doc=commitEvent(doc,make('extrude.plate','extrude',['sketch.plate'],['body.plate'],{
  sourceSketchId:'sketch.plate',thicknessMm:8,
}));
doc=commitEvent(doc,make('cut.bore','cut',
  ['extrude.plate','sketch.hole.old'],['body.plate'],{
    targetBodyId:'body.plate',sourceSketchId:'sketch.hole.old',
    profileCandidateId:'cycle:bore.old',throughAll:true,
  }));
doc=commitEvent(doc,make('cut.pocket','cut',
  ['cut.bore','sketch.plate'],['body.plate'],{
    targetBodyId:'body.plate',sourceSketchId:'sketch.plate',
    profileCandidateId:'cycle:pocket',throughAll:false,depthMm:3,
  }));
doc=commitEvent(doc,make('extrude.spacer','extrude',[],['body.spacer'],{
  thicknessMm:4,
}));
doc=commitEvent(doc,{eventId:'delete.hole.old',type:'feature.remove',
  featureId:'sketch.hole.old'});
doc=commitEvent(doc,make('sketch.hole.new','sketch',[],['sketch.hole.new'],{
  boreMm:14,profileId:'cycle:bore.new',
}));
const request={
  format:'intuit3d.cut-profile-source',version:1,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  eventId:'replace.bore.source',cutFeatureId:'cut.bore',targetBodyId:'body.plate',
  expectedSourceSketchId:'sketch.hole.old',
  expectedProfileCandidateId:'cycle:bore.old',
  sourceSketchId:'sketch.hole.new',profileCandidateId:'cycle:bore.new',
  releasePreviousSketchDependency:true,admission:'require_ready',
};
const before=planProject(doc);
assert.equal(before.features.find(x=>x.feature.id==='cut.bore').status,'pending');
const preview=previewCutProfileSourceEdit(doc,request);
assert.deepEqual(preview.invalidation.readyToEvaluate,['cut.bore','cut.pocket']);
assert.ok(preview.invalidation.unchangedReady.includes('extrude.spacer'));
let session=commitUndoableCutProfileSourceEdit(startUndoHistory(doc),request);
session=deserializeModelArchive(
  serializeModelArchive(createModelArchive(session))).history;
assert.equal(planProject(session.document).features.find(x=>
  x.feature.id==='cut.bore').status,'ready');
session=undoTransaction(session,['undo.bore.source']);
assert.equal(planProject(session.document).features.find(x=>
  x.feature.id==='cut.bore').status,'pending');
session=redoTransaction(session,['redo.bore.source']);
const cut=featuresOf(session.document).find(x=>x.id==='cut.bore');
assert.equal(cut.payload.profileCandidateId,'cycle:bore.new');
assert.equal(cut.payload.targetBodyId,'body.plate');
assert.equal(planProject(session.document).features.find(x=>
  x.feature.id==='cut.pocket').status,'ready');
console.log(JSON.stringify({
  source:'@intuit3d/model/cut-profile-source/v1',
  projectId:session.document.projectId,
  revision:session.document.revision,
  stableCutId:cut.id,
  targetBodyId:cut.payload.targetBodyId,
  selectedSource:cut.payload.sourceSketchId,
  selectedProfile:cut.payload.profileCandidateId,
  readyToEvaluate:preview.invalidation.readyToEvaluate,
  structurallyReusable:preview.invalidation.unchangedReady,
  archiveReopened:true,undoRedo:true,
  sketchAdmissionRequired:true,nativeRebuildRequired:true,
  exactGeometryAuthority:false,independentStepVerified:false,
},null,2));
