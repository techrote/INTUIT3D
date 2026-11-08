/**
 * Real runnable consumer: 180x110 mm instrument cover with two asymmetric
 * corner chamfers, four retained fixing holes and an independently edited
 * spacer body. Semantic SKETCH/RUNTIME evidence, not native B-rep/STEP.
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
import * as chamfer from '@intuit3d/sketch/selected-corner-chamfer/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {FEATURE_OPS_FORMAT,FEATURE_OPS_VERSION,
  authorMountingFlange,editExtrudeThickness} from '@intuit3d/feature-ops';
import {CORNER_CHAMFER_FORMAT,CORNER_CHAMFER_VERSION,
  authorSelectedCornerChamfer,editSelectedCornerChamfer,
  dragSelectedCornerChamfer} from '@intuit3d/feature-ops/selected-corner-chamfer/v1';

export const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
  archive,sketch,discovery});
export const services={runtime,model,sketch,discovery,chamfer};
const feature=(h,id)=>model.featuresOf(h.document).find(f=>f.id===id);
export const selectionFor=source=>{
  const discovered=discovery.discoverPlateProfiles(source);
  if(discovered.status!=='ready'||discovered.candidates?.length!==1)
    throw Error('instrument cover needs a single profile');
  return {candidateId:discovered.candidates[0].id,
    sourceSignature:sketch.serializeSketch(source)};
};
export function makeInstrumentCover(){
  let h=transactions.startUndoHistory(model.newProject('instrument.cover.dual.bevel'));
  const cover=authorMountingFlange(h,{
    format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,
    eventId:'cover.create',expectedRevision:h.document.revision,
    sketchFeatureId:'sketch.cover',extrudeFeatureId:'extrude.cover',
    cutFeatureId:'cut.cover.holes',targetBodyId:'body.cover',thicknessMm:8,
    spec:{widthMm:180,depthMm:110,units:'mm',frame:'local_centered_xy',
      holes:[
        {id:'nw',xMm:-66,yMm:32,radiusMm:4},
        {id:'ne',xMm:66,yMm:32,radiusMm:4},
        {id:'sw',xMm:-66,yMm:-32,radiusMm:4},
        {id:'se',xMm:66,yMm:-32,radiusMm:4}
      ]}
  },services);
  h=cover.history;
  const brace=authorMountingFlange(h,{
    format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,
    eventId:'brace.create',expectedRevision:h.document.revision,
    sketchFeatureId:'sketch.brace',extrudeFeatureId:'extrude.brace',
    cutFeatureId:'cut.brace',targetBodyId:'body.brace',thicknessMm:5,
    spec:{widthMm:34,depthMm:26,units:'mm',frame:'local_centered_xy',
      holes:[{id:'center',xMm:0,yMm:0,radiusMm:3}]}
  },services);
  h=brace.history;
  return {history:h,selection:selectionFor(feature(h,'sketch.cover').payload.sketch)};
}
export function command(h,selection,chamferId,rest){
  return {format:CORNER_CHAMFER_FORMAT,version:CORNER_CHAMFER_VERSION,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    eventId:'cover.chamfer.'+h.document.revision,units:'mm',frame:'local_xy',
    sourceSketchId:'sketch.cover',extrudeFeatureId:'extrude.cover',
    targetBodyId:'body.cover',expectedCutFeatureIds:['cut.cover.holes'],
    selection,chamferId,...rest};
}
export function runDemo(){
  const {history:start,selection}=makeInstrumentCover();
  const first=authorSelectedCornerChamfer(start,command(start,selection,
    'cover:ne',{cornerPointId:'outline.ne',incomingMm:14,outgoingMm:9}),services);
  const second=authorSelectedCornerChamfer(first.history,
    command(first.history,first.selectedProfile,'cover:nw',
      {cornerPointId:'outline.nw',incomingMm:11,outgoingMm:7}),services);
  const resized=editSelectedCornerChamfer(second.history,
    command(second.history,second.selectedProfile,'cover:ne',
      {incomingMm:18,outgoingMm:12}),services);
  const nw=chamfer.inspectSelectedCornerChamfer(
    feature(resized.history,'sketch.cover').payload.sketch,
    resized.selectedProfile,'cover:nw');
  assert.equal(nw.kind,'selected_corner_chamfer');
  const grip=nw.handles.find(h=>h.kind==='outgoing');
  const dragged=dragSelectedCornerChamfer(resized.history,
    command(resized.history,resized.selectedProfile,'cover:nw',{
      handleId:grip.id,target:{x:grip.position.x+3,y:grip.position.y-2}
    }),services);
  const undo=runtime.undo(dragged.history,['cover.undo.drag']);
  const redo=runtime.redo(undo,['cover.redo.drag']);
  const reopened=runtime.reopen(runtime.save(redo));
  const thickened=editExtrudeThickness(reopened,{
    eventId:'cover.depth.13',featureId:'extrude.cover',
    expectedRevision:reopened.document.revision,thicknessMm:13
  },services);
  const final=runtime.reopen(runtime.save(thickened.history));
  const selectionFinal=feature(final,'sketch.cover').payload.selectedProfileSelection;
  const geometry=feature(final,'sketch.cover').payload.sketch;
  const ne=chamfer.inspectSelectedCornerChamfer(geometry,selectionFinal,'cover:ne');
  const nwFinal=chamfer.inspectSelectedCornerChamfer(geometry,selectionFinal,'cover:nw');
  assert.equal(ne.kind,'selected_corner_chamfer');
  assert.equal(nwFinal.kind,'selected_corner_chamfer');
  return {
    operation:'@intuit3d/feature-ops/selected-corner-chamfer/v1',
    projectId:final.document.projectId,revisions:{
      start:start.document.revision,first:first.history.document.revision,
      second:second.history.document.revision,edited:resized.history.document.revision,
      dragged:dragged.history.document.revision,final:final.document.revision},
    chamferIds:[ne.chamferId,nwFinal.chamferId],
    namedFixingHoles:geometry.circles.map(x=>x.id).sort(),
    setbacks:{ne:[ne.incomingMm,ne.outgoingMm],
      nw:[nwFinal.incomingMm,nwFinal.outgoingMm]},
    dragProjectionDeviationMm:dragged.gesture?.projectionDeviationMm,
    coverDepthMm:feature(final,'extrude.cover').payload.thicknessMm,
    unchangedBraceDepthMm:feature(final,'extrude.brace').payload.thicknessMm,
    unchangedBraceCutId:feature(final,'cut.brace').id,
    coverCutId:feature(final,'cut.cover.holes').id,
    affected:dragged.invalidation.invalidatedFeatureIds,
    braceUnaffected:!dragged.invalidation.invalidatedFeatureIds.includes('extrude.brace'),
    status:runtime.inspect(final).features.filter(x=>
      ['sketch.cover','extrude.cover','cut.cover.holes'].includes(x.featureId))
      .map(x=>[x.featureId,x.status]),
    exactAuthority:false,independentInteroperability:false,
    providerState:'analytic_preview_pending_native'
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  console.log(JSON.stringify(runDemo(),null,2));
