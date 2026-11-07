/** Real accepted INTENT/SKETCH/RUNTIME consumer; native geometry NOT executed. */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {rectanglePlateFromProfile} from '@intuit3d/workflow-runtime/experimental-plate';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
// Explicit six-vertex L-shaped engineering bracket with a circular clearance.
const coords=[[-80,-50],[80,-50],[80,-10],[10,-10],[10,50],[-80,50]];
const points=coords.map(([x,y],i)=>({id:'corner.p'+i,x,y}));
const lines=points.map((point,i)=>({
  id:'boundary.line'+i,start:point.id,end:points[(i+1)%points.length].id
}));
points.push({id:'bolt.center',x:-50,y:0});
const authored=sketch.validateSketch({
  version:1,units:'mm',points,lines,
  circles:[{id:'bolt.circle',center:'bolt.center',radius:6}],
  constraints:[
    ...points.map(point=>({id:'fix.'+point.id,kind:'fixed',
      point:point.id,x:point.x,y:point.y})),
    {id:'bolt.radius',kind:'radius',circle:'bolt.circle',value:6}
  ]
});
const proposal=discovery.discoverPlateProfiles(authored);
if(proposal.status!=='ready' || proposal.candidates.length!==1)
  throw Error('SKETCH refused unique L-bracket profile');
const empty=transactions.startUndoHistory(model.newProject('l.bracket.profile.extrude.cut'));
const saved=runtime.commit(empty,[{eventId:'create.sketch',type:'feature.create',
  feature:{id:'sketch.bracket',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:authored}}}],empty.document.revision);
const protocol={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,units:'mm',frame:'local_xy'};
const extruded=authorProfileExtrusion(saved,{
  ...protocol,eventId:'create.extrude',expectedRevision:saved.document.revision,
  sourceSketchId:'sketch.bracket',profileCandidateId:proposal.candidates[0].id,
  extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',depthMm:8
},services);
const cut=authorProfileBodyCut(extruded.history,{
  ...protocol,eventId:'create.cut',expectedRevision:extruded.history.document.revision,
  sourceSketchId:'sketch.bracket',profileCandidateId:proposal.candidates[0].id,
  extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.bracket',targetBodyId:'body.bracket'
},services);
const edited=editExtrudeThickness(cut.history,{
  eventId:'edit.depth',featureId:'extrude.bracket',
  expectedRevision:cut.history.document.revision,thicknessMm:14
},services);
const reopened=runtime.reopen(runtime.save(edited.history));
const state=runtime.inspect(reopened);
if(state.features.find(f=>f.featureId==='cut.bracket')?.status!=='pending_exact_provider')
  throw Error('Cut must remain pending an exact native provider');
const profile=state.features.find(f=>f.featureId==='extrude.bracket').profile;
let experimentalPlateSupported=true;
try { rectanglePlateFromProfile(profile,14); } catch { experimentalPlateSupported=false; }
if(experimentalPlateSupported) throw Error('L-profile misrepresented as plate-v1');
console.log(JSON.stringify({
  part:'six-sided_L_bracket',vertices:profile.outer.length,holeCount:profile.holes.length,
  thicknessBeforeMm:8,thicknessAfterMm:14,revision:reopened.document.revision,
  states:state.features.map(f=>[f.featureId,f.status]),
  invalidated:edited.invalidation.invalidatedFeatureIds,
  nativeSupport:'pending_general_profile_kernel',experimentalPlateSupported,
  exactAuthority:false,independentInteroperability:false
},null,2));
