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
import {requestFromRuntimeOcct8Orthogonal}
  from '../src/runtime-occt8-orthogonal-profile-provider.mjs';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '@intuit3d/feature-ops';

export const MODEL_U_BODY_ID='body.u';
export const MODEL_U_CUT_IDS=['cut.right.window','cut.left.pocket'];
export const MODEL_PARTNER_BODY_ID='body.partner';
export const MODEL_PARTNER_CUT_IDS=['cut.partner.window','cut.partner.pocket'];
export const MODEL_U_FIXTURE_VERSION=2;

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
    // A second separately targeted six-edge solid is authored in the SAME
    // project. It has its own ordered physical cuts and never inherits the
    // U-bracket's edit, selected sketch, feature IDs or native STEP output.
    ['sketch.partner',polygon('partner',[
      [100,-30],[150,-30],[150,-15],[140,-15],[140,10],[100,10]])],
    ['sketch.partner.window',polygon('partnerWindow',[
      [103,-27],[109,-27],[109,-21],[103,-21]])],
    ['sketch.partner.pocket',polygon('partnerPocket',[
      [105,-2],[113,-2],[113,6],[105,6]])],
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
    ['sketch.partner','extrude.partner',MODEL_PARTNER_BODY_ID,6],
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
  // Give the independent named body its own explicitly ordered chain:
  // a 6 x 6 mm through window and an 8 x 8 x 2 mm blind pocket.
  history=authorProfileBodyCut(history,{...fmt,
    eventId:'make.cut.partner.window',
    expectedRevision:history.document.revision,
    sourceSketchId:'sketch.partner.window',
    profileCandidateId:candidate('sketch.partner.window'),
    extrudeFeatureId:'extrude.partner',
    cutFeatureId:MODEL_PARTNER_CUT_IDS[0],
    targetBodyId:MODEL_PARTNER_BODY_ID,
  },services).history;
  const partnerAppend=cutChain.previewBodyCutAppend(history.document,{
    format:cutChain.BODY_CUT_CHAIN_FORMAT,
    version:cutChain.BODY_CUT_CHAIN_VERSION,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'make.cut.partner.pocket',
    sourceSketchId:'sketch.partner.pocket',
    profileCandidateId:candidate('sketch.partner.pocket'),
    afterBodyWriterId:MODEL_PARTNER_CUT_IDS[0],
    cutFeatureId:MODEL_PARTNER_CUT_IDS[1],
    targetBodyId:MODEL_PARTNER_BODY_ID,
    extent:{kind:'blind',depthMm:2},admission:'require_ready',
  });
  assert.equal(partnerAppend.semanticStatus,'ready');
  history=runtime.commit(history,[partnerAppend.event],history.document.revision);
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


/**
 * Extend only the exterior right U-flange edge. This is an authored SKETCH
 * constraint edit, not an adjustment to a native polygon cache. The inner
 * edge and both cut-tool sketches remain fixed in the original local frame;
 * increasing the width therefore thickens the right leg without moving the
 * existing rectangular window. A fresh selected-contour/cut admission is
 * required before this operation can be committed to the caller.
 */
export function editAuthoredUBracketRightFlange(fixture,widthMm) {
  const document=fixture?.history?.document;
  if(!document||!Number.isSafeInteger(document.revision))
    throw new TypeError('authoritative U-bracket history required');
  if(typeof widthMm!=='number'||!Number.isFinite(widthMm)||
     widthMm<=0||widthMm>1e6)
    throw new RangeError('U-bracket width must be a positive finite mm value');
  const source=fixture.model.featuresOf(document).find(f=>f.id==='sketch.u');
  if(source?.kind!=='sketch'||!source.payload?.sketch)
    throw new TypeError('missing selected U-bracket source sketch');
  const fixed=new Map(source.payload.sketch.constraints.map(c=>[c.id,c]));
  const left=fixed.get('fixed.bracket.p0');
  const upper=fixed.get('fixed.bracket.p2');
  const lower=fixed.get('fixed.bracket.p1');
  if(left?.kind!=='fixed'||upper?.kind!=='fixed'||
     lower?.kind!=='fixed'||upper.x!==lower.x)
    throw new TypeError('U-bracket right edge is no longer authored as one vertical flange');
  const proposedX=left.x+widthMm;
  if(proposedX===upper.x)throw new RangeError('U-bracket width edit must change the right flange');
  const outcome=fixture.runtime.editSketchConstraints(fixture.history,{
    sketchFeatureId:'sketch.u',
    eventId:'edit.u.right.flange.r'+document.revision,
    expectedRevision:document.revision,
    admission:'require_admissible',
    edits:[
      {constraintId:'fixed.bracket.p1',patch:{x:proposedX}},
      {constraintId:'fixed.bracket.p2',patch:{x:proposedX}},
    ],
  });
  if(outcome.kind!=='committed')
    throw new RangeError('U-bracket flange edit is not solver-admitted: '+outcome.code);
  // Native admission must also accept *both* authored tools against the new
  // contour. Refuse the edit rather than silently clipping or moving a cut.
  requestFromRuntimeOcct8Orthogonal(outcome.history,MODEL_U_BODY_ID,{
    runtime:fixture.runtime,model:fixture.model,
    requestId:'native.u.flange.preflight',exportStep:false,
  });
  return {...fixture,history:outcome.history,invalidation:outcome.invalidation};
}

/**
 * Edit the real nonterminal blind pocket in one INTENT-owned journal frame.
 * The existing downstream writer retains its identity and predecessor; its
 * last native receipt must be invalidated by a consuming RUNTIME session.
 */
export function editAuthoredUBracketPocketDepth(fixture,depthMm) {
  const document=fixture?.history?.document;
  if(!document||!Number.isSafeInteger(document.revision))
    throw new TypeError('authoritative U-bracket history required');
  const chain=fixture.services?.cutChain;
  if(typeof chain?.inspectBodyCutExtent!=='function'||
     typeof chain?.commitUndoableBodyCutExtentEdit!=='function')
    throw new TypeError('accepted INTENT cut extent editor required');
  const extrusion=fixture.model.featuresOf(document).find(f=>f.id==='extrude.u');
  const thicknessMm=extrusion?.payload?.thicknessMm;
  if(extrusion?.kind!=='extrude'||extrusion.writeTargets?.length!==1||
     extrusion.writeTargets[0]!==MODEL_U_BODY_ID||
     !Number.isFinite(thicknessMm))
    throw new TypeError('missing U-bracket source extrusion');
  if(typeof depthMm!=='number'||!Number.isFinite(depthMm)||
     depthMm<1e-6||depthMm>=thicknessMm)
    throw new RangeError('blind pocket depth must be below current extrusion thickness');
  const cutFeatureId=MODEL_U_CUT_IDS[1];
  const selected=chain.inspectBodyCutExtent(document,cutFeatureId,MODEL_U_BODY_ID);
  if(selected.semanticStatus!=='ready'||selected.extent.kind!=='blind')
    throw new TypeError('U-bracket pocket is not an editable blind cut');
  const history=chain.commitUndoableBodyCutExtentEdit(fixture.history,{
    format:chain.BODY_CUT_EXTENT_EDIT_FORMAT,
    version:chain.BODY_CUT_EXTENT_EDIT_VERSION,
    expectedProjectId:document.projectId,
    expectedRevision:document.revision,
    eventId:'edit.u.pocket.depth.r'+document.revision,
    cutFeatureId,targetBodyId:MODEL_U_BODY_ID,
    fromExtent:selected.extent,toExtent:{kind:'blind',depthMm},
    admission:'require_ready',
  });
  // Re-admit the current real SKETCH and ordered body-writer chain before
  // returning a commit. Never create a native request from an unresolved cut.
  requestFromRuntimeOcct8Orthogonal(history,MODEL_U_BODY_ID,{
    runtime:fixture.runtime,model:fixture.model,
    requestId:'native.u.pocket.preflight',exportStep:false,
  });
  return {...fixture,history,
    invalidation:fixture.runtime.diff(fixture.history,history)};
}
