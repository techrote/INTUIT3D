import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, featuresOf, planProject } from '../src/index.ts';
import { startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction } from '../src/transactions.ts';
import { commitUndoableDimensionEdit } from '../src/dimension-edit.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import { createModelArchive, serializeModelArchive, deserializeModelArchive } from '../src/archive.ts';
import { previewDimensionSourceOverride, commitUndoableDimensionSourceOverride,
  DIMENSION_SOURCE_OVERRIDE_FORMAT } from '../src/dimension-source-override.ts';
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const r=(doc,id)=>featuresOf(doc).find(f=>f.id===id);
const value=(doc,id)=>evaluateDimensionBindingPlan(planProject(doc)).featureGates
  .find(f=>f.featureId===id)?.resolvedPayload?.thicknessMm;
const param={op:'ref',featureId:'parameter.thickness'};
function fixture(independent=false){
 let h=startUndoHistory(newProject('project.override.plate'));
 h=commitUndoableTransaction(h,[
  create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{roles:['outline','hole.left','hole.right']}}),
  create('create.parameter',{id:'parameter.thickness',kind:'parameter',dependsOn:[],writeTargets:[],
    payload:{parameter:{name:'thickness',unit:'mm',expression:{op:'literal',value:8,unit:'mm'}}}}),
  create('create.plate',{id:'extrude.plate',kind:'extrude',
    dependsOn:independent?['sketch.plate','parameter.thickness']:['sketch.plate'],
    writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
  create('create.cut',{id:'cut.holes',kind:'cut',dependsOn:['sketch.plate','extrude.plate'],
    writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate',throughAll:true}}),
  create('create.shared',{id:'extrude.shared',kind:'extrude',dependsOn:['sketch.plate'],
    writeTargets:['body.shared'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
  create('create.spacer',{id:'extrude.spacer',kind:'extrude',dependsOn:['sketch.plate'],
    writeTargets:['body.spacer'],payload:{sourceSketchId:'sketch.plate',thicknessMm:5}}),
 ]);
 for(const id of ['extrude.plate','extrude.shared']){
  h=commitUndoableDimensionEdit(h,{format:'intuit3d.dimension-edit',version:1,
    eventId:'bind.'+id,featureId:id,field:'thicknessMm',
    binding:{unit:'mm',expression:id==='extrude.plate'
      ?{op:'multiply',left:param,right:{op:'literal',value:2,unit:'unitless'}}:param},
    expectedRevision:h.document.revision,admission:'require_admissible'});
 }
 return h;
}
const req=(h,patch={})=>({format:DIMENSION_SOURCE_OVERRIDE_FORMAT,version:1,
 action:'detach_and_set_scalar',expectedProjectId:h.document.projectId,
 expectedRevision:h.document.revision,eventId:'override.plate',
 featureId:'extrude.plate',field:'thicknessMm',unit:'mm',
 expectedEffectiveValue:16,value:12,releaseDependencies:['parameter.thickness'],
 confirmIndependentIntentReviewed:true,admission:'require_admissible',...patch});
test('detaches resolved formula as ONE event and preserves shared consumers/body IDs',()=>{
 const h=fixture(), p=previewDimensionSourceOverride(h.document,req(h));
 assert.equal(value(p.document,'extrude.plate'),12);
 assert.equal(value(p.document,'extrude.shared'),8);
 assert.equal(p.document.revision,h.document.revision+1);
 assert.equal(p.previousEffectiveValue,16);
 assert.equal(p.previousAuthoredValue,8);
 assert.deepEqual(p.releasedDependencies,['parameter.thickness']);
 assert.deepEqual(p.retainedDependencies,['sketch.plate']);
 assert.ok(p.invalidation.invalidatedFeatureIds.includes('cut.holes'));
 assert.ok(!p.invalidation.invalidatedFeatureIds.includes('extrude.shared'));
 assert.ok(!p.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
 assert.equal(r(p.document,'extrude.plate').payload.dimensionBindings,undefined);
 assert.deepEqual(r(p.document,'extrude.plate').writeTargets,['body.plate']);
 assert.equal(r(p.document,'cut.holes').payload.targetBodyId,'body.plate');
 assert.equal(p.exactGeometryAuthority,false);
 assert.equal(p.requiresNativeRebuild,true);
});
test('archive/reopen, undo and redo preserve authoring order and semantic identity',()=>{
 const h=fixture(), changed=commitUndoableDimensionSourceOverride(h,req(h));
 const open=deserializeModelArchive(serializeModelArchive(createModelArchive(changed))).history;
 assert.equal(value(open.document,'extrude.plate'),12);
 const undone=undoTransaction(open,['undo.override']);
 assert.equal(value(undone.document,'extrude.plate'),16);
 const redone=redoTransaction(undone,['redo.override']);
 assert.equal(value(redone.document,'extrude.plate'),12);
 assert.equal(value(redone.document,'extrude.shared'),8);
 assert.deepEqual(planProject(redone.document).authoredOrder,planProject(h.document).authoredOrder);
});
test('same-value explicit detach and conservative unreleased edge are allowed',()=>{
 const h=fixture(), p=previewDimensionSourceOverride(h.document,
   req(h,{value:16,releaseDependencies:[],confirmIndependentIntentReviewed:false}));
 assert.equal(value(p.document,'extrude.plate'),16);
 assert.ok(p.retainedDependencies.includes('parameter.thickness'));
 assert.equal(r(p.document,'extrude.plate').payload.dimensionBindings,undefined);
});
test('independently authored dependency has no release witness and must remain',()=>{
 const h=fixture(true);
 assert.throws(()=>previewDimensionSourceOverride(h.document,req(h)),/witness/);
 const p=previewDimensionSourceOverride(h.document,req(h,
   {releaseDependencies:[],confirmIndependentIntentReviewed:false}));
 assert.equal(value(p.document,'extrude.plate'),12);
 assert.ok(p.retainedDependencies.includes('parameter.thickness'));
});
test('stale source, wrong field, invalid releases and malformed input do not commit',()=>{
 const h=fixture(), snapshot=JSON.stringify(h);
 for(const p of [
  {expectedProjectId:'project.other'},{expectedRevision:h.document.revision-1},
  {expectedEffectiveValue:8},{featureId:'extrude.spacer'},{field:'missingMm'},
  {unit:'deg'},{confirmIndependentIntentReviewed:false},{releaseDependencies:['sketch.plate']},
  {releaseDependencies:['parameter.thickness','parameter.thickness']},
  {value:Infinity},{version:2},{eventId:'bind.extrude.plate'},
  {action:'edit_parameter'},{unknown:true},
 ]) assert.throws(()=>commitUndoableDimensionSourceOverride(h,req(h,p)));
 assert.equal(JSON.stringify(h),snapshot);
});
