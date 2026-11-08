/**
 * Actual model/constraint/selected-profile authoring for diagonal six-edge CAD.
 * No fake RUNTIME evidence or unqualified native mesh substituted.
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
import {requestFromRuntimeOcct8Linear} from '../src/runtime-occt8-linear-profile-provider.mjs';

export const SLOPED_BODY_ID='body.sloped';
export const SLOPED_CUT_IDS=['cut.sloped.through','cut.sloped.blind'];

function polygon(id,xy){
  const points=xy.map(([x,y],i)=>({id:id+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:id+'.edge'+i,start:p.id,
      end:points[(i+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:'fixed.'+p.id,kind:'fixed',
      point:p.id,x:p.x,y:p.y}))});
}
export function buildAuthoredSlopedBracket({cutCount=2}={}){
  assert.ok(Number.isInteger(cutCount)&&cutCount>=0&&cutCount<=2,
    "only the authored zero/one/two cut demonstration is supported");
  const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
    archive,sketch,discovery});
  const services={runtime,model,sketch,discovery,cutChain};
  const source=new Map([
    ['sketch.sloped',polygon('sloped',[
      [0,0],[120,0],[120,20],[65,20],[45,80],[0,80]])],
    ['sketch.sloped.window',polygon('slopedWindow',[
      [88,6],[102,6],[102,14],[88,14]])],
    ['sketch.sloped.pocket',polygon('slopedPocket',[
      [10,45],[20,45],[20,55],[10,55]])],
  ]);
  const select=id=>{
    const resolved=discovery.discoverPlateProfiles(source.get(id));
    assert.equal(resolved.status,'ready','unsolved '+id);
    assert.equal(resolved.candidates.length,1,'ambiguous '+id);
    return resolved.candidates[0].id;
  };
  let history=transactions.startUndoHistory(model.newProject('native.sloped.bracket'));
  history=runtime.commit(history,[...source].map(([id,doc])=>({
    eventId:'make.'+id,type:'feature.create',feature:{
      id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc},
    },
  })),history.document.revision);
  const fmt={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    units:'mm',frame:'local_xy'};
  history=authorProfileExtrusion(history,{...fmt,
    eventId:'make.extrude.sloped',expectedRevision:history.document.revision,
    sourceSketchId:'sketch.sloped',profileCandidateId:select('sketch.sloped'),
    extrudeFeatureId:'extrude.sloped',outputBodyId:SLOPED_BODY_ID,depthMm:8},
    services).history;
  if(cutCount>=1) history=authorProfileBodyCut(history,{...fmt,
    eventId:'make.cut.sloped.through',expectedRevision:history.document.revision,
    sourceSketchId:'sketch.sloped.window',
    profileCandidateId:select('sketch.sloped.window'),
    extrudeFeatureId:'extrude.sloped',cutFeatureId:SLOPED_CUT_IDS[0],
    targetBodyId:SLOPED_BODY_ID},services).history;
  if(cutCount>=2){
  const append=cutChain.previewBodyCutAppend(history.document,{
    format:cutChain.BODY_CUT_CHAIN_FORMAT,
    version:cutChain.BODY_CUT_CHAIN_VERSION,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'make.cut.sloped.blind',sourceSketchId:'sketch.sloped.pocket',
    profileCandidateId:select('sketch.sloped.pocket'),
    afterBodyWriterId:SLOPED_CUT_IDS[0],cutFeatureId:SLOPED_CUT_IDS[1],
    targetBodyId:SLOPED_BODY_ID,extent:{kind:'blind',depthMm:3},
    admission:'require_ready',
  });
  assert.equal(append.semanticStatus,'ready');
  history=runtime.commit(history,[append.event],history.document.revision);
  }
  if(cutCount===2){
  const q=requestFromRuntimeOcct8Linear(history,SLOPED_BODY_ID,{
    runtime,model,requestId:'native.sloped.initial',exportStep:false,
  });
  assert.deepEqual(q.cuts.map(c=>c.featureId),SLOPED_CUT_IDS);
  }
  return {history,runtime,model,services};
}
export function editAuthoredSlopedThickness(fixture,thicknessMm){
  const result=editExtrudeThickness(fixture.history,{
    eventId:'edit.sloped.thickness.'+fixture.history.document.revision,
    expectedRevision:fixture.history.document.revision,
    featureId:'extrude.sloped',thicknessMm,
  },fixture.services);
  requestFromRuntimeOcct8Linear(result.history,SLOPED_BODY_ID,{
    runtime:fixture.runtime,model:fixture.model,
    requestId:'native.sloped.edited',exportStep:false,
  });
  return {...fixture,history:result.history,invalidation:result.invalidation};
}
