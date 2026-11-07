/**
 * Real local mechanical consumer of FEATUREOPS multi-feature-dimensions/v1.
 * A stepped air-valve housing and removable cap receive simultaneous dimension
 * edits, including independent body chains; a third spacer stays unchanged.
 * No B-rep, STEP or exact OCCT execution is attempted by this example.
 */
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as cutChain from '@intuit3d/model/body-cut-chain';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION}
  from '../src/index.mjs';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION}
  from '../src/ordered-cut.mjs';
import {editMultipleBodyDimensions,
  MULTI_FEATURE_DIMENSIONS_FORMAT as FORMAT,
  MULTI_FEATURE_DIMENSIONS_VERSION as VERSION}
  from '../src/multi-feature-dimensions.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
  archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain};
function polygon(prefix,xy){
  const points=xy.map(([x,y],i)=>({id:prefix+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:prefix+'.e'+i,start:p.id,
      end:points[(i+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:prefix+'.fix.'+p.id,kind:'fixed',
      point:p.id,x:p.x,y:p.y}))});
}
const sketches=[
  ['sketch.housing',polygon('housing',[[0,0],[110,0],[110,24],
    [82,24],[82,56],[0,56]])],
  ['sketch.inlet',polygon('inlet',[[12,9],[42,9],[42,19],[12,19]])],
  ['sketch.valve',polygon('valve',[[20,30],[32,30],[32,45],[20,45]])],
  ['sketch.cap',polygon('cap',[[0,0],[58,0],[58,36],[0,36]])],
  ['sketch.capport',polygon('capport',[[13,11],[24,11],[24,23],[13,23]])],
  ['sketch.spacer',polygon('spacer',[[0,0],[18,0],[18,12],[0,12]])]
];
const candidate=Object.fromEntries(sketches.map(([name,source])=>{
  const found=discovery.discoverPlateProfiles(source);
  assert.equal(found.status,'ready',name);
  assert.equal(found.candidates.length,1,name);
  return [name,found.candidates[0].id];
}));
let h=transactions.startUndoHistory(model.newProject('valve.housing.dimension.batch'));
h=runtime.commit(h,sketches.map(([name,doc])=>({
  eventId:'make.'+name,type:'feature.create',
  feature:{id:name,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}}
})),h.document.revision);
function extrude(sketchId,featureId,bodyId,depthMm){
  h=authorProfileExtrusion(h,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'make.'+featureId,expectedRevision:h.document.revision,
    sourceSketchId:sketchId,profileCandidateId:candidate[sketchId],
    extrudeFeatureId:featureId,outputBodyId:bodyId,depthMm,
    units:'mm',frame:'local_xy'},services).history;
}
extrude('sketch.housing','extrude.housing','body.housing',10);
extrude('sketch.cap','extrude.cap','body.cap',6);
extrude('sketch.spacer','extrude.spacer','body.spacer',4);
function cut(featureId,bodyId,afterId,sourceSketchId,extent){
  h=appendOrderedProfileCut(h,{format:ORDERED_CUT_FORMAT,version:ORDERED_CUT_VERSION,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    eventId:'make.'+featureId,units:'mm',frame:'local_xy',
    sourceSketchId,profileCandidateId:candidate[sourceSketchId],
    afterBodyWriterId:afterId,targetBodyId:bodyId,cutFeatureId:featureId,extent},
    services).history;
}
cut('cut.inlet','body.housing','extrude.housing','sketch.inlet',
  {kind:'blind',depthMm:3});
cut('cut.valve','body.housing','cut.inlet','sketch.valve',
  {kind:'blind',depthMm:2});
cut('cut.capport','body.cap','extrude.cap','sketch.capport',
  {kind:'blind',depthMm:2});
const initial=h;
const request={
  format:FORMAT,version:VERSION,expectedProjectId:h.document.projectId,
  expectedRevision:h.document.revision,units:'mm',frame:'local_xy',
  edits:[
    {kind:'extrusion_depth',eventId:'edit.housing.depth',
      extrudeFeatureId:'extrude.housing',targetBodyId:'body.housing',
      sourceSketchId:'sketch.housing',profileCandidateId:candidate['sketch.housing'],
      fromDepthMm:10,toDepthMm:14},
    {kind:'cut_extent',eventId:'edit.inlet.depth',
      cutFeatureId:'cut.inlet',targetBodyId:'body.housing',
      afterBodyWriterId:'extrude.housing',sourceSketchId:'sketch.inlet',
      profileCandidateId:candidate['sketch.inlet'],
      fromExtent:{kind:'blind',depthMm:3},toExtent:{kind:'blind',depthMm:5}},
    {kind:'cut_extent',eventId:'edit.valve.through',
      cutFeatureId:'cut.valve',targetBodyId:'body.housing',
      afterBodyWriterId:'cut.inlet',sourceSketchId:'sketch.valve',
      profileCandidateId:candidate['sketch.valve'],
      fromExtent:{kind:'blind',depthMm:2},toExtent:{kind:'through_all'}},
    {kind:'extrusion_depth',eventId:'edit.cap.depth',
      extrudeFeatureId:'extrude.cap',targetBodyId:'body.cap',
      sourceSketchId:'sketch.cap',profileCandidateId:candidate['sketch.cap'],
      fromDepthMm:6,toDepthMm:9},
    {kind:'cut_extent',eventId:'edit.capport.depth',
      cutFeatureId:'cut.capport',targetBodyId:'body.cap',
      afterBodyWriterId:'extrude.cap',sourceSketchId:'sketch.capport',
      profileCandidateId:candidate['sketch.capport'],
      fromExtent:{kind:'blind',depthMm:2},toExtent:{kind:'blind',depthMm:3}}
  ]
};
for(const change of [
  r=>({...r,expectedRevision:r.expectedRevision-1}),
  r=>({...r,expectedProjectId:'another.project'}),
  r=>({...r,edits:r.edits.map((e,i)=>i===2?{...e,targetBodyId:'body.cap'}:e)}),
  r=>({...r,edits:r.edits.map((e,i)=>i===1?{...e,fromExtent:{kind:'blind',depthMm:4}}:e)}),
  r=>({...r,edits:r.edits.map((e,i)=>i===3?{...e,toDepthMm:0}:e)}),
  r=>({...r,edits:[r.edits[0],{...r.edits[0]}]}),
  r=>({...r,edits:r.edits.map((e,i)=>i===4?{...e,
    profileCandidateId:'cycle:incorrect'}:e)})
]){
  assert.throws(()=>editMultipleBodyDimensions(h,change(request),services));
  assert.deepEqual(h.document,initial.document);
}
const edit=editMultipleBodyDimensions(h,request,services);
assert.equal(edit.history.undoStack.length,h.undoStack.length+1);
assert.equal(edit.history.document.revision,h.document.revision+5);
assert.equal(edit.undoFramesAdded,1);
assert.deepEqual(edit.editedFeatureIds,request.edits.map(e=>
  e.kind==='extrusion_depth'?e.extrudeFeatureId:e.cutFeatureId));
assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.valve'));
assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.capport'));
assert.ok(!edit.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
assert.equal(edit.nativeHandoffs.length,3);
const after=edit.history;
const undo=runtime.undo(after,['undo.dimensions.batch']);
assert.equal(model.featuresOf(undo.document)
  .find(f=>f.id==='extrude.housing').payload.thicknessMm,10);
assert.equal(cutChain.inspectBodyCutExtent(undo.document,'cut.valve','body.housing')
  .extent.depthMm,2);
const redo=runtime.redo(undo,['redo.dimensions.batch']);
assert.equal(model.featuresOf(redo.document)
  .find(f=>f.id==='extrude.housing').payload.thicknessMm,14);
h=runtime.reopen(runtime.save(redo));
const find=id=>model.featuresOf(h.document).find(f=>f.id===id);
assert.equal(find('extrude.housing').payload.thicknessMm,14);
assert.equal(find('extrude.cap').payload.thicknessMm,9);
assert.equal(find('extrude.spacer').payload.thicknessMm,4);
assert.deepEqual(find('cut.valve').dependsOn,['cut.inlet','sketch.valve']);
assert.deepEqual(cutChain.inspectBodyCutExtent(h.document,'cut.valve','body.housing')
  .extent,{kind:'through_all'});
assert.equal(cutChain.inspectBodyCutExtent(h.document,'cut.inlet','body.housing')
  .extent.depthMm,5);
assert.equal(cutChain.inspectBodyCutExtent(h.document,'cut.capport','body.cap')
  .extent.depthMm,3);
assert.equal(cutChain.inspectBodyCutChain(h.document,'body.housing')
  .eligibleAfterWriterId,'cut.valve');
const report=runtime.inspect(h);
assert.equal(report.features.find(f=>f.featureId==='cut.valve').status,
  'blocked_dependency');
assert.equal(report.features.find(f=>f.featureId==='extrude.spacer').status,
  'preview_only');
console.log(JSON.stringify({
  consumer:'real_INTENT_SKETCH_RUNTIME',part:'stepped air-valve housing, removable cap and independent spacer',
  editCount:request.edits.length,undoFrames:1,
  depthsMm:{housing:find('extrude.housing').payload.thicknessMm,
    cap:find('extrude.cap').payload.thicknessMm,
    spacer:find('extrude.spacer').payload.thicknessMm},
  valveExtent:cutChain.inspectBodyCutExtent(h.document,'cut.valve','body.housing').extent,
  dependentInvalidation:edit.invalidation.invalidatedFeatureIds,
  undoRedoArchive:'passed',invalidSelections:'rejected_before_commit',
  status:report.features.find(f=>f.featureId==='cut.valve').status,
  exactAuthority:false,independentInteroperability:false,
  nativeBrep:'not_executed',step:'not_executed'
},null,2));
