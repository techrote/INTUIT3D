/**
 * REAL committed SKETCH/INTENT/FEATUREOPS/RUNTIME two-cut physical replay.
 * Through-window + 3 mm blind pocket on ONE named L-bracket; independent
 * spacer untouched. Experimental OCP 7.9.3.1 only, same-engine STEP readback.
 *
 * node packages/kernel-contract/examples/runtime-ordered-cuts-native.mjs /tmp/FRESH-dir
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
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '@intuit3d/feature-ops';
import {requestFromRuntimeBodyCutChain,runExperimentalRuntimeBodyCutChain}
  from '../src/runtime-body-cut-chain-provider.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain};
const out=resolve(process.argv[2]||'/tmp/intuit3d-ordered-cut-unique');
await mkdir(out,{recursive:true});
const fmt={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,units:'mm',frame:'local_xy'};
const polygon=(key,coords)=>{
  const points=coords.map(([x,y],i)=>({id:key+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:key+'.e'+i,start:p.id,
      end:points[(i+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}))});
};
const source=new Map([
  ['sketch.bracket',polygon('bracket',[[0,0],[120,0],[120,25],[30,25],[30,80],[0,80]])],
  ['sketch.slot',polygon('slot',[[10,8],[40,8],[40,18],[10,18]])],
  ['sketch.pocket',polygon('pocket',[[10,35],[23,35],[23,60],[10,60]])],
  ['sketch.spacer',polygon('spacer',[[0,0],[40,0],[40,20],[0,20]])]
]);
const candidate=id=>{
  const result=discovery.discoverPlateProfiles(source.get(id));
  assert.equal(result.status,'ready');
  assert.equal(result.candidates.length,1);
  return result.candidates[0].id;
};
let history=transactions.startUndoHistory(model.newProject('physical.ordered.cuts'));
history=runtime.commit(history,[...source].map(([id,doc])=>({
  eventId:'make.'+id,type:'feature.create',feature:{
    id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}
  }})),history.document.revision);
for(const [sketchId,featureId,bodyId,depthMm] of [
  ['sketch.bracket','extrude.bracket','body.bracket',8],
  ['sketch.spacer','extrude.spacer','body.spacer',5]]) {
  history=authorProfileExtrusion(history,{...fmt,
    eventId:'make.'+featureId,expectedRevision:history.document.revision,
    sourceSketchId:sketchId,profileCandidateId:candidate(sketchId),
    extrudeFeatureId:featureId,outputBodyId:bodyId,depthMm},services).history;
}
history=authorProfileBodyCut(history,{...fmt,
  eventId:'make.cut.slot',expectedRevision:history.document.revision,
  sourceSketchId:'sketch.slot',profileCandidateId:candidate('sketch.slot'),
  extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.slot',
  targetBodyId:'body.bracket'},services).history;
const append=cutChain.previewBodyCutAppend(history.document,{
  format:cutChain.BODY_CUT_CHAIN_FORMAT,version:cutChain.BODY_CUT_CHAIN_VERSION,
  expectedProjectId:history.document.projectId,expectedRevision:history.document.revision,
  eventId:'make.cut.pocket',sourceSketchId:'sketch.pocket',
  profileCandidateId:candidate('sketch.pocket'),afterBodyWriterId:'cut.slot',
  cutFeatureId:'cut.pocket',targetBodyId:'body.bracket',
  extent:{kind:'blind',depthMm:3},admission:'require_ready'
});
assert.equal(append.semanticStatus,'ready');
history=runtime.commit(history,[append.event],history.document.revision);
assert.equal(model.featuresOf(history.document).find(x=>x.id==='cut.pocket').payload.depthMm,3);
const manifest=[];
async function physicallyCut(label,expectedVolume,expectedThroughDepth){
  const request=requestFromRuntimeBodyCutChain(history,'body.bracket',{
    runtime,model,requestId:'native.'+label,exportStep:true});
  assert.deepEqual(request.cuts.map(x=>x.cutFeatureId),['cut.slot','cut.pocket']);
  assert.deepEqual(request.cuts.map(x=>x.cutDepthMm),[expectedThroughDepth,3]);
  const receipt=await runExperimentalRuntimeBodyCutChain(history,'body.bracket',{
    runtime,model,requestId:request.requestId,
    readCurrentRevision:()=>history.document.revision,
    stepOutput:join(out,label+'.step'),
    pythonExecutable:process.env.INTUIT3D_OCP_PYTHON||
      (process.platform==='win32'?'python':'python3')
  });
  assert.equal(receipt.kind,'experimental_body_cut_chain_brep',
    JSON.stringify(receipt));
  assert.equal(receipt.exactAuthority,false);
  assert.equal(receipt.independentInteroperability,false);
  assert.equal(receipt.targetBodyId,'body.bracket');
  assert.equal(receipt.source.solidCount,1);
  assert.ok(Math.abs(receipt.source.volumeMm3-expectedVolume)<1e-6);
  assert.ok(Math.abs(receipt.stepReadback.volumeMm3-expectedVolume)<1e-6);
  assert.deepEqual(receipt.cutResults.map(x=>x.cutFeatureId),['cut.slot','cut.pocket']);
  manifest.push({label,revision:history.document.revision,volumeMm3:receipt.source.volumeMm3,
    sha256:receipt.artifact.sha256,bytes:receipt.artifact.bytes,
    cutDepths:receipt.cutResults.map(x=>x.cutDepthMm)});
}
await physicallyCut('initial-8mm',33825,8);
const edited=editExtrudeThickness(history,{eventId:'edit.thickness',
  expectedRevision:history.document.revision,featureId:'extrude.bracket',
  thicknessMm:12},services);
for(const featureId of ['extrude.bracket','cut.slot','cut.pocket'])
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes(featureId));
assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
history=runtime.reopen(runtime.save(edited.history));
await physicallyCut('edited-12mm',51225,12);
assert.notEqual(manifest[0].sha256,manifest[1].sha256);
const undo=runtime.undo(edited.history,['undo.thickness']);
const redo=runtime.redo(undo,['redo.thickness']);
assert.equal(requestFromRuntimeBodyCutChain(redo,'body.bracket',{
  runtime,model,requestId:'native.redo',exportStep:false
}).baseExtrude.thicknessMm,12);
await writeFile(join(out,'history.json'),runtime.save(history),{flag:'wx'});
await writeFile(join(out,'manifest.json'),JSON.stringify({
  provider:'real-experimental-OCP-7.9.3.1',
  exactAuthority:false,independentCadInterop:false,pinnedOcct8Cxx:false,
  bodyId:'body.bracket',independentBodyId:'body.spacer',
  invalidated:edited.invalidation.invalidatedFeatureIds,
  generated:manifest
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'EXPERIMENTAL_RUNTIME_ORDERED_TWO_CUT_STEP_PASS',
  bodyId:'body.bracket',generated:manifest},null,2));
