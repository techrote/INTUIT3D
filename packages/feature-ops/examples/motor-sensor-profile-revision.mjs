/**
 * Runnable user flow: an L-web motor-sensor mount with two captive circular
 * clearance holes, a distinct wiring relief cut and an independent shim.
 * A three-dimensional retrospective sketch revision propagates into the
 * existing body and cut without replacing semantic IDs. Analytic only.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as profileDimensions from '@intuit3d/sketch/selected-profile-dimensions/v1';
import {createDimensionedLPlateSketch} from '@intuit3d/sketch/selected-profile/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '@intuit3d/feature-ops';
import {BODY_PROFILE_DIMENSIONS_FORMAT,BODY_PROFILE_DIMENSIONS_VERSION,
  inspectSelectedBodyProfileDimensions,editSelectedBodyProfileDimensions,
  dragSelectedBodyProfileDimension}
  from '@intuit3d/feature-ops/body-profile-dimensions/v1';

export const runtime=createWorkflowRuntime({model,transactions,bindings,
  dimensions,archive,sketch,discovery});
export const services={runtime,model,sketch,discovery,profileDimensions};
const find=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
const select=doc=>{
  const found=discovery.discoverPlateProfiles(doc);
  if(found.status!=='ready'||found.candidates.length!==1)
    throw Error('one solved selected contour required');
  return {candidateId:found.candidates[0].id,
    sourceSignature:sketch.serializeSketch(doc)};
};
const polygon=(prefix,coordinates)=>{
  const points=coordinates.map(([x,y],i)=>({id:prefix+':p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,i)=>({id:prefix+':e'+i,start:p.id,
      end:points[(i+1)%points.length].id})),
    circles:[],constraints:points.map(p=>({
      id:prefix+':fixed:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
    }))});
};
export function makeMotorSensorMount(){
  const sources=[
    ['sketch.mount',createDimensionedLPlateSketch()],
    ['sketch.cable',polygon('cable',[[44,7],[62,7],[62,17],[44,17]])],
    ['sketch.shim',polygon('shim',[[0,0],[27,0],[27,18],[0,18]])]
  ];
  const selections=Object.fromEntries(sources.map(([id,doc])=>[id,select(doc)]));
  let history=transactions.startUndoHistory(
    model.newProject('motor.sensor.mount.parametric.profile'));
  history=runtime.commit(history,sources.map(([id,doc])=>({
    eventId:'add.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:doc,selectedProfileSelection:selections[id]}}
  })),history.document.revision);
  function extrude(sourceSketchId,extrudeFeatureId,outputBodyId,depthMm){
    history=authorProfileExtrusion(history,{
      format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
      eventId:'add.'+extrudeFeatureId,expectedRevision:history.document.revision,
      sourceSketchId,profileCandidateId:selections[sourceSketchId].candidateId,
      extrudeFeatureId,outputBodyId,depthMm,units:'mm',frame:'local_xy'
    },services).history;
  }
  extrude('sketch.mount','extrude.mount','body.mount',9);
  extrude('sketch.shim','extrude.shim','body.shim',3);
  history=authorProfileBodyCut(history,{
    format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'add.cut.cable',expectedRevision:history.document.revision,
    sourceSketchId:'sketch.cable',
    profileCandidateId:selections['sketch.cable'].candidateId,
    extrudeFeatureId:'extrude.mount',cutFeatureId:'cut.cable',
    targetBodyId:'body.mount',units:'mm',frame:'local_xy'
  },services).history;
  return {history,selections};
}
export function selectBody(history,selection){
  return {format:BODY_PROFILE_DIMENSIONS_FORMAT,
    version:BODY_PROFILE_DIMENSIONS_VERSION,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    units:'mm',frame:'local_xy',
    sourceSketchId:'sketch.mount',extrudeFeatureId:'extrude.mount',
    targetBodyId:'body.mount',selection};
}
export function inspect(history,selection){
  return inspectSelectedBodyProfileDimensions(history,
    selectBody(history,selection),services);
}
export function applyDimensions(history,selection,inspected,changes){
  return editSelectedBodyProfileDimensions(history,{
    ...selectBody(history,selection),
    expectedAffectedFeatureIds:inspected.affectedFeatureIds,
    eventId:'revise.mount.'+history.document.revision,
    changes:changes.map(([constraintId,valueMm])=>{
      const dim=inspected.dimensions.find(d=>d.constraintId===constraintId);
      if(!dim)throw Error('unavailable named dimension '+constraintId);
      return {constraintId,expectedValueMm:dim.value,valueMm};
    })
  },services);
}
export function applyHandle(history,selection,inspected,handleId,target){
  return dragSelectedBodyProfileDimension(history,{
    ...selectBody(history,selection),
    expectedAffectedFeatureIds:inspected.affectedFeatureIds,
    eventId:'drag.mount.'+history.document.revision,
    handleId,target
  },services);
}
export function runDemo(){
  const {history:start,selections}=makeMotorSensorMount();
  const originalSketch=find(start,'sketch.mount').payload.sketch;
  const preview=inspect(start,selections['sketch.mount']);
  assert.equal(preview.kind,'body_profile_dimensions');
  assert.deepEqual(preview.affectedFeatureIds,
    ['cut.cable','extrude.mount','sketch.mount']);
  const edited=applyDimensions(start,selections['sketch.mount'],preview,[
    ['L:length',144],['L:flangeHeight',36],['L:holeLowerRadius',6]]);
  const updated=inspect(edited.history,edited.selectedProfile);
  const radius=updated.dimensions.find(d=>d.constraintId==='L:holeLowerRadius');
  const dragged=applyHandle(edited.history,edited.selectedProfile,updated,
    radius.handle.id,{x:radius.handle.position.x+1,y:radius.handle.position.y+3});
  assert.equal(dragged.gesture.projectionDeviationMm>0,true);
  const undone=runtime.undo(dragged.history,['mount.undo.handle']);
  const redone=runtime.redo(undone,['mount.redo.handle']);
  const reopened=runtime.reopen(runtime.save(redone));
  const thickened=editExtrudeThickness(reopened,{
    eventId:'mount.depth.13',featureId:'extrude.mount',
    expectedRevision:reopened.document.revision,thicknessMm:13
  },services);
  const final=runtime.reopen(runtime.save(thickened.history));
  const selected=find(final,'sketch.mount').payload.selectedProfileSelection;
  const state=inspect(final,selected);
  const values=Object.fromEntries(state.dimensions.map(d=>[d.constraintId,d.value]));
  assert.equal(values['L:length'],144);
  assert.equal(values['L:flangeHeight'],36);
  assert.equal(values['L:holeLowerRadius'],7);
  assert.equal(find(final,'extrude.shim').payload.thicknessMm,3);
  assert.equal(find(final,'cut.cable').id,'cut.cable');
  assert.deepEqual(find(final,'sketch.mount').payload.sketch.circles.map(c=>c.id),
    originalSketch.circles.map(c=>c.id));
  return {
    operation:'@intuit3d/feature-ops/body-profile-dimensions/v1',
    projectId:final.document.projectId,
    revisions:{start:start.document.revision,edit:edited.history.document.revision,
      drag:dragged.history.document.revision,final:final.document.revision},
    dimensions:{lengthMm:values['L:length'],
      flangeHeightMm:values['L:flangeHeight'],
      clearanceRadiusMm:values['L:holeLowerRadius']},
    semanticHoleIds:find(final,'sketch.mount').payload.sketch.circles.map(c=>c.id),
    bodyId:'body.mount',retainedCutFeatureId:find(final,'cut.cable').id,
    mountThicknessMm:find(final,'extrude.mount').payload.thicknessMm,
    unrelatedShimDepthMm:find(final,'extrude.shim').payload.thicknessMm,
    dragProjectionDeviationMm:dragged.gesture.projectionDeviationMm,
    affectedFeatures:dragged.invalidation.invalidatedFeatureIds,
    independentShimUnaffected:!dragged.invalidation.invalidatedFeatureIds
      .includes('extrude.shim'),
    status:runtime.inspect(final).features.filter(x=>
      ['sketch.mount','extrude.mount','cut.cable'].includes(x.featureId))
      .map(x=>[x.featureId,x.status]),
    provider:'analytic_preview_pending_native',
    exactAuthority:false,independentInteroperability:false
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  console.log(JSON.stringify(runDemo(),null,2));
