import assert from 'node:assert/strict';
import { newProject,planProject,featuresOf } from '../src/index.ts';
import { startUndoHistory,commitUndoableTransaction,undoTransaction,redoTransaction } from '../src/transactions.ts';
import { commitUndoableDimensionEdit } from '../src/dimension-edit.ts';
import { previewDimensionSourceOverride,commitUndoableDimensionSourceOverride,
  DIMENSION_SOURCE_OVERRIDE_FORMAT } from '../src/dimension-source-override.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import { createModelArchive,serializeModelArchive,deserializeModelArchive } from '../src/archive.ts';
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const resolved=(doc,id)=>evaluateDimensionBindingPlan(planProject(doc)).featureGates
  .find(x=>x.featureId===id)?.resolvedPayload?.thicknessMm;
let h=startUndoHistory(newProject('project.plate.holes.detach'));
h=commitUndoableTransaction(h,[
 create('sketch.create',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
  payload:{widthMm:120,heightMm:60,roles:['outline','hole.left','hole.right']}}),
 create('parameter.create',{id:'p.thickness',kind:'parameter',dependsOn:[],writeTargets:[],
  payload:{parameter:{name:'thickness',unit:'mm',expression:{op:'literal',value:8,unit:'mm'}}}}),
 create('plate.create',{id:'extrude.plate',kind:'extrude',dependsOn:['sketch.plate'],
  writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
 create('cut.create',{id:'cut.holes',kind:'cut',dependsOn:['sketch.plate','extrude.plate'],
  writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',
   targetBodyId:'body.plate',throughAll:true}}),
 create('shared.create',{id:'extrude.shared',kind:'extrude',dependsOn:['sketch.plate'],
  writeTargets:['body.shared'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
]);
for(const id of ['extrude.plate','extrude.shared']){
 h=commitUndoableDimensionEdit(h,{format:'intuit3d.dimension-edit',version:1,
  eventId:'bind.'+id,featureId:id,field:'thicknessMm',
  binding:{unit:'mm',expression:id==='extrude.plate'?
   {op:'multiply',left:{op:'ref',featureId:'p.thickness'},right:{op:'literal',value:2,unit:'unitless'}}:
   {op:'ref',featureId:'p.thickness'}},
  expectedRevision:h.document.revision,admission:'require_admissible'});
}
assert.equal(resolved(h.document,'extrude.plate'),16);
const req={format:DIMENSION_SOURCE_OVERRIDE_FORMAT,version:1,action:'detach_and_set_scalar',
 expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
 eventId:'override.plate',featureId:'extrude.plate',field:'thicknessMm',unit:'mm',
 expectedEffectiveValue:16,value:12,releaseDependencies:['p.thickness'],
 confirmIndependentIntentReviewed:true,admission:'require_admissible'};
const preview=previewDimensionSourceOverride(h.document,req);
assert.ok(preview.invalidation.invalidatedFeatureIds.includes('cut.holes'));
h=commitUndoableDimensionSourceOverride(h,req);
const reopened=deserializeModelArchive(serializeModelArchive(createModelArchive(h))).history;
assert.equal(resolved(reopened.document,'extrude.plate'),12);
assert.equal(resolved(reopened.document,'extrude.shared'),8);
assert.equal(resolved(undoTransaction(reopened,['undo.plate']).document,'extrude.plate'),16);
assert.equal(resolved(redoTransaction(undoTransaction(reopened,['undo.plate']),['redo.plate']).document,'extrude.plate'),12);
assert.equal(featuresOf(reopened.document).find(x=>x.id==='cut.holes').payload.targetBodyId,'body.plate');
console.log(JSON.stringify({contract:'dimension-source-override/v1',beforeThicknessMm:16,
 afterThicknessMm:12,sharedThicknessMm:8,bodyId:'body.plate',
 invalidated:preview.invalidation.invalidatedFeatureIds,archiveUndoRedo:'PASS',
 exactGeometryAuthority:false,step:'requires separate native and independent qualification'},null,2));
