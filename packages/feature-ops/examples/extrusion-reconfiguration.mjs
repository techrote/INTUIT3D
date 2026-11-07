/**
 * Real INTENT + SKETCH + RUNTIME consumer. This is semantic authoring only;
 * neither preview geometry nor pending cuts certify a native B-rep/STEP.
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
import {reconfigureProfileExtrusion,EXTRUSION_RECONFIG_FORMAT,
  EXTRUSION_RECONFIG_VERSION} from '../src/extrusion-reconfiguration.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={model,runtime,sketch,discovery};
function sketchProfile(vertices) {
  const points=vertices.map(([x,y],n)=>({id:'p'+n,x,y}));
  return sketch.validateSketch({
    version:1,units:'mm',points,
    lines:points.map((p,n)=>({id:'e'+n,start:p.id,
      end:points[(n+1)%points.length].id})),
    circles:[],constraints:points.map(p=>({
      id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
    }))
  });
}
const source={
  'sketch.old':sketchProfile([[-70,-40],[70,-40],[70,-10],[15,-10],[15,45],[-70,45]]),
  'sketch.new':sketchProfile([[-90,-45],[90,-45],[65,-5],[5,45],[-90,45]]),
  'sketch.spacer':sketchProfile([[-15,-10],[15,-10],[15,10],[-15,10]])
};
const candidate=Object.fromEntries(Object.entries(source).map(([key,doc])=>{
  const found=discovery.discoverPlateProfiles(doc);
  if(found.status!=='ready'||found.candidates.length!==1)
    throw new Error('SKETCH rejected '+key);
  return [key,found.candidates[0].id];
}));
let history=transactions.startUndoHistory(model.newProject('bracket.source.edit.demo'));
history=runtime.commit(history,Object.entries(source).map(([key,doc])=>({
  eventId:'create.'+key,type:'feature.create',
  feature:{id:key,kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:doc}}
})),history.document.revision);
history=authorProfileBodySet(history,{
  format:BODY_SET_FORMAT,version:BODY_SET_VERSION,
  units:'mm',frame:'local_xy',expectedRevision:history.document.revision,
  bodies:[
    {sourceSketchId:'sketch.old',profileCandidateId:candidate['sketch.old'],
      extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',
      eventId:'create.bracket',depthMm:8,
      cut:{sourceSketchId:'sketch.old',profileCandidateId:candidate['sketch.old'],
        cutFeatureId:'cut.bracket',eventId:'create.cut'}},
    {sourceSketchId:'sketch.spacer',profileCandidateId:candidate['sketch.spacer'],
      extrudeFeatureId:'extrude.spacer',outputBodyId:'body.spacer',
      eventId:'create.spacer',depthMm:5,cut:null}
  ]
},services).history;
const operation=reconfigureProfileExtrusion(history,{
  format:EXTRUSION_RECONFIG_FORMAT,version:EXTRUSION_RECONFIG_VERSION,
  expectedRevision:history.document.revision,eventId:'edit.bracket.profile',
  units:'mm',frame:'local_xy',extrudeFeatureId:'extrude.bracket',
  outputBodyId:'body.bracket',from:{sourceSketchId:'sketch.old',depthMm:8},
  to:{sourceSketchId:'sketch.new',profileCandidateId:candidate['sketch.new'],
    depthMm:14}
},services);
const undone=runtime.undo(operation.history,['undo.profile','undo.cut']);
const redone=runtime.redo(undone,['redo.profile','redo.cut']);
const reopened=runtime.reopen(runtime.save(redone));
const features=model.featuresOf(reopened.document);
const get=id=>features.find(f=>f.id===id);
const output={
  status:operation.status,
  originalDepthMm:8,
  extrusionDepthMm:operation.depthMm,
  recoveredDepthMm:get('extrude.bracket').payload.thicknessMm,
  selectedSketch:get('extrude.bracket').payload.sourceSketchId,
  unchangedSpacerDepthMm:get('extrude.spacer').payload.thicknessMm,
  cutDependencies:get('cut.bracket').dependsOn,
  cutState:runtime.inspect(reopened).features.find(f=>f.featureId==='cut.bracket').status,
  changed:operation.invalidation.invalidatedFeatureIds,
  exactAuthority:operation.exactAuthority,
  independentInteroperability:operation.independentInteroperability
};
if(output.cutState!=='pending_exact_provider' ||
   output.changed.includes('extrude.spacer') ||
   output.selectedSketch!=='sketch.new')
  throw new Error('incorrect dependency or body preservation');
console.log(JSON.stringify(output,null,2));
