/**
 * Runnable real INTENT/SKETCH/RUNTIME assembly fixture:
 * an L-shaped guard, a separate backing rail, and an unaffected spacer.
 * One user command pockets both selected bodies from a common relief sketch.
 * SEMANTIC / PROVIDER-PENDING ONLY: no native Boolean or assembly mating.
 */
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as cutChain from '@intuit3d/model/body-cut-chain';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileBodySet,BODY_SET_FORMAT,BODY_SET_VERSION}
  from '@intuit3d/feature-ops/body-set/v1';
import {authorCoordinatedBodyCuts,reconfigureCoordinatedBodyCutExtents,
  COORDINATED_CUT_FORMAT,COORDINATED_CUT_VERSION}
  from '@intuit3d/feature-ops/coordinated-body-cuts/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';

export const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,
  sketch,discovery});
export const services={runtime,model,sketch,discovery,cutChain};
export function polygon(prefix,vertices) {
  const points=vertices.map(([x,y],n)=>({id:prefix+'.p'+n,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,n)=>({id:prefix+'.e'+n,start:p.id,
      end:points[(n+1)%points.length].id})),circles:[],
    constraints:points.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}))
  });
}
export function makeAssembly(){
  const parts=[
    ['sketch.guard',polygon('guard',[[0,0],[110,0],[110,24],[34,24],[34,70],[0,70]])],
    ['sketch.backer',polygon('backer',[[0,0],[110,0],[110,24],[0,24]])],
    ['sketch.shim',polygon('shim',[[0,0],[28,0],[28,15],[0,15]])],
    ['sketch.relief',polygon('relief',[[10,5],[26,5],[26,13],[10,13]])]
  ];
  let history=transactions.startUndoHistory(model.newProject('coordinated.pockets.guard.backer.shim'));
  history=runtime.commit(history,parts.map(([featureId,doc])=>({
    eventId:'create.'+featureId,type:'feature.create',
    feature:{id:featureId,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:doc}}
  })),history.document.revision);
  const candidates=Object.fromEntries(parts.map(([featureId,doc])=>{
    const found=discovery.discoverPlateProfiles(doc);
    if(found.status!=='ready'||found.candidates?.length!==1)
      throw new Error('SKETCH did not admit '+featureId);
    return [featureId,found.candidates[0].id];
  }));
  const bodySet=authorProfileBodySet(history,{
    format:BODY_SET_FORMAT,version:BODY_SET_VERSION,
    expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
    bodies:[
      {sourceSketchId:'sketch.guard',profileCandidateId:candidates['sketch.guard'],
        extrudeFeatureId:'extrude.guard',outputBodyId:'body.guard',
        depthMm:10,eventId:'make.guard',cut:null},
      {sourceSketchId:'sketch.backer',profileCandidateId:candidates['sketch.backer'],
        extrudeFeatureId:'extrude.backer',outputBodyId:'body.backer',
        depthMm:5,eventId:'make.backer',cut:null},
      {sourceSketchId:'sketch.shim',profileCandidateId:candidates['sketch.shim'],
        extrudeFeatureId:'extrude.shim',outputBodyId:'body.shim',
        depthMm:3,eventId:'make.shim',cut:null}
    ]
  },services);
  return {history:bodySet.history,candidates};
}
export const protocol={format:COORDINATED_CUT_FORMAT,version:COORDINATED_CUT_VERSION,
  units:'mm',frame:'local_xy',sourceSketchId:'sketch.relief'};
export function authorRequest(history,candidates){
  return {...protocol,expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    profileCandidateId:candidates['sketch.relief'],
    cuts:[
      {targetBodyId:'body.guard',afterBodyWriterId:'extrude.guard',
        cutFeatureId:'cut.guard.relief',eventId:'pocket.guard',extent:{kind:'blind',depthMm:3}},
      {targetBodyId:'body.backer',afterBodyWriterId:'extrude.backer',
        cutFeatureId:'cut.backer.relief',eventId:'pocket.backer',extent:{kind:'through_all'}}
    ]};
}
export function editRequest(history,candidates){
  return {...protocol,expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    profileCandidateId:candidates['sketch.relief'],
    cuts:[
      {targetBodyId:'body.guard',afterBodyWriterId:'extrude.guard',
        cutFeatureId:'cut.guard.relief',eventId:'edit.guard.relief',
        fromExtent:{kind:'blind',depthMm:3},toExtent:{kind:'through_all'}},
      {targetBodyId:'body.backer',afterBodyWriterId:'extrude.backer',
        cutFeatureId:'cut.backer.relief',eventId:'edit.backer.relief',
        fromExtent:{kind:'through_all'},toExtent:{kind:'blind',depthMm:2}}
    ]};
}
export function runDemo(){
  const {history,candidates}=makeAssembly();
  const created=authorCoordinatedBodyCuts(history,authorRequest(history,candidates),services);
  const revised=reconfigureCoordinatedBodyCutExtents(created.history,
    editRequest(created.history,candidates),services);
  const undo=runtime.undo(revised.history,['undo.guard.relief','undo.backer.relief']);
  const redo=runtime.redo(undo,['redo.guard.relief','redo.backer.relief']);
  const reopened=runtime.reopen(runtime.save(redo));
  const thickened=editExtrudeThickness(reopened,{
    eventId:'thicken.guard',featureId:'extrude.guard',
    expectedRevision:reopened.document.revision,thicknessMm:14
  },services);
  const source=model.featuresOf(thickened.history.document).find(f=>f.id==='sketch.relief');
  const altered=polygon('relief',[[12,6],[29,6],[29,15],[12,15]]);
  const afterSketch=runtime.commit(thickened.history,[{
    eventId:'resize.shared.relief',type:'feature.edit',featureId:'sketch.relief',
    patch:{payload:{...source.payload,sketch:altered}}
  }],thickened.history.document.revision);
  const final=runtime.reopen(runtime.save(afterSketch));
  const saved=model.featuresOf(final.document);
  return {
    status:'semantic_only_pending_native',
    createdCutStatuses:created.cuts.map(x=>x.status),
    editedExtents:revised.cuts.map(x=>x.extent),
    undoFramesForInitialCut:created.history.undoStack.length-history.undoStack.length,
    undoFramesForRetrospectiveEdit:revised.history.undoStack.length-created.history.undoStack.length,
    preservedCutIds:saved.filter(x=>x.kind==='cut').map(x=>x.id).sort(),
    guardDepthMm:saved.find(x=>x.id==='extrude.guard').payload.thicknessMm,
    unchangedShimDepthMm:saved.find(x=>x.id==='extrude.shim').payload.thicknessMm,
    affectedByGuardEdit:thickened.invalidation.invalidatedFeatureIds,
    affectedBySharedSketch:runtime.diff(thickened.history,afterSketch).invalidatedFeatureIds,
    reopenedStatuses:runtime.inspect(final).features
      .filter(x=>['cut.guard.relief','cut.backer.relief'].includes(x.featureId))
      .map(x=>({id:x.featureId,status:x.status})),
    exactAuthority:false,independentInteroperability:false
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  console.log(JSON.stringify(runDemo(),null,2));
