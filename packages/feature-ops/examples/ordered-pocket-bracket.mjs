/** Two ordered cuts on an L-bracket plus an independent spacer, semantic only. */
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
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION}
  from '../src/ordered-cut.mjs';
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain};
function profile(key,coords) {
  const points=coords.map(([x,y],n)=>({id:key+'.p'+n,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,n)=>({id:key+'.e'+n,start:p.id,end:points[(n+1)%points.length].id})),
    circles:[],constraints:points.map(p=>({id:'fix.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}))});
}
const shapes=[
  ['sketch.bracket',profile('bracket',[[0,0],[120,0],[120,25],[30,25],[30,80],[0,80]])],
  ['sketch.slot',profile('slot',[[10,8],[40,8],[40,18],[10,18]])],
  ['sketch.pocket',profile('pocket',[[10,35],[23,35],[23,60],[10,60]])],
  ['sketch.spacer',profile('spacer',[[0,0],[40,0],[40,20],[0,20]])]
];
let h=transactions.startUndoHistory(model.newProject('two-ordered-cut-bracket'));
h=runtime.commit(h,shapes.map(([id,doc])=>({eventId:'make.'+id,
  type:'feature.create',feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}}})),h.document.revision);
const selected=Object.fromEntries(shapes.map(([id,doc])=>{
  const proposed=discovery.discoverPlateProfiles(doc);
  if(proposed.status!=='ready'||proposed.candidates.length!==1)throw Error('unadmitted '+id);
  return [id,proposed.candidates[0].id];
}));
function addExtrude(sketchId,extrudeId,bodyId,depthMm) {
  const next=authorProfileExtrusion(h,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'author.'+extrudeId,expectedRevision:h.document.revision,sourceSketchId:sketchId,
    profileCandidateId:selected[sketchId],extrudeFeatureId:extrudeId,outputBodyId:bodyId,
    depthMm,units:'mm',frame:'local_xy'},services);
  h=next.history;
}
addExtrude('sketch.bracket','extrude.bracket','body.bracket',8);
addExtrude('sketch.spacer','extrude.spacer','body.spacer',5);
h=authorProfileBodyCut(h,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
  eventId:'author.cut.slot',expectedRevision:h.document.revision,
  sourceSketchId:'sketch.slot',profileCandidateId:selected['sketch.slot'],
  extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.slot',targetBodyId:'body.bracket',
  units:'mm',frame:'local_xy'},services).history;
const cut=appendOrderedProfileCut(h,{format:ORDERED_CUT_FORMAT,version:ORDERED_CUT_VERSION,
  expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
  eventId:'author.cut.pocket',sourceSketchId:'sketch.pocket',
  profileCandidateId:selected['sketch.pocket'],afterBodyWriterId:'cut.slot',
  cutFeatureId:'cut.pocket',targetBodyId:'body.bracket',units:'mm',frame:'local_xy',
  extent:{kind:'blind',depthMm:3}},services);
h=cut.history;
const edit=editExtrudeThickness(h,{eventId:'thicken.bracket',featureId:'extrude.bracket',
  expectedRevision:h.document.revision,thicknessMm:12},services);
const reopened=runtime.reopen(runtime.save(runtime.redo(runtime.undo(edit.history,['undo.thicken']),['redo.thicken'])));
const features=model.featuresOf(reopened.document);
const answer={
  semanticBodyTerminal:cutChain.inspectBodyCutChain(reopened.document,'body.bracket').eligibleAfterWriterId,
  pocketDepthMm:features.find(f=>f.id==='cut.pocket').payload.depthMm,
  afterEditThicknessMm:features.find(f=>f.id==='extrude.bracket').payload.thicknessMm,
  independentSpacerThicknessMm:features.find(f=>f.id==='extrude.spacer').payload.thicknessMm,
  pocketRuntimeStatus:runtime.inspect(reopened).features.find(f=>f.featureId==='cut.pocket').status,
  affected:edit.invalidation.invalidatedFeatureIds,
  exactAuthority:false,independentInteroperability:false
};
if(answer.affected.includes('extrude.spacer'))throw Error('unrelated spacer invalidated');
console.log(JSON.stringify(answer,null,2));
