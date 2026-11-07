import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileBodySet,BODY_SET_FORMAT,BODY_SET_VERSION} from '../src/body-set.mjs';
import {editExtrudeThickness} from '../src/index.mjs';

function profile(key,vertices,withHole=false) {
  const points=vertices.map(([x,y],i)=>({id:key+'.p'+i,x,y}));
  const lines=vertices.map((_,i)=>({
    id:key+'.e'+i,start:points[i].id,end:points[(i+1)%points.length].id
  }));
  const circles=[];
  if(withHole) {
    points.push({id:key+'.hole.center',x:-45,y:0});
    circles.push({id:key+'.hole',center:key+'.hole.center',radius:5});
  }
  const constraints=points.map(p=>({
    id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
  }));
  if(withHole) constraints.push({id:key+'.radius',kind:'radius',
    circle:key+'.hole',value:5});
  return sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
}
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const definitions=[
  ['sketch.bracket',profile('bracket',[
    [-75,-50],[75,-50],[75,-15],[15,-15],[15,50],[-75,50]
  ],true)],
  ['sketch.spacer',profile('spacer',[
    [-20,-10],[20,-10],[20,10],[-20,10]
  ])],
  ['sketch.clearance',profile('clearance',[
    [-25,-15],[25,-15],[25,15],[-25,15]
  ])]
];
let history=transactions.startUndoHistory(model.newProject('multi.body.fixture'));
history=runtime.commit(history,definitions.map(([id,doc])=>({
  eventId:'author.'+id,type:'feature.create',feature:{
    id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}
  }
})),history.document.revision);
const candidates=Object.fromEntries(definitions.map(([id,doc])=>{
  const result=discovery.discoverPlateProfiles(doc);
  if(result.status!=='ready'||result.candidates.length!==1)
    throw new Error('SKETCH did not admit '+id);
  return [id,result.candidates[0].id];
}));
const created=authorProfileBodySet(history,{
  format:BODY_SET_FORMAT,version:BODY_SET_VERSION,
  units:'mm',frame:'local_xy',expectedRevision:history.document.revision,
  bodies:[
    {sourceSketchId:'sketch.bracket',profileCandidateId:candidates['sketch.bracket'],
      extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',depthMm:8,
      eventId:'extrude.bracket.event',cut:{sourceSketchId:'sketch.clearance',
        profileCandidateId:candidates['sketch.clearance'],cutFeatureId:'cut.bracket',
        eventId:'cut.bracket.event'}},
    {sourceSketchId:'sketch.spacer',profileCandidateId:candidates['sketch.spacer'],
      extrudeFeatureId:'extrude.spacer',outputBodyId:'body.spacer',depthMm:5,
      eventId:'extrude.spacer.event',cut:null}
  ]
},{runtime,model,sketch,discovery});
const edited=editExtrudeThickness(created.history,{
  eventId:'edit.bracket.depth',featureId:'extrude.bracket',
  expectedRevision:created.history.document.revision,thicknessMm:14
},{runtime,model});
const restored=runtime.reopen(runtime.save(edited.history));
const features=model.featuresOf(restored.document);
const summary={
  kind:created.kind,sourceRevision:history.document.revision,
  bodySetRevision:created.history.document.revision,
  bodies:created.bodies.map(({bodyId,extrudeFeatureId,status,nativeHandoff})=>({
    bodyId,extrudeFeatureId,status,nativeCompatibility:nativeHandoff?.compatibility??null
  })),
  editedDepthMm:features.find(f=>f.id==='extrude.bracket').payload.thicknessMm,
  unchangedSpacerDepthMm:features.find(f=>f.id==='extrude.spacer').payload.thicknessMm,
  affected:edited.invalidation.invalidatedFeatureIds,
  reopenedCutStatus:runtime.inspect(restored).features.find(f=>f.featureId==='cut.bracket').status,
  exactAuthority:created.exactAuthority
};
if (summary.affected.includes('extrude.spacer'))
  throw new Error('unrelated spacer was invalidated');
console.log(JSON.stringify(summary,null,2));
