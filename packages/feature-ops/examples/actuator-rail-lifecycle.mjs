/**
 * Real INTENT/SKETCH/RUNTIME consumer: remove and restore a nonterminal
 * channel cut in a stepped pneumatic actuator rail, preserving later authored
 * port/gauge cuts, semantic identity and an independent cover solid.
 * No B-rep, physical Boolean, OCCT or STEP export is executed.
 */
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as cutChain from '@intuit3d/model/body-cut-chain';
import * as lifecycle from '@intuit3d/model/feature-lifecycle';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION}
  from '../src/ordered-cut.mjs';
import {BODY_OPERATION_LIFECYCLE_FORMAT as FORMAT,
  inspectSelectedBodyRemoval,removeSelectedBodyOperation,
  restoreSelectedBodyOperations} from '../src/body-operation-lifecycle.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
  archive,sketch,discovery});
const services={runtime,model,lifecycle,sketch,discovery,cutChain};
function polygon(prefix,vertices){
  const points=vertices.map(([x,y],i)=>({id:prefix+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:prefix+'.e'+i,start:p.id,
      end:points[(i+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:prefix+'.fixed.'+p.id,kind:'fixed',
      point:p.id,x:p.x,y:p.y}))});
}
const sketches=[
  ['sketch.rail',polygon('rail',[[-75,-30],[75,-30],[75,-8],
    [45,-8],[45,30],[-75,30]])],
  ['sketch.channel',polygon('channel',[[-50,-19],[24,-19],[24,-11],[-50,-11]])],
  ['sketch.port',polygon('port',[[-55,10],[-43,10],[-43,22],[-55,22]])],
  ['sketch.gauge',polygon('gauge',[[15,5],[29,5],[29,19],[15,19]])],
  ['sketch.cover',polygon('cover',[[0,0],[50,0],[50,15],[0,15]])]
];
const candidates=Object.fromEntries(sketches.map(([id,s])=>{
  const d=discovery.discoverPlateProfiles(s);
  assert.equal(d.status,'ready',JSON.stringify(d.rejected));
  assert.equal(d.candidates.length,1);
  return [id,d.candidates[0].id];
}));
let history=transactions.startUndoHistory(model.newProject('actuator.rail.lifecycle'));
history=runtime.commit(history,sketches.map(([id,s])=>({
  eventId:'create.'+id,type:'feature.create',feature:{
    id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:s}
  }})),history.document.revision);
function extrude(sourceSketchId,featureId,bodyId,depth){
  history=authorProfileExtrusion(history,{format:PROFILE_OPS_FORMAT,
    version:PROFILE_OPS_VERSION,eventId:'make.'+featureId,
    expectedRevision:history.document.revision,sourceSketchId,
    profileCandidateId:candidates[sourceSketchId],extrudeFeatureId:featureId,
    outputBodyId:bodyId,depthMm:depth,units:'mm',frame:'local_xy'},services).history;
}
extrude('sketch.rail','extrude.rail','body.rail',10);
extrude('sketch.cover','extrude.cover','body.cover',5);
function append(cutId,after,sketchId,extent){
  history=appendOrderedProfileCut(history,{format:ORDERED_CUT_FORMAT,
    version:ORDERED_CUT_VERSION,expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'make.'+cutId,units:'mm',frame:'local_xy',
    sourceSketchId:sketchId,profileCandidateId:candidates[sketchId],
    afterBodyWriterId:after,targetBodyId:'body.rail',
    cutFeatureId:cutId,extent},services).history;
}
append('cut.channel','extrude.rail','sketch.channel',{kind:'through_all'});
append('cut.port','cut.channel','sketch.port',{kind:'blind',depthMm:4});
append('cut.gauge','cut.port','sketch.gauge',{kind:'through_all'});
const initial=history;
const header=h=>({format:FORMAT,version:1,
  expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
  units:'mm',frame:'local_xy',targetBodyId:'body.rail'});
const impact=inspectSelectedBodyRemoval(history,{
  ...header(history),featureId:'cut.channel'},services);
assert.deepEqual(impact.transitiveDependents,['cut.port','cut.gauge']);
assert.deepEqual(impact.dependentBodyWriters,['cut.port','cut.gauge']);
const removalRequest={...header(history),featureId:'cut.channel',
  expectedDependents:impact.transitiveDependents,
  mode:'keep_dependents_pending',confirmCascade:false,
  eventIds:['remove.channel']};
for(const bad of [
  {...removalRequest,targetBodyId:'body.cover'},
  {...removalRequest,expectedRevision:removalRequest.expectedRevision-1},
  {...removalRequest,expectedDependents:['cut.port']},
  {...removalRequest,mode:'cascade_descendants',
    eventIds:['remove.a','remove.b','remove.c']},
]){
  assert.throws(()=>removeSelectedBodyOperation(history,bad,services));
  assert.equal(history.document.revision,initial.document.revision);
}
const removed=removeSelectedBodyOperation(history,removalRequest,services);
assert.deepEqual(removed.removedFeatureIds,['cut.channel']);
assert.equal(model.featuresOf(removed.history.document).some(f=>f.id==='cut.channel'),false);
assert.equal(model.featuresOf(removed.history.document).some(f=>f.id==='cut.port'),true);
assert.equal(model.featuresOf(removed.history.document).some(f=>f.id==='cut.gauge'),true);
assert.ok(removed.retainedDependentStatuses.every(x=>
  !['preview_only','pending_exact_provider','validated_exact'].includes(x.status)));
assert.ok(!removed.invalidation.invalidatedFeatureIds.includes('extrude.cover'));
const afterUndo=runtime.undo(removed.history,['undo.remove.channel']);
assert.equal(model.featuresOf(afterUndo.document).some(f=>f.id==='cut.channel'),true);
const afterRedo=runtime.redo(afterUndo,['redo.remove.channel']);
assert.equal(model.featuresOf(afterRedo.document).some(f=>f.id==='cut.channel'),false);
history=runtime.reopen(runtime.save(afterRedo));
const restored=restoreSelectedBodyOperations(history,{...header(history),
  featureIds:['cut.channel'],eventIds:['restore.channel'],
  admission:'require_ready'},services);
assert.equal(restored.statuses[0].status,'pending_exact_provider');
assert.equal(model.featuresOf(restored.history.document)
  .find(f=>f.id==='cut.channel').payload.targetBodyId,'body.rail');
history=runtime.reopen(runtime.save(restored.history));
const edit=editExtrudeThickness(history,{eventId:'edit.rail.depth',
  featureId:'extrude.rail',expectedRevision:history.document.revision,
  thicknessMm:14},services);
assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.gauge'));
assert.ok(!edit.invalidation.invalidatedFeatureIds.includes('extrude.cover'));
history=runtime.reopen(runtime.save(edit.history));
const byId=id=>model.featuresOf(history.document).find(f=>f.id===id);
assert.equal(byId('extrude.rail').payload.thicknessMm,14);
assert.equal(byId('extrude.cover').payload.thicknessMm,5);
assert.deepEqual(byId('cut.port').dependsOn,['cut.channel','sketch.port']);
assert.equal(cutChain.inspectBodyCutChain(history.document,'body.rail')
  .eligibleAfterWriterId,'cut.gauge');

// A confirmed cascade is distinct from hiding unresolved intent.
const cascade=removeSelectedBodyOperation(initial,{
  ...header(initial),featureId:'cut.channel',
  expectedDependents:['cut.port','cut.gauge'],mode:'cascade_descendants',
  confirmCascade:true,eventIds:['retire.gauge','retire.port','retire.channel']
},services);
assert.deepEqual(cascade.removedFeatureIds,
  ['cut.gauge','cut.port','cut.channel']);
assert.equal(cascade.history.undoStack.length,initial.undoStack.length+1);
const revived=restoreSelectedBodyOperations(cascade.history,{
  ...header(cascade.history),featureIds:['cut.channel','cut.port','cut.gauge'],
  eventIds:['revive.channel','revive.port','revive.gauge'],
  admission:'require_ready'},services);
assert.equal(revived.restoredFeatureIds.length,3);
assert.equal(model.featuresOf(revived.history.document)
  .filter(f=>f.writeTargets.includes('body.rail')).length,4);
console.log(JSON.stringify({
  kind:'real_SKETCH_INTENT_RUNTIME_consumer',
  part:'stepped pneumatic actuator rail with channel, port, gauge and independent cover',
  initialRevision:initial.document.revision,finalRevision:history.document.revision,
  temporarySuppression:removed.removedFeatureIds,
  temporarilyBlocked:removed.retainedDependentStatuses,
  restoration:restored.restoredFeatureIds,
  confirmedCascade:cascade.removedFeatureIds,
  cascadeRestored:revived.restoredFeatureIds,
  railDepthMm:14,unchangedCoverDepthMm:5,
  undoRedoArchive:'passed',invalidSelections:'refused_before_commit',
  exactAuthority:false,independentInteroperability:false,
  nativeBrep:'not_executed',step:'not_executed'
},null,2));
