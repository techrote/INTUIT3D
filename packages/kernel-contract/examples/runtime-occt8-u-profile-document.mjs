/**
 * Actual INTENT -> SKETCH -> FEATUREOPS -> RUNTIME eight-edge U-bracket fixture.
 * The concave U source is solver-admitted and consumed unchanged by pinned C++ v4.
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

export const MODEL_U_BODY_ID='body.u';
export const MODEL_U_CUT_IDS=['cut.right.window','cut.left.pocket'];
export const MODEL_U_FIXTURE_VERSION=1;

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
export function buildAuthoredUBracket() {
  const runtime=createWorkflowRuntime({
    model,transactions,bindings,dimensions,archive,sketch,discovery,
  });
  const services={runtime,model,sketch,discovery,cutChain};
  const fmt={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    units:'mm',frame:'local_xy'};
  const source=new Map([
    ['sketch.u',polygon('bracket',[
      [-60,-40],[60,-40],[60,40],[35,40],[35,-10],[-35,-10],[-35,40],[-60,40]])],
    ['sketch.right.window',polygon('window',[
      [42,4],[52,4],[52,16],[42,16]])],
    ['sketch.left.pocket',polygon('pocket',[
      [-51,5],[-43,5],[-43,15],[-51,15]])],
    ['sketch.spacer',polygon('spacer',[
      [0,0],[40,0],[40,20],[0,20]])],
  ]);
  const candidate=id=>{
    const result=discovery.discoverPlateProfiles(source.get(id));
    assert.equal(result.status,'ready','unsolved '+id);
    assert.equal(result.candidates.length,1,'ambiguous profile '+id);
    return result.candidates[0].id;
  };
  let history=transactions.startUndoHistory(model.newProject('native.u.bracket'));
  history=runtime.commit(history,[...source].map(([id,doc])=>({
    eventId:'make.'+id,type:'feature.create',feature:{
      id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc},
    },
  })),history.document.revision);
  for(const [sourceSketchId,extrudeFeatureId,outputBodyId,depthMm] of [
    ['sketch.u','extrude.u',MODEL_U_BODY_ID,8],
    ['sketch.spacer','extrude.spacer','body.spacer',5],
  ]) {
    history=authorProfileExtrusion(history,{...fmt,
      eventId:'make.'+extrudeFeatureId,
      expectedRevision:history.document.revision,
      sourceSketchId,profileCandidateId:candidate(sourceSketchId),
      extrudeFeatureId,outputBodyId,depthMm},services).history;
  }
  history=authorProfileBodyCut(history,{...fmt,
    eventId:'make.cut.right.window',expectedRevision:history.document.revision,
    sourceSketchId:'sketch.right.window',profileCandidateId:candidate('sketch.right.window'),
    extrudeFeatureId:'extrude.u',cutFeatureId:'cut.right.window',
    targetBodyId:MODEL_U_BODY_ID},services).history;
  const append=cutChain.previewBodyCutAppend(history.document,{
    format:cutChain.BODY_CUT_CHAIN_FORMAT,
    version:cutChain.BODY_CUT_CHAIN_VERSION,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'make.cut.left.pocket',sourceSketchId:'sketch.left.pocket',
    profileCandidateId:candidate('sketch.left.pocket'),
    afterBodyWriterId:'cut.right.window',cutFeatureId:'cut.left.pocket',
    targetBodyId:MODEL_U_BODY_ID,extent:{kind:'blind',depthMm:3},
    admission:'require_ready',
  });
  assert.equal(append.semanticStatus,'ready');
  history=runtime.commit(history,[append.event],history.document.revision);
  return {history,runtime,model,services};
}



/**
 * Retrospectively change the authored U-bracket extrusion thickness without
 * mutating solved profile IDs, ordered cut IDs or the unrelated spacer.
 */
export function editAuthoredUBracketThickness(fixture,thicknessMm) {
  const result=editExtrudeThickness(fixture.history,{
    eventId:'edit.u.thickness.'+fixture.history.document.revision,
    expectedRevision:fixture.history.document.revision,
    featureId:'extrude.u',thicknessMm,
  },fixture.services);
  return {...fixture,history:result.history,invalidation:result.invalidation};
}
