/**
 * Real SKETCH/INTENT/RUNTIME consumer: reorders actual dependency execution
 * of a through-slot and a blind pocket in a stepped valve manifold.
 * Also tests a third cut, independent clamp, undo/redo, save/reopen and
 * retrospective depth edit. No B-rep or STEP is executed here.
 */
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
import {swapOrderedBodyCuts,ORDERED_CUT_SWAP_FORMAT,ORDERED_CUT_SWAP_VERSION}
  from '../src/ordered-cut-swap.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
  archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain,cutOrder};
function polygon(label,vertices){
  const points=vertices.map(([x,y],i)=>({id:label+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:label+'.e'+i,start:p.id,
      end:points[(i+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}))});
}
const sketches=[
  ['sketch.manifold',polygon('housing',[[-65,-40],[65,-40],[65,0],
    [15,0],[15,45],[-65,45]])],
  ['sketch.slot',polygon('slot',[[-48,-27],[-8,-27],[-8,-14],[-48,-14]])],
  ['sketch.pocket',polygon('pocket',[[-48,9],[-23,9],[-23,30],[-48,30]])],
  ['sketch.window',polygon('window',[[-59,-7],[-52,-7],[-52,6],[-59,6]])],
  ['sketch.clamp',polygon('clamp',[[0,0],[45,0],[45,17],[0,17]])]
];
const selections=Object.fromEntries(sketches.map(([id,s])=>{
  const d=discovery.discoverPlateProfiles(s);
  assert.equal(d.status,'ready',JSON.stringify(d.rejected));
  assert.equal(d.candidates.length,1);
  return [id,d.candidates[0].id];
}));
let history=transactions.startUndoHistory(model.newProject('manifold.cut.resequencing'));
history=runtime.commit(history,sketches.map(([id,s])=>({eventId:'make.'+id,
  type:'feature.create',feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:s}}})),history.document.revision);
function extrude(sourceSketchId,extrudeFeatureId,outputBodyId,depthMm){
  history=authorProfileExtrusion(history,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'make.'+extrudeFeatureId,expectedRevision:history.document.revision,
    sourceSketchId,profileCandidateId:selections[sourceSketchId],
    extrudeFeatureId,outputBodyId,depthMm,units:'mm',frame:'local_xy'},services).history;
}
extrude('sketch.manifold','extrude.manifold','body.manifold',9);
extrude('sketch.clamp','extrude.clamp','body.clamp',4);
function append(cutFeatureId,afterBodyWriterId,sourceSketchId,extent){
  history=appendOrderedProfileCut(history,{format:ORDERED_CUT_FORMAT,
    version:ORDERED_CUT_VERSION,expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,eventId:'make.'+cutFeatureId,
    units:'mm',frame:'local_xy',sourceSketchId,
    profileCandidateId:selections[sourceSketchId],afterBodyWriterId,
    targetBodyId:'body.manifold',cutFeatureId,extent},services).history;
}
append('cut.slot','extrude.manifold','sketch.slot',{kind:'through_all'});
append('cut.pocket','cut.slot','sketch.pocket',{kind:'blind',depthMm:3});
append('cut.window','cut.pocket','sketch.window',{kind:'through_all'});
const initialRevision=history.document.revision,initial=history;
function selection(cutFeatureId,sourceSketchId,extent){
  return {cutFeatureId,sourceSketchId,profileCandidateId:selections[sourceSketchId],extent};
}
const request={format:ORDERED_CUT_SWAP_FORMAT,version:ORDERED_CUT_SWAP_VERSION,
  expectedProjectId:history.document.projectId,expectedRevision:history.document.revision,
  units:'mm',frame:'local_xy',targetBodyId:'body.manifold',
  firstCutFeatureId:'cut.slot',secondCutFeatureId:'cut.pocket',
  expectedWriterOrder:['extrude.manifold','cut.slot','cut.pocket','cut.window'],
  cutSelections:[
    selection('cut.slot','sketch.slot',{kind:'through_all'}),
    selection('cut.pocket','sketch.pocket',{kind:'blind',depthMm:3})],
  eventIds:['swap.pocket','swap.slot','swap.window']};
for(const bad of [
  {...request,expectedRevision:request.expectedRevision-1},
  {...request,targetBodyId:'body.clamp'},
  {...request,firstCutFeatureId:'cut.window'},
  {...request,cutSelections:[request.cutSelections[0],{
    ...request.cutSelections[1],extent:{kind:'blind',depthMm:5}}]},
]){
  assert.throws(()=>swapOrderedBodyCuts(history,bad,services));
  assert.equal(history.document.revision,initialRevision);
}
const result=swapOrderedBodyCuts(history,request,services);
assert.equal(result.kind,'committed');
assert.equal(result.history.undoStack.length,initial.undoStack.length+1);
assert.deepEqual(result.writerOrderAfter,
  ['extrude.manifold','cut.pocket','cut.slot','cut.window']);
assert.ok(result.invalidation.invalidatedFeatureIds.includes('cut.window'));
assert.ok(!result.invalidation.invalidatedFeatureIds.includes('extrude.clamp'));
history=result.history;
const byId=(h,id)=>model.featuresOf(h.document).find(f=>f.id===id);
assert.deepEqual(byId(history,'cut.pocket').dependsOn,['extrude.manifold','sketch.pocket']);
assert.deepEqual(byId(history,'cut.slot').dependsOn,['cut.pocket','sketch.slot']);
assert.deepEqual(byId(history,'cut.window').dependsOn,['cut.slot','sketch.window']);
const undo=runtime.undo(history,['undo.swap.pocket','undo.swap.slot','undo.swap.window']);
assert.deepEqual(byId(undo,'cut.pocket').dependsOn,['cut.slot','sketch.pocket']);
const redo=runtime.redo(undo,['redo.swap.pocket','redo.swap.slot','redo.swap.window']);
assert.deepEqual(byId(redo,'cut.slot').dependsOn,['cut.pocket','sketch.slot']);
history=runtime.reopen(runtime.save(redo));
const edit=editExtrudeThickness(history,{eventId:'edit.manifold.depth',
  featureId:'extrude.manifold',expectedRevision:history.document.revision,
  thicknessMm:15},services);
assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.window'));
assert.ok(!edit.invalidation.invalidatedFeatureIds.includes('extrude.clamp'));
history=runtime.reopen(runtime.save(edit.history));
assert.equal(byId(history,'extrude.manifold').payload.thicknessMm,15);
assert.equal(byId(history,'extrude.clamp').payload.thicknessMm,4);
assert.deepEqual(byId(history,'cut.window').dependsOn,['cut.slot','sketch.window']);
assert.equal(byId(history,'cut.pocket').payload.depthMm,3);
assert.equal(cutChain.inspectBodyCutChain(history.document,'body.manifold').eligibleAfterWriterId,
  'cut.window');
console.log(JSON.stringify({kind:'real_SKETCH_INTENT_RUNTIME_consumer',
  part:'stepped valve manifold plus independent clamp',
  initialRevision,finalRevision:history.document.revision,
  writerOrderBefore:result.writerOrderBefore,writerOrderAfter:result.writerOrderAfter,
  downstreamCut:'cut.window',manifoldDepthMm:15,unchangedClampDepthMm:4,
  cutStatuses:result.statuses,
  invalidatedAfterSwap:result.invalidation.invalidatedFeatureIds,
  undoRedoArchive:'passed',negativeSelections:'rejected_before_commit',
  exactAuthority:false,independentInteroperability:false,
  nativeBrep:'not_executed',step:'not_executed'},null,2));