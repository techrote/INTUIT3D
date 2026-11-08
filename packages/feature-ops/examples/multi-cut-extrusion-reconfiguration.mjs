/**
 * Real multi-cut body extrusion re-source, not native B-rep execution.
 * Engineering user gesture: select machined guard -> replace base contour
 * and thickness -> retain its existing relief/vent operation IDs -> Apply.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT}
  from '@intuit3d/feature-ops/ordered-cut/v1';
import {reconfigureProfileExtrusion,EXTRUSION_RECONFIG_FORMAT}
  from '@intuit3d/feature-ops/extrusion-reconfiguration/v1';
import {makeAssembly,polygon,runtime,services}
  from './coordinated-pockets.mjs';

const feature=(history,id)=>model.featuresOf(history.document).find(x=>x.id===id);
const state=(history,id)=>runtime.inspect(history).features.find(x=>x.featureId===id)?.status;
function admittedCandidate(sketch){
  const found=discovery.discoverPlateProfiles(sketch);
  assert.equal(found.status,'ready');
  assert.equal(found.candidates.length,1);
  return found.candidates[0].id;
}
export function makeMachinedGuard(){
  let {history,candidates}=makeAssembly();
  const alternate=polygon('guard.alternate',
    [[0,0],[135,0],[135,30],[42,30],[42,80],[0,80]]);
  const vent=polygon('guard.vent',[[85,5],[101,5],[101,17],[85,17]]);
  history=runtime.commit(history,[...[
    ['sketch.guard.alternate',alternate],['sketch.guard.vent',vent]
  ].map(([id,sketch])=>({
    eventId:'make.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch}}
  }))],history.document.revision);
  candidates={...candidates,
    'sketch.guard.alternate':admittedCandidate(alternate),
    'sketch.guard.vent':admittedCandidate(vent)};
  for(const [cutFeatureId,afterBodyWriterId,sourceSketchId,extent] of [
    ['cut.guard.relief','extrude.guard','sketch.relief',{kind:'blind',depthMm:3}],
    ['cut.guard.vent','cut.guard.relief','sketch.guard.vent',{kind:'through_all'}]
  ]){
    history=appendOrderedProfileCut(history,{
      format:ORDERED_CUT_FORMAT,version:1,
      expectedProjectId:history.document.projectId,
      expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
      eventId:'make.'+cutFeatureId,cutFeatureId,targetBodyId:'body.guard',
      afterBodyWriterId,sourceSketchId,
      profileCandidateId:candidates[sourceSketchId],extent
    },services).history;
  }
  return {history,candidates};
}
export function requestFor(history,candidates,overrides={}){
  return {
    format:EXTRUSION_RECONFIG_FORMAT,version:1,
    expectedRevision:history.document.revision,
    eventId:'edit.guard.base',units:'mm',frame:'local_xy',
    extrudeFeatureId:'extrude.guard',outputBodyId:'body.guard',
    from:{sourceSketchId:'sketch.guard',depthMm:10},
    to:{sourceSketchId:'sketch.guard.alternate',
      profileCandidateId:candidates['sketch.guard.alternate'],depthMm:14},
    ...overrides
  };
}
export function runMultiCutExtrusionReconfigure(){
  const {history,candidates}=makeMachinedGuard();
  const original=model.serializeProject(history.document);
  const wrong=[
    {...requestFor(history,candidates),expectedRevision:history.document.revision-1},
    {...requestFor(history,candidates),outputBodyId:'body.backer'},
    {...requestFor(history,candidates),to:{sourceSketchId:'sketch.guard.alternate',
      profileCandidateId:'cycle:stale',depthMm:14}},
    {...requestFor(history,candidates),to:{sourceSketchId:'sketch.guard.alternate',
      profileCandidateId:candidates['sketch.guard.alternate'],depthMm:-14}},
  ];
  for(const bad of wrong){
    assert.throws(()=>reconfigureProfileExtrusion(history,bad,services));
    assert.equal(model.serializeProject(history.document),original);
  }
  const changed=reconfigureProfileExtrusion(history,requestFor(history,candidates),services);
  assert.deepEqual(changed.orderedCutFeatureIds,['cut.guard.relief','cut.guard.vent']);
  assert.equal(changed.cutDependencyChanges.length,0);
  assert.equal(changed.history.undoStack.length,history.undoStack.length+1);
  assert.equal(changed.history.document.revision,history.document.revision+1);
  assert.equal(feature(changed.history,'extrude.guard').payload.thicknessMm,14);
  for(const id of ['extrude.guard','cut.guard.relief','cut.guard.vent'])
    assert.ok(changed.invalidation.invalidatedFeatureIds.includes(id));
  for(const id of ['extrude.backer','extrude.shim'])
    assert.ok(!changed.invalidation.invalidatedFeatureIds.includes(id));
  const undone=runtime.undo(changed.history,['undo.guard.base']);
  assert.equal(feature(undone,'extrude.guard').payload.thicknessMm,10);
  const redone=runtime.redo(undone,['redo.guard.base']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.equal(feature(reopened,'extrude.guard').payload.sourceSketchId,'sketch.guard.alternate');
  assert.equal(feature(reopened,'cut.guard.relief').payload.depthMm,3);
  assert.equal(feature(reopened,'cut.guard.vent').payload.throughAll,true);
  assert.equal(state(reopened,'cut.guard.relief'),'pending_exact_provider');
  assert.equal(state(reopened,'cut.guard.vent'),'blocked_dependency');
  return {
    kind:'real_INTENT_SKETCH_RUNTIME_multi_cut_base_reconfiguration',
    selectedBodyId:'body.guard',
    preservedCutIds:changed.orderedCutFeatureIds,
    editedBaseSourceSketchId:'sketch.guard.alternate',
    previousExtrusionDepthMm:10,updatedExtrusionDepthMm:14,
    cutStatuses:changed.orderedCutFeatureIds.map(id=>({id,status:state(reopened,id)})),
    rejectedSelections:wrong.length,
    oneUndoFrame:true,undoRedoAndArchive:true,
    independentBodiesUnchanged:true,
    exactAuthority:false,independentSTEP:'not_executed'
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  process.stdout.write(JSON.stringify(runMultiCutExtrusionReconfigure(),null,2)+'\n');
