/**
 * End-user mechanical part: 120 mm dimensioned L mounting arm with two
 * clearance holes, a selected-edge rectangular relief notch, a separately
 * targeted slot cut and an unaffected spacer body.
 *
 * Genuine SKETCH/INTENT/RUNTIME journal and solver; ANALYTIC PREVIEW ONLY.
 */
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createDimensionedLPlateSketch} from '@intuit3d/sketch/selected-profile/v1';
import * as notch from '@intuit3d/sketch/selected-edge-notch/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '@intuit3d/feature-ops';
import {authorSelectedContourNotch,editSelectedContourNotch,dragSelectedContourNotch,
  CONTOUR_NOTCH_FORMAT,CONTOUR_NOTCH_VERSION}
  from '@intuit3d/feature-ops/selected-contour-notch/v1';

export const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,
  sketch,discovery});
export const services={runtime,model,sketch,discovery,notch};
const selectionFor=doc=>{
  const p=discovery.discoverPlateProfiles(doc);
  if(p.status!=='ready'||p.candidates.length!==1)throw Error('unselected contour');
  return {candidateId:p.candidates[0].id,sourceSignature:sketch.serializeSketch(doc)};
};
const polygon=(prefix,points)=>{
  const p=points.map(([x,y],i)=>({id:prefix+'.p'+i,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points:p,
    lines:p.map((a,i)=>({id:prefix+'.e'+i,start:a.id,end:p[(i+1)%p.length].id})),
    circles:[],constraints:p.map(a=>({id:'fixed.'+a.id,
      kind:'fixed',point:a.id,x:a.x,y:a.y}))});
};
const byId=(history,fid)=>model.featuresOf(history.document).find(f=>f.id===fid);
export function makePart(){
  const sources=[
    ['sketch.arm',createDimensionedLPlateSketch()],
    ['sketch.slot',polygon('slot',[[15,12],[29,12],[29,22],[15,22]])],
    ['sketch.spacer',polygon('spacer',[[0,0],[22,0],[22,14],[0,14]])]
  ];
  const selections=Object.fromEntries(sources.map(([id,doc])=>[id,selectionFor(doc)]));
  let history=transactions.startUndoHistory(model.newProject('notched.arm.assembly'));
  history=runtime.commit(history,sources.map(([id,doc])=>({
    eventId:'create.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:doc,selectedProfileSelection:selections[id]}}
  })),history.document.revision);
  const extrude=(sourceSketchId,extrudeFeatureId,outputBodyId,depthMm)=>{
    const made=authorProfileExtrusion(history,{
      format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
      eventId:'create.'+extrudeFeatureId,expectedRevision:history.document.revision,
      sourceSketchId,profileCandidateId:selections[sourceSketchId].candidateId,
      extrudeFeatureId,outputBodyId,depthMm,units:'mm',frame:'local_xy'
    },services);
    history=made.history;
  };
  extrude('sketch.arm','extrude.arm','body.arm',10);
  extrude('sketch.spacer','extrude.spacer','body.spacer',4);
  history=authorProfileBodyCut(history,{
    format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'create.cut.slot',expectedRevision:history.document.revision,
    sourceSketchId:'sketch.slot',profileCandidateId:selections['sketch.slot'].candidateId,
    extrudeFeatureId:'extrude.arm',cutFeatureId:'cut.arm.slot',
    targetBodyId:'body.arm',units:'mm',frame:'local_xy'
  },services).history;
  return {history,selections};
}
export function command(history,selection,extra){
  return {format:CONTOUR_NOTCH_FORMAT,version:CONTOUR_NOTCH_VERSION,
    expectedProjectId:history.document.projectId,expectedRevision:history.document.revision,
    eventId:'notch.'+history.document.revision,
    units:'mm',frame:'local_xy',sourceSketchId:'sketch.arm',
    extrudeFeatureId:'extrude.arm',targetBodyId:'body.arm',
    selection,notchId:'arm:relief',...extra};
}
export function runDemo(){
  const {history:start,selections}=makePart();
  const created=authorSelectedContourNotch(start,command(start,selections['sketch.arm'],{
    edgeId:'L:edge0',fromMm:45,toMm:65,depthMm:8
  }),services);
  const edited=editSelectedContourNotch(created.history,
    command(created.history,created.selectedProfile,{
      fromMm:42,toMm:70,depthMm:10
    }),services);
  const handle=edited.notch.handles.find(h=>h.kind==='depth');
  const dragged=dragSelectedContourNotch(edited.history,
    command(edited.history,edited.selectedProfile,{
      handleId:handle.id,target:{x:handle.position.x,y:13}
    }),services);
  const undo=runtime.undo(dragged.history,['undo.notch.drag']);
  const redo=runtime.redo(undo,['redo.notch.drag']);
  const reopened=runtime.reopen(runtime.save(redo));
  const thickness=editExtrudeThickness(reopened,{
    eventId:'thicken.arm',featureId:'extrude.arm',expectedRevision:reopened.document.revision,
    thicknessMm:14
  },services);
  const final=runtime.reopen(runtime.save(thickness.history));
  const stillSelected=byId(final,'sketch.arm').payload.selectedProfileSelection;
  const inspected=notch.inspectSelectedEdgeNotch(byId(final,'sketch.arm').payload.sketch,
    stillSelected,'arm:relief');
  if(inspected.kind!=='selected_edge_notch')throw Error('saved notch not inspectable');
  return {
    operation:'@intuit3d/feature-ops/selected-contour-notch/v1',
    status:'analytic_preview_pending_native',
    revisions:[start.document.revision,created.history.document.revision,
      edited.history.document.revision,dragged.history.document.revision,final.document.revision],
    selectedProfileId:stillSelected.candidateId,
    stableOriginalEdgeId:inspected.originalEdgeId,
    notch:{fromMm:inspected.fromMm,toMm:inspected.toMm,depthMm:inspected.depthMm},
    armDepthMm:byId(final,'extrude.arm').payload.thicknessMm,
    spacerDepthMm:byId(final,'extrude.spacer').payload.thicknessMm,
    slotCutId:byId(final,'cut.arm.slot').id,
    affectedByNotch:dragged.invalidation.invalidatedFeatureIds,
    unaffectedByNotch:!dragged.invalidation.invalidatedFeatureIds.includes('extrude.spacer'),
    finalStatuses:runtime.inspect(final).features.filter(x=>
      ['sketch.arm','extrude.arm','cut.arm.slot'].includes(x.featureId))
      .map(x=>({featureId:x.featureId,status:x.status})),
    undoFramesForNotch:created.history.undoStack.length-start.undoStack.length,
    exactAuthority:false,independentInteroperability:false
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  console.log(JSON.stringify(runDemo(),null,2));
