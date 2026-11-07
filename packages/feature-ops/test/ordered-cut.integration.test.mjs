import test from 'node:test';
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
import {authorProfileExtrusion,authorProfileBodyCut,PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION,editExtrudeThickness} from '../src/index.mjs';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION} from '../src/ordered-cut.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain};
function polygon(label,coordinates) {
  const points=coordinates.map(([x,y],i)=>({id:label+'.p'+i,x,y}));
  const lines=points.map((p,i)=>({id:label+'.edge'+i,start:p.id,end:points[(i+1)%points.length].id}));
  const constraints=points.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  return sketch.validateSketch({version:1,units:'mm',points,lines,circles:[],constraints});
}
function setup() {
  const sketches=[
    ['sketch.bracket',polygon('bracket',[[0,0],[120,0],[120,25],[30,25],[30,80],[0,80]])],
    ['sketch.slot',polygon('slot',[[10,8],[40,8],[40,18],[10,18]])],
    ['sketch.pocket',polygon('pocket',[[10,35],[23,35],[23,60],[10,60]])],
    ['sketch.spacer',polygon('spacer',[[0,0],[40,0],[40,20],[0,20]])],
  ];
  let history=transactions.startUndoHistory(model.newProject('ordered.cuts.bracket.with.spacer'));
  history=runtime.commit(history,sketches.map(([id,doc])=>({
    eventId:'make.'+id,type:'feature.create',feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}}
  })),history.document.revision);
  const ids=Object.fromEntries(sketches.map(([id,doc])=>{
    const result=discovery.discoverPlateProfiles(doc);
    assert.equal(result.status,'ready');assert.equal(result.candidates.length,1);
    return [id,result.candidates[0].id];
  }));
  function extrude(sketchId,featureId,bodyId,depthMm,eventId) {
    const r=authorProfileExtrusion(history,{
      format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,eventId,
      expectedRevision:history.document.revision,sourceSketchId:sketchId,
      profileCandidateId:ids[sketchId],extrudeFeatureId:featureId,
      outputBodyId:bodyId,depthMm,units:'mm',frame:'local_xy'
    },services);history=r.history;
  }
  extrude('sketch.bracket','extrude.bracket','body.bracket',8,'create.bracket');
  extrude('sketch.spacer','extrude.spacer','body.spacer',5,'create.spacer');
  const first=authorProfileBodyCut(history,{
    format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'create.first.cut',expectedRevision:history.document.revision,
    sourceSketchId:'sketch.slot',profileCandidateId:ids['sketch.slot'],
    extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.slot',
    targetBodyId:'body.bracket',units:'mm',frame:'local_xy'
  },services);
  history=first.history;
  const request={format:ORDERED_CUT_FORMAT,version:ORDERED_CUT_VERSION,
    expectedProjectId:history.document.projectId,expectedRevision:history.document.revision,
    eventId:'create.second.cut',units:'mm',frame:'local_xy',
    sourceSketchId:'sketch.pocket',profileCandidateId:ids['sketch.pocket'],
    afterBodyWriterId:'cut.slot',targetBodyId:'body.bracket',cutFeatureId:'cut.pocket',
    extent:{kind:'blind',depthMm:3}};
  return {history,ids,request};
}
test('real INTENT/SKETCH/RUNTIME second ordered pocket: dependency, retrospective edit, undo/redo and reopen',()=>{
  const {history,request}=setup();
  const result=appendOrderedProfileCut(history,request,services);
  assert.equal(result.kind,'committed');
  assert.equal(result.history.document.revision,history.document.revision+1);
  assert.equal(result.history.undoStack.length,history.undoStack.length+1);
  assert.equal(result.semanticStatus,'ready');
  assert.equal(result.status,'blocked_dependency');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  const cut=model.featuresOf(result.history.document).find(f=>f.id==='cut.pocket');
  assert.deepEqual(cut.dependsOn,['cut.slot','sketch.pocket']);
  assert.deepEqual(cut.writeTargets,['body.bracket']);
  assert.equal(cut.payload.throughAll,false);
  assert.equal(cut.payload.depthMm,3);
  assert.equal(cut.payload.profileCandidateId,request.profileCandidateId);
  assert.equal(cutChain.inspectBodyCutChain(result.history.document,'body.bracket').eligibleAfterWriterId,'cut.pocket');
  assert.equal(runtime.inspect(result.history).features.find(f=>f.featureId==='extrude.spacer').status,'preview_only');
  const undo=runtime.undo(result.history,['undo.cut.pocket']);
  assert.equal(model.featuresOf(undo.document).some(f=>f.id==='cut.pocket'),false);
  const redo=runtime.redo(undo,['redo.cut.pocket']);
  const reopened=runtime.reopen(runtime.save(redo));
  assert.equal(cutChain.inspectBodyCutChain(reopened.document,'body.bracket').eligibleAfterWriterId,'cut.pocket');
  const edit=editExtrudeThickness(reopened,{eventId:'edit.bracket.depth',
    featureId:'extrude.bracket',expectedRevision:reopened.document.revision,thicknessMm:12},services);
  assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.pocket'));
  assert.ok(edit.invalidation.invalidatedFeatureIds.includes('cut.slot'));
  assert.ok(!edit.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
  assert.equal(runtime.inspect(runtime.reopen(runtime.save(edit.history))).features
    .find(f=>f.featureId==='cut.pocket').status,'blocked_dependency');
});
test('explicit through-all extent retains second-cut source, no native exactness claim',()=>{
  const {history,request}=setup();
  const result=appendOrderedProfileCut(history,{...request,extent:{kind:'through_all'}},services);
  assert.equal(result.status,'blocked_dependency');
  const cut=model.featuresOf(result.history.document).find(f=>f.id==='cut.pocket');
  assert.equal(cut.payload.throughAll,true);
  assert.equal(cut.payload.depthMm,undefined);
});
test('stale selection, wrong body, nonterminal writer, invalid depth all refuse pre-commit',()=>{
  const {history,request}=setup();
  const old=JSON.stringify(history.document);
  for(const patch of [
    {expectedRevision:request.expectedRevision-1},
    {expectedProjectId:'different.project'},
    {units:'cm'},{frame:'world_xy'},
    {profileCandidateId:'cycle:obsolete'},
    {afterBodyWriterId:'extrude.bracket'},
    {targetBodyId:'body.spacer'},
    {cutFeatureId:'cut.slot'},
    {sourceSketchId:'sketch.unknown'},
    {extent:{kind:'blind',depthMm:0}},
    {extent:{kind:'blind',depthMm:Infinity}},
    {extent:{kind:'through_all',depthMm:3}},
  ]) {
    assert.throws(()=>appendOrderedProfileCut(history,{...request,...patch},services));
    assert.equal(JSON.stringify(history.document),old);
  }
});
test('required INTENT chain service cannot be replaced by inferred body order',()=>{
  const {history,request}=setup();
  assert.throws(()=>appendOrderedProfileCut(history,request,{...services,cutChain:null}),/accepted INTENT/);
});

test('standalone Node consumer runs with actual accepted packages and archive',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const script=fileURLToPath(new URL('../examples/ordered-pocket-bracket.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',script],{
    encoding:'utf8',timeout:20000,maxBuffer:1024*1024
  });
  assert.equal(run.status,0,run.stderr||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.semanticBodyTerminal,'cut.pocket');
  assert.equal(result.pocketDepthMm,3);
  assert.equal(result.afterEditThicknessMm,12);
  assert.equal(result.independentSpacerThicknessMm,5);
  assert.equal(result.pocketRuntimeStatus,'blocked_dependency');
  assert.equal(result.exactAuthority,false);
});
