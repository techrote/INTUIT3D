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


/**
 * Retrospectively edit the actual solved source SKETCH's overall X extent,
 * preserving the six semantic vertex/edge IDs, the vertical leg width,
 * all cut features and the original journal. Unlike a direct native request
 * this remains one real RUNTIME/INTENT transaction and solver-admitted edit.
 *
 * The centred-L restriction is explicit: all other profile poses stay
 * unsupported by OCCT8 v3 rather than being silently reshaped.
 */
export function editAuthoredLBracketWidth(fixture,widthMm) {
  if (!Number.isFinite(widthMm)||widthMm<=0||widthMm>1e6)
    throw new TypeError('L bracket width must be a positive finite millimetre dimension');
  const feature=fixture.model.featuresOf(fixture.history.document)
    .find(f=>f.id==='sketch.bracket');
  if (feature?.kind!=='sketch'||!feature.payload?.sketch)
    throw new TypeError('missing authoritative L bracket sketch');
  const fixed=feature.payload.sketch.constraints;
  const byId=new Map(fixed.map(c=>[c.id,c]));
  const left=byId.get('fixed.bracket.p0');
  const inside=byId.get('fixed.bracket.p3');
  if (left?.kind!=='fixed'||inside?.kind!=='fixed')
    throw new TypeError('source L sketch no longer uses fixed vertex dimensions');
  const legWidth=inside.x-left.x;
  if (!(legWidth>0&&widthMm>legWidth+1e-6))
    throw new RangeError('L bracket width must exceed the solved leg width');
  const xmin=-widthMm/2,xmax=widthMm/2,xi=xmin+legWidth;
  const values=[xmin,xmax,xmax,xi,xi,xmin];
  const edits=values.map((x,i)=>{
    const constraintId='fixed.bracket.p'+i;
    if(byId.get(constraintId)?.kind!=='fixed')
      throw new TypeError('missing dimension constraint '+constraintId);
    return {constraintId,patch:{x}};
  });
  const result=fixture.runtime.editSketchConstraints(fixture.history,{
    sketchFeatureId:'sketch.bracket',
    eventId:'edit.bracket.width.r'+fixture.history.document.revision,
    expectedRevision:fixture.history.document.revision,
    admission:'require_admissible',
    edits,
  });
  if(result.kind!=='committed')
    throw new RangeError('new L sketch is not solver-admitted: '+result.code);
  return {...fixture,history:result.history,invalidation:result.invalidation};
}

/**
 * Retrospectively edit the *authored* blind pocket's depth as a single INTENT
 * body-cut-extent journal transaction. The existing model contract owns
 * revision fencing, selection, stable identity, dependency planning and undo.
 *
 * Only a real blind pocket is supported; an invalid, stale or non-blind cut
 * is never silently converted into a valid native request. The result is
 * pending physical rebuilding, not newly certified exact geometry.
 */
export function editAuthoredLBracketPocketDepth(fixture,depthMm) {
  const document=fixture?.history?.document;
  if (!document || !Number.isSafeInteger(document.revision))
    throw new TypeError('authoritative L bracket history required');
  const pocketId=MODEL_L_CUT_IDS[1];
  const chain=fixture.services?.cutChain;
  if (typeof chain?.inspectBodyCutExtent!=='function' ||
      typeof chain?.commitUndoableBodyCutExtentEdit!=='function')
    throw new TypeError('accepted INTENT body-cut extent contract required');
  const extrude=fixture.model.featuresOf(document)
    .find(f=>f.id==='extrude.bracket');
  const thickness=extrude?.payload?.thicknessMm;
  if (extrude?.kind!=='extrude' ||
      extrude.writeTargets?.length!==1 ||
      extrude.writeTargets[0]!==MODEL_L_BODY_ID ||
      typeof thickness!=='number' || !Number.isFinite(thickness))
    throw new TypeError('missing authoritative bracket extrusion');
  if (typeof depthMm!=='number' || !Number.isFinite(depthMm) ||
      depthMm<1e-6 || depthMm>=thickness)
    throw new RangeError('blind pocket depth must be positive and below extrusion thickness');
  const selected=chain.inspectBodyCutExtent(document,pocketId,MODEL_L_BODY_ID);
  if (selected.semanticStatus!=='ready' ||
      selected.extent.kind!=='blind')
    throw new TypeError('selected pocket is not a ready authored blind cut');
  const history=chain.commitUndoableBodyCutExtentEdit(fixture.history,{
    format:chain.BODY_CUT_EXTENT_EDIT_FORMAT,
    version:chain.BODY_CUT_EXTENT_EDIT_VERSION,
    expectedProjectId:document.projectId,
    expectedRevision:document.revision,
    eventId:'edit.bracket.pocket.depth.r'+document.revision,
    cutFeatureId:pocketId,targetBodyId:MODEL_L_BODY_ID,
    fromExtent:selected.extent,toExtent:{kind:'blind',depthMm},
    admission:'require_ready',
  });
  const invalidation=fixture.runtime.diff(fixture.history,history);
  return {...fixture,history,invalidation};
}

export function editAuthoredLBracketThickness(fixture,thicknessMm) {
  const result=editExtrudeThickness(fixture.history,{
    eventId:'edit.thickness.'+thicknessMm,
    expectedRevision:fixture.history.document.revision,
    featureId:'extrude.bracket',thicknessMm,
  },fixture.services);
  return {...fixture,history:result.history,invalidation:result.invalidation};
}
