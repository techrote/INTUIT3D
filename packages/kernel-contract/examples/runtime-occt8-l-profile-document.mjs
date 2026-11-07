/**
 * Actual accepted INTENT -> SKETCH -> FEATUREOPS -> RUNTIME L-bracket fixture.
 * The centered sketch matches the supported pinned C++ v3 local XY subset.
 * No synthetic evaluation reports and no second document authority.
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

export const MODEL_L_BODY_ID='body.bracket';
export const MODEL_L_CUT_IDS=['cut.window','cut.pocket'];
export const MODEL_L_FIXTURE_VERSION=1;

function polygon(key,coordinates) {
  const points=coordinates.map(([x,y],i)=>({id:key+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:key+'.e'+i,start:p.id,
      end:points[(i+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:'fixed.'+p.id,kind:'fixed',
      point:p.id,x:p.x,y:p.y}))});
}

/**
 * Produce a real journal, including an independent spacer whose evaluations
 * must not invalidate when the bracket extrusion depth changes.
 */
export function buildAuthoredLBracket() {
  const runtime=createWorkflowRuntime({
    model,transactions,bindings,dimensions,archive,sketch,discovery,
  });
  const services={runtime,model,sketch,discovery,cutChain};
  const fmt={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    units:'mm',frame:'local_xy'};
  const source=new Map([
    ['sketch.bracket',polygon('bracket',[
      [-60,-40],[60,-40],[60,-20],[-30,-20],[-30,40],[-60,40]])],
    ['sketch.window',polygon('window',[
      [10,-34],[20,-34],[20,-26],[10,-26]])],
    ['sketch.pocket',polygon('pocket',[
      [-49,5],[-41,5],[-41,15],[-49,15]])],
    ['sketch.spacer',polygon('spacer',[
      [0,0],[40,0],[40,20],[0,20]])],
  ]);
  const candidate=id=>{
    const result=discovery.discoverPlateProfiles(source.get(id));
    assert.equal(result.status,'ready','unsolved '+id);
    assert.equal(result.candidates.length,1,'ambiguous profile '+id);
    return result.candidates[0].id;
  };
  let history=transactions.startUndoHistory(model.newProject('native.l.bracket'));
  history=runtime.commit(history,[...source].map(([id,doc])=>({
    eventId:'make.'+id,type:'feature.create',feature:{
      id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc},
    },
  })),history.document.revision);
  for(const [sourceSketchId,extrudeFeatureId,outputBodyId,depthMm] of [
    ['sketch.bracket','extrude.bracket',MODEL_L_BODY_ID,8],
    ['sketch.spacer','extrude.spacer','body.spacer',5],
  ]) {
    history=authorProfileExtrusion(history,{...fmt,
      eventId:'make.'+extrudeFeatureId,
      expectedRevision:history.document.revision,
      sourceSketchId,profileCandidateId:candidate(sourceSketchId),
      extrudeFeatureId,outputBodyId,depthMm},services).history;
  }
  history=authorProfileBodyCut(history,{...fmt,
    eventId:'make.cut.window',expectedRevision:history.document.revision,
    sourceSketchId:'sketch.window',profileCandidateId:candidate('sketch.window'),
    extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.window',
    targetBodyId:MODEL_L_BODY_ID},services).history;
  const append=cutChain.previewBodyCutAppend(history.document,{
    format:cutChain.BODY_CUT_CHAIN_FORMAT,
    version:cutChain.BODY_CUT_CHAIN_VERSION,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'make.cut.pocket',sourceSketchId:'sketch.pocket',
    profileCandidateId:candidate('sketch.pocket'),
    afterBodyWriterId:'cut.window',cutFeatureId:'cut.pocket',
    targetBodyId:MODEL_L_BODY_ID,extent:{kind:'blind',depthMm:3},
    admission:'require_ready',
  });
  assert.equal(append.semanticStatus,'ready');
  history=runtime.commit(history,[append.event],history.document.revision);
  return {history,runtime,model,services};
}

export function editAuthoredLBracketThickness(fixture,thicknessMm) {
  const result=editExtrudeThickness(fixture.history,{
    eventId:'edit.thickness.'+thicknessMm,
    expectedRevision:fixture.history.document.revision,
    featureId:'extrude.bracket',thicknessMm,
  },fixture.services);
  return {...fixture,history:result.history,invalidation:result.invalidation};
}
