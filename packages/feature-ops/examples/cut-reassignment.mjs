/**
 * Executable consumer: use actual SKETCH, INTENT and RUNTIME to move an
 * existing clearance-cut operation from a bracket to a separate spacer.
 * This demonstrates semantic target ownership, NOT a native Boolean.
 */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileBodySet,BODY_SET_FORMAT,BODY_SET_VERSION} from '../src/body-set.mjs';
import {reassignProfileCut,CUT_REASSIGN_FORMAT,CUT_REASSIGN_VERSION} from '../src/cut-reassignment.mjs';

function rectangle(key,w,h) {
  const corners=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
  const points=corners.map(([x,y],i)=>({id:key+'.p'+i,x,y}));
  const lines=points.map((p,i)=>({
    id:key+'.e'+i,start:p.id,end:points[(i+1)%points.length].id
  }));
  const constraints=points.map(p=>({
    id:key+'.f'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
  }));
  return sketch.validateSketch({version:1,units:'mm',points,lines,
    circles:[],constraints});
}
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
const sketches=[
  ['sketch.bracket',rectangle('bracket',120,70)],
  ['sketch.spacer',rectangle('spacer',40,25)],
  ['sketch.clearance',rectangle('clearance',12,6)]
];
let history=transactions.startUndoHistory(model.newProject('two-body-cut-reassignment'));
history=runtime.commit(history,sketches.map(([id,doc])=>({
  eventId:'author.'+id,type:'feature.create',feature:{
    id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}
  }
})),history.document.revision);
const selected=Object.fromEntries(sketches.map(([id,doc])=>{
  const r=discovery.discoverPlateProfiles(doc);
  if(r.status!=='ready'||r.candidates.length!==1) throw new Error('SKETCH admission failed');
  return [id,r.candidates[0].id];
}));
const built=authorProfileBodySet(history,{
  format:BODY_SET_FORMAT,version:BODY_SET_VERSION,units:'mm',frame:'local_xy',
  expectedRevision:history.document.revision,bodies:[
    {sourceSketchId:'sketch.bracket',profileCandidateId:selected['sketch.bracket'],
      extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',
      depthMm:8,eventId:'author.extrude.bracket',cut:{
        sourceSketchId:'sketch.clearance',profileCandidateId:selected['sketch.clearance'],
        cutFeatureId:'cut.clearance',eventId:'author.cut.clearance'}},
    {sourceSketchId:'sketch.spacer',profileCandidateId:selected['sketch.spacer'],
      extrudeFeatureId:'extrude.spacer',outputBodyId:'body.spacer',
      depthMm:5,eventId:'author.extrude.spacer',cut:null}
  ]
},services);
const reassigned=reassignProfileCut(built.history,{
  format:CUT_REASSIGN_FORMAT,version:CUT_REASSIGN_VERSION,
  eventId:'cut.move.to.spacer',expectedRevision:built.history.document.revision,
  units:'mm',frame:'local_xy',cutFeatureId:'cut.clearance',
  from:{extrudeFeatureId:'extrude.bracket',bodyId:'body.bracket',
    sourceSketchId:'sketch.clearance'},
  to:{extrudeFeatureId:'extrude.spacer',bodyId:'body.spacer',
    sourceSketchId:'sketch.clearance',
    profileCandidateId:selected['sketch.clearance']}
},services);
const undone=runtime.undo(reassigned.history,['undo.cut.move']);
const redone=runtime.redo(undone,['redo.cut.move']);
const reopened=runtime.reopen(runtime.save(redone));
const target=model.featuresOf(reopened.document).find(f=>f.id==='cut.clearance');
const summary={
  status:reassigned.status,
  originalBodyId:'body.bracket',
  movedTo:target.writeTargets[0],
  selectedProfileId:reassigned.selectedProfileId,
  dependencies:target.dependsOn,
  changed:reassigned.invalidation.invalidatedFeatureIds,
  unchangedBodyStatus:runtime.inspect(reopened).features.find(
    f=>f.featureId==='extrude.bracket').status,
  recoveredAfterUndoRedoArchive:target.payload.targetBodyId==='body.spacer',
  sourceRevision:reassigned.nativeHandoff.sourceRevision,
  exactAuthority:reassigned.exactAuthority,
  independentInteroperability:reassigned.independentInteroperability
};
if (!summary.recoveredAfterUndoRedoArchive ||
    summary.changed.includes('extrude.bracket') ||
    summary.changed.includes('extrude.spacer') ||
    summary.status!=='pending_exact_provider')
  throw new Error('cut reassignment acceptance failed');
console.log(JSON.stringify(summary,null,2));
