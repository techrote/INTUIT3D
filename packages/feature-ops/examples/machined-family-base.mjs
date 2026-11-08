/**
 * Real guard/rail family, each containing two ordered machining cuts, and
 * an independent shim. Semantic and analytic only; no native Boolean.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT}
  from '@intuit3d/feature-ops/ordered-cut/v1';
import {reconfigureProfileExtrusion,EXTRUSION_RECONFIG_FORMAT}
  from '@intuit3d/feature-ops/extrusion-reconfiguration/v1';
import {FAMILY_BASE_FORMAT,inspectMachinedFamilyBase,
  applyMachinedFamilyBase}
  from '@intuit3d/feature-ops/machined-family-base/v1';
import {makeMachinedGuard} from './multi-cut-extrusion-reconfiguration.mjs';
import {polygon,runtime,services} from './coordinated-pockets.mjs';

const feature=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
const candidate=sketch=>{
  const found=discovery.discoverPlateProfiles(sketch);
  assert.equal(found.status,'ready');
  assert.equal(found.candidates.length,1);
  return found.candidates[0].id;
};
export function makeMachinedFamily(){
  let {history,candidates}=makeMachinedGuard();
  const backerAlt=polygon('backer.alternate',
    [[0,0],[125,0],[125,22],[0,22]]);
  history=runtime.commit(history,[{
    eventId:'make.sketch.backer.alternate',type:'feature.create',
    feature:{id:'sketch.backer.alternate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:backerAlt}}
  }],history.document.revision);
  candidates={...candidates,
    'sketch.backer.alternate':candidate(backerAlt)};
  for(const [cutFeatureId,afterBodyWriterId,sourceSketchId,extent] of [
    ['cut.backer.relief','extrude.backer','sketch.relief',
      {kind:'blind',depthMm:1.5}],
    ['cut.backer.vent','cut.backer.relief','sketch.guard.vent',
      {kind:'through_all'}]
  ]){
    history=appendOrderedProfileCut(history,{
      format:ORDERED_CUT_FORMAT,version:1,
      expectedProjectId:history.document.projectId,
      expectedRevision:history.document.revision,
      units:'mm',frame:'local_xy',eventId:'make.'+cutFeatureId,
      cutFeatureId,targetBodyId:'body.backer',afterBodyWriterId,
      sourceSketchId,profileCandidateId:candidates[sourceSketchId],extent
    },services).history;
  }
  return {history,candidates};
}
export function requestFor(history,candidates){
  return {
    format:FAMILY_BASE_FORMAT,version:1,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    expectedDocumentFence:model.serializeProject(history.document),
    units:'mm',frame:'local_xy',
    edits:[
      {eventId:'edit.guard.family',extrudeFeatureId:'extrude.guard',
        outputBodyId:'body.guard',from:{sourceSketchId:'sketch.guard',depthMm:10},
        to:{sourceSketchId:'sketch.guard.alternate',
          profileCandidateId:candidates['sketch.guard.alternate'],depthMm:14}},
      {eventId:'edit.backer.family',extrudeFeatureId:'extrude.backer',
        outputBodyId:'body.backer',from:{sourceSketchId:'sketch.backer',depthMm:5},
        to:{sourceSketchId:'sketch.backer.alternate',
          profileCandidateId:candidates['sketch.backer.alternate'],depthMm:8}}
    ]
  };
}
export function runMachinedFamily(){
  const {history,candidates}=makeMachinedFamily();
  const req=requestFor(history,candidates);
  const original=model.serializeProject(history.document);
  const inspected=inspectMachinedFamilyBase(history,req,services);
  assert.equal(model.serializeProject(history.document),original);
  assert.deepEqual(inspected.bodies.map(x=>x.orderedCutFeatureIds),[
    ['cut.guard.relief','cut.guard.vent'],
    ['cut.backer.relief','cut.backer.vent']]);
  const invalid=[
    {...req,expectedRevision:req.expectedRevision-1},
    {...req,expectedDocumentFence:'stale'},
    {...req,edits:[req.edits[0],req.edits[0]]},
    {...req,edits:[req.edits[0],{
      ...req.edits[1],outputBodyId:'body.shim'}]},
    {...req,edits:[req.edits[0],{
      ...req.edits[1],to:{...req.edits[1].to,profileCandidateId:'cycle:stale'}}]}
  ];
  for(const bad of invalid){
    assert.throws(()=>applyMachinedFamilyBase(history,bad,services));
    assert.equal(model.serializeProject(history.document),original);
  }
  const applied=applyMachinedFamilyBase(history,req,services);
  assert.equal(applied.history.undoStack.length,history.undoStack.length+1);
  assert.deepEqual(applied.bodies.map(x=>x.outputBodyId),['body.guard','body.backer']);
  assert.equal(feature(applied.history,'extrude.guard').payload.thicknessMm,14);
  assert.equal(feature(applied.history,'extrude.backer').payload.thicknessMm,8);
  for(const id of ['extrude.guard','cut.guard.relief','cut.guard.vent',
    'extrude.backer','cut.backer.relief','cut.backer.vent'])
    assert.ok(applied.invalidation.invalidatedFeatureIds.includes(id),id);
  assert.ok(!applied.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  const undone=runtime.undo(applied.history,
    applied.eventIds.map((_,i)=>'undo.family.'+i));
  assert.equal(feature(undone,'extrude.guard').payload.thicknessMm,10);
  assert.equal(feature(undone,'extrude.backer').payload.thicknessMm,5);
  const redone=runtime.redo(undone,
    applied.eventIds.map((_,i)=>'redo.family.'+i));
  const reopened=runtime.reopen(runtime.save(redone));
  assert.equal(feature(reopened,'extrude.guard').payload.sourceSketchId,
    'sketch.guard.alternate');
  assert.equal(feature(reopened,'extrude.backer').payload.sourceSketchId,
    'sketch.backer.alternate');
  assert.equal(feature(reopened,'cut.guard.relief').payload.depthMm,3);
  assert.equal(feature(reopened,'cut.backer.relief').payload.depthMm,1.5);
  assert.equal(feature(reopened,'cut.guard.vent').payload.throughAll,true);
  assert.equal(feature(reopened,'cut.backer.vent').payload.throughAll,true);
  const further=reconfigureProfileExtrusion(reopened,{
    format:EXTRUSION_RECONFIG_FORMAT,version:1,
    eventId:'retrospective.guard.depth',expectedRevision:reopened.document.revision,
    units:'mm',frame:'local_xy',extrudeFeatureId:'extrude.guard',
    outputBodyId:'body.guard',
    from:{sourceSketchId:'sketch.guard.alternate',depthMm:14},
    to:{sourceSketchId:'sketch.guard.alternate',
      profileCandidateId:candidates['sketch.guard.alternate'],depthMm:16}
  },services);
  assert.equal(feature(further.history,'extrude.guard').payload.thicknessMm,16);
  assert.equal(feature(further.history,'extrude.backer').payload.thicknessMm,8);
  assert.equal(feature(further.history,'extrude.shim').payload.thicknessMm,3);
  return {kind:'real_family_base_retrofit',
    editedBodies:applied.bodies.map(b=>b.outputBodyId),
    preservedCuts:applied.bodies.map(b=>b.orderedCutFeatureIds),
    depthsMm:[14,8],retrospectiveGuardDepthMm:16,
    rejectedSelections:invalid.length,
    oneUndoFrame:true,undoRedoAndArchive:true,unchangedShim:true,
    exactAuthority:false,nativeSTEP:'not_executed'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  console.log(JSON.stringify(runMachinedFamily(),null,2));
