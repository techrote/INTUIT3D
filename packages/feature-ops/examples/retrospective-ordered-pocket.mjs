/**
 * Real INTENT/SKETCH/RUNTIME consumer: edit a nonterminal blind pocket after
 * authoring its dependent final cut. Geometry remains pending native provider.
 * Run: node --experimental-strip-types packages/feature-ops/examples/retrospective-ordered-pocket.mjs
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
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION}
  from '../src/ordered-cut.mjs';
import {reconfigureOrderedCutExtent,ORDERED_CUT_EXTENT_EDIT_FORMAT,
  ORDERED_CUT_EXTENT_EDIT_VERSION} from '../src/ordered-cut-extent-edit.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
  archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain};
function polygon(label,coordinates){
  const points=coordinates.map(([x,y],n)=>({id:label+'.p'+n,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,n)=>({id:label+'.e'+n,start:p.id,
      end:points[(n+1)%points.length].id})),
    circles:[],constraints:points.map(p=>({id:'fix.'+p.id,kind:'fixed',
      point:p.id,x:p.x,y:p.y}))});
}
const shapes=[
  ['sketch.bracket',polygon('bracket',[[0,0],[120,0],[120,25],
    [30,25],[30,80],[0,80]])],
  ['sketch.slot',polygon('slot',[[10,8],[40,8],[40,18],[10,18]])],
  ['sketch.pocket',polygon('pocket',[[10,35],[23,35],[23,60],[10,60]])],
  ['sketch.spacer',polygon('spacer',[[0,0],[40,0],[40,20],[0,20]])]
];
const selected=Object.fromEntries(shapes.map(([key,doc])=>{
  const found=discovery.discoverPlateProfiles(doc);
  assert.equal(found.status,'ready');
  assert.equal(found.candidates.length,1);
  return [key,found.candidates[0].id];
}));
let h=transactions.startUndoHistory(model.newProject('retrospective.pocket.consumer'));
h=runtime.commit(h,shapes.map(([key,doc])=>({eventId:'make.'+key,
  type:'feature.create',feature:{id:key,kind:'sketch',dependsOn:[],
    writeTargets:[],payload:{sketch:doc}}})),h.document.revision);
function extrude(sketchId,featureId,bodyId,depthMm){
  h=authorProfileExtrusion(h,{format:PROFILE_OPS_FORMAT,
    version:PROFILE_OPS_VERSION,eventId:'make.'+featureId,
    expectedRevision:h.document.revision,sourceSketchId:sketchId,
    profileCandidateId:selected[sketchId],extrudeFeatureId:featureId,
    outputBodyId:bodyId,depthMm,units:'mm',frame:'local_xy'},services).history;
}
extrude('sketch.bracket','extrude.bracket','body.bracket',8);
extrude('sketch.spacer','extrude.spacer','body.spacer',5);
h=authorProfileBodyCut(h,{format:PROFILE_OPS_FORMAT,
  version:PROFILE_OPS_VERSION,eventId:'make.cut.slot',
  expectedRevision:h.document.revision,sourceSketchId:'sketch.slot',
  profileCandidateId:selected['sketch.slot'],extrudeFeatureId:'extrude.bracket',
  cutFeatureId:'cut.slot',targetBodyId:'body.bracket',
  units:'mm',frame:'local_xy'},services).history;
function append(cutFeatureId,afterBodyWriterId,extent,eventId){
  h=appendOrderedProfileCut(h,{format:ORDERED_CUT_FORMAT,
    version:ORDERED_CUT_VERSION,expectedProjectId:h.document.projectId,
    expectedRevision:h.document.revision,eventId,
    units:'mm',frame:'local_xy',sourceSketchId:'sketch.pocket',
    profileCandidateId:selected['sketch.pocket'],
    afterBodyWriterId,targetBodyId:'body.bracket',cutFeatureId,extent},
    services).history;
}
append('cut.pocket','cut.slot',{kind:'blind',depthMm:3},'make.cut.pocket');
append('cut.finish','cut.pocket',{kind:'through_all'},'make.cut.finish');
const initial=h,initialRevision=h.document.revision;
function request(fromExtent,toExtent,eventId){
  return {format:ORDERED_CUT_EXTENT_EDIT_FORMAT,
    version:ORDERED_CUT_EXTENT_EDIT_VERSION,
    expectedProjectId:h.document.projectId,
    expectedRevision:h.document.revision,eventId,
    units:'mm',frame:'local_xy',cutFeatureId:'cut.pocket',
    targetBodyId:'body.bracket',
    from:{afterBodyWriterId:'cut.slot',sourceSketchId:'sketch.pocket',
      profileCandidateId:selected['sketch.pocket'],extent:fromExtent},
    toExtent};
}
const deep=JSON.stringify(initial.document);
for(const mutation of [
  r=>({...r,expectedRevision:r.expectedRevision-1}),
  r=>({...r,targetBodyId:'body.spacer'}),
  r=>({...r,from:{...r.from,afterBodyWriterId:'extrude.bracket'}}),
  r=>({...r,toExtent:{kind:'blind',depthMm:0}})
]){
  assert.throws(()=>reconfigureOrderedCutExtent(h,mutation(request(
    {kind:'blind',depthMm:3},{kind:'blind',depthMm:5},'invalid.pocket'
  )),services));
  assert.equal(JSON.stringify(initial.document),deep);
}
const edit=reconfigureOrderedCutExtent(h,request(
  {kind:'blind',depthMm:3},{kind:'blind',depthMm:5},'edit.pocket.3to5'),services);
assert.equal(edit.status,'blocked_dependency');
assert.equal(edit.history.undoStack.length,h.undoStack.length+1);
assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.pocket'));
assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.finish'));
assert.ok(!edit.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
h=edit.history;
const oneUndo=runtime.undo(h,['undo.pocket.5']);
assert.equal(cutChain.inspectBodyCutExtent(oneUndo.document,'cut.pocket',
  'body.bracket').extent.depthMm,3);
h=runtime.redo(oneUndo,['redo.pocket.5']);
assert.equal(cutChain.inspectBodyCutExtent(h.document,'cut.pocket',
  'body.bracket').extent.depthMm,5);
const through=reconfigureOrderedCutExtent(h,request(
  {kind:'blind',depthMm:5},{kind:'through_all'},'edit.pocket.through'),services);
h=through.history;
assert.deepEqual(cutChain.inspectBodyCutExtent(h.document,'cut.pocket',
  'body.bracket').extent,{kind:'through_all'});
h=runtime.reopen(runtime.save(h));
const thickness=editExtrudeThickness(h,{eventId:'edit.bracket.8to12',
  featureId:'extrude.bracket',expectedRevision:h.document.revision,
  thicknessMm:12},services);
h=runtime.reopen(runtime.save(thickness.history));
const features=model.featuresOf(h.document);
const byId=id=>features.find(f=>f.id===id);
assert.equal(byId('extrude.bracket').payload.thicknessMm,12);
assert.equal(byId('extrude.spacer').payload.thicknessMm,5);
assert.deepEqual(byId('cut.pocket').dependsOn,['cut.slot','sketch.pocket']);
assert.deepEqual(byId('cut.finish').dependsOn,['cut.pocket','sketch.pocket']);
assert.deepEqual(cutChain.inspectBodyCutExtent(h.document,'cut.pocket',
  'body.bracket').extent,{kind:'through_all'});
assert.equal(cutChain.inspectBodyCutChain(h.document,'body.bracket')
  .eligibleAfterWriterId,'cut.finish');
assert.ok(thickness.invalidation.invalidatedFeatureIds.includes('cut.finish'));
assert.ok(!thickness.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
const finalReport=runtime.inspect(h);
assert.equal(finalReport.features.find(f=>f.featureId==='cut.pocket').status,
  'blocked_dependency');
assert.equal(finalReport.features.find(f=>f.featureId==='cut.finish').status,
  'blocked_dependency');
assert.equal(finalReport.features.find(f=>f.featureId==='extrude.spacer').status,
  'preview_only');
console.log(JSON.stringify({
  consumer:'real_intent_sketch_runtime',
  initialRevision,finalRevision:h.document.revision,
  pocketRevisionEdit:{fromMm:3,toMm:5,throughAll:true},
  bracketThicknessMm:12,independentSpacerThicknessMm:5,
  terminalCutId:'cut.finish',
  cutLineage:byId('cut.finish').dependsOn,
  pocketStatus:finalReport.features.find(f=>f.featureId==='cut.pocket').status,
  terminalStatus:finalReport.features.find(f=>f.featureId==='cut.finish').status,
  invalidatedByPocketEdit:edit.invalidation.invalidatedFeatureIds,
  invalidatedByThicknessEdit:thickness.invalidation.invalidatedFeatureIds,
  undoRedoArchive:'passed',negativeSelections:'rejected_before_commit',
  exactAuthority:false,independentInteroperability:false,
  nativeBrep:'not_executed',step:'not_executed'
},null,2));
