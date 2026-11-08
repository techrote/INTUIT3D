/** One drag over THREE cut positions, one undo frame, real SKETCH/INTENT/RUNTIME. */
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as cutChain from '@intuit3d/model/body-cut-chain';
import * as cutOrder from '@intuit3d/model/body-cut-order';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION}
  from '../src/ordered-cut.mjs';
import {inspectOrderedBodyCutMove,moveOrderedBodyCut,
  ORDERED_CUT_MOVE_FORMAT,ORDERED_CUT_MOVE_VERSION}
  from '@intuit3d/feature-ops/ordered-cut-move/v1';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain,cutOrder};
function polygon(label,vertices){
  const points=vertices.map(([x,y],i)=>({id:label+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:label+'.e'+i,start:p.id,
      end:points[(i+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}))});
}
const sketches=[
  ['sketch.manifold',polygon('housing',[[-65,-40],[65,-40],[65,0],[15,0],[15,45],[-65,45]])],
  ['sketch.slot',polygon('slot',[[-48,-27],[-8,-27],[-8,-14],[-48,-14]])],
  ['sketch.pocket',polygon('pocket',[[-48,9],[-23,9],[-23,30],[-48,30]])],
  ['sketch.window',polygon('window',[[-59,-7],[-52,-7],[-52,6],[-59,6]])],
  ['sketch.vent',polygon('vent',[[-10,20],[0,20],[0,30],[-10,30]])],
  ['sketch.clamp',polygon('clamp',[[0,0],[45,0],[45,17],[0,17]])]
];
const selected=Object.fromEntries(sketches.map(([id,doc])=>{
  const profiles=discovery.discoverPlateProfiles(doc);
  assert.equal(profiles.status,'ready',JSON.stringify(profiles.rejected));
  assert.equal(profiles.candidates.length,1);
  return [id,profiles.candidates[0].id];
}));
let history=transactions.startUndoHistory(model.newProject('manifold.cut.dragdrop'));
history=runtime.commit(history,sketches.map(([id,doc])=>({
  eventId:'make.'+id,type:'feature.create',feature:{
    id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}
  }})),history.document.revision);
function extrude(source,feature,body,depth){
  history=authorProfileExtrusion(history,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'make.'+feature,expectedRevision:history.document.revision,
    sourceSketchId:source,profileCandidateId:selected[source],
    extrudeFeatureId:feature,outputBodyId:body,depthMm:depth,
    units:'mm',frame:'local_xy'},services).history;
}
extrude('sketch.manifold','extrude.manifold','body.manifold',9);
extrude('sketch.clamp','extrude.clamp','body.clamp',4);
function cut(feature,after,source,extent){
  history=appendOrderedProfileCut(history,{
    format:ORDERED_CUT_FORMAT,version:ORDERED_CUT_VERSION,
    expectedProjectId:history.document.projectId,expectedRevision:history.document.revision,
    eventId:'make.'+feature,units:'mm',frame:'local_xy',sourceSketchId:source,
    profileCandidateId:selected[source],afterBodyWriterId:after,
    targetBodyId:'body.manifold',cutFeatureId:feature,extent},services).history;
}
cut('cut.slot','extrude.manifold','sketch.slot',{kind:'through_all'});
cut('cut.pocket','cut.slot','sketch.pocket',{kind:'blind',depthMm:3});
cut('cut.window','cut.pocket','sketch.window',{kind:'through_all'});
cut('cut.vent','cut.window','sketch.vent',{kind:'blind',depthMm:2});
const before=history,originalRevision=history.document.revision;
const inspectorReq={format:ORDERED_CUT_MOVE_FORMAT,version:ORDERED_CUT_MOVE_VERSION,
  expectedProjectId:history.document.projectId,expectedRevision:history.document.revision,
  units:'mm',frame:'local_xy',targetBodyId:'body.manifold'};
const inspected=inspectOrderedBodyCutMove(history,inspectorReq,services);
assert.deepEqual(inspected.writerOrder,
  ['extrude.manifold','cut.slot','cut.pocket','cut.window','cut.vent']);
const request={...inspectorReq,cutFeatureId:'cut.slot',
  dropAfterWriterId:'cut.vent',expectedWriterOrder:inspected.writerOrder,
  cutSelections:inspected.cutSelections,eventIdPrefix:'drag.manifold.to.end'};
for(const bad of [
  {...request,expectedRevision:request.expectedRevision-1},
  {...request,targetBodyId:'body.clamp'},
  {...request,dropAfterWriterId:'cut.slot'},
  {...request,dropAfterWriterId:'cut.other'},
  {...request,dropAfterWriterId:'extrude.manifold',cutFeatureId:'cut.slot'},
  {...request,expectedWriterOrder:[...request.expectedWriterOrder].reverse()},
  {...request,cutSelections:request.cutSelections.map((s,i)=>
    i===2?{...s,extent:{kind:'blind',depthMm:50}}:s)},
  {...request,units:'cm'},
]){
  assert.throws(()=>moveOrderedBodyCut(history,bad,services));
  assert.equal(history.document.revision,originalRevision);
}
const moved=moveOrderedBodyCut(history,request,services);
assert.deepEqual(moved.writerOrderAfter,
  ['extrude.manifold','cut.pocket','cut.window','cut.vent','cut.slot']);
assert.equal(moved.swapSteps.length,3);
assert.equal(moved.eventIds.length,8);
assert.equal(moved.history.undoStack.length,before.undoStack.length+1);
assert.ok(moved.invalidation.invalidatedFeatureIds.includes('cut.slot'));
assert.ok(moved.invalidation.invalidatedFeatureIds.includes('cut.vent'));
assert.ok(!moved.invalidation.invalidatedFeatureIds.includes('extrude.clamp'));
const byId=(h,fid)=>model.featuresOf(h.document).find(f=>f.id===fid);
const expectedSources={slot:'sketch.slot',pocket:'sketch.pocket',window:'sketch.window',vent:'sketch.vent'};
for(const [key,source] of Object.entries(expectedSources))
  assert.equal(byId(moved.history,'cut.'+key).payload.sourceSketchId,source);
const undo=runtime.undo(moved.history,moved.eventIds.map((_,i)=>'undo.drag.'+i));
assert.deepEqual(byId(undo,'cut.slot').dependsOn,['extrude.manifold','sketch.slot']);
const redo=runtime.redo(undo,moved.eventIds.map((_,i)=>'redo.drag.'+i));
assert.deepEqual(byId(redo,'cut.slot').dependsOn,['cut.vent','sketch.slot']);
history=runtime.reopen(runtime.save(redo));
const edit=editExtrudeThickness(history,{eventId:'edit.manifold.depth',
  featureId:'extrude.manifold',expectedRevision:history.document.revision,
  thicknessMm:15},services);
assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.slot'));
assert.ok(!edit.invalidation.invalidatedFeatureIds.includes('extrude.clamp'));
history=runtime.reopen(runtime.save(edit.history));
assert.equal(byId(history,'extrude.manifold').payload.thicknessMm,15);
assert.equal(byId(history,'extrude.clamp').payload.thicknessMm,4);
assert.equal(cutChain.inspectBodyCutChain(history.document,'body.manifold').eligibleAfterWriterId,
  'cut.slot');
console.log(JSON.stringify({kind:'real_SKETCH_INTENT_RUNTIME_consumer',
  part:'four-pocket stepped valve manifold and independent clamp',
  originalRevision,finalRevision:history.document.revision,
  writerOrderBefore:moved.writerOrderBefore,writerOrderAfter:moved.writerOrderAfter,
  swapSteps:moved.swapSteps.length,eventCount:moved.eventIds.length,
  manifoldDepthMm:15,unchangedClampDepthMm:4,
  invalidated:moved.invalidation.invalidatedFeatureIds,
  undoRedoArchive:'passed',invalidSelections:'refused_before_mutation',
  exactAuthority:false,independentInteroperability:false,
  nativeBrep:'not_executed',step:'not_executed'},null,2));
