/** Authoritative INTENT + SKETCH + FEATUREOPS + RUNTIME -> experimental
 * real OCP plate, two bores and an edge-crossing notch -> physical STEP.
 * Retrospective extrusion depth, undo/redo and archive reopen are exercised.
 */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '@intuit3d/feature-ops';
import {requestFromRuntimePerimeterNotch,runExperimentalRuntimePerimeterNotch}
  from '../src/runtime-body-cut-provider.mjs';
import {promises as fs} from 'node:fs';
import {resolve,join} from 'node:path';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,
  sketch,discovery});
const services={runtime,model,sketch,discovery};
const fmt={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
  units:'mm',frame:'local_xy'};
const out=resolve(process.argv[2]||'/tmp/unique-runtime-notch-demo');
await fs.mkdir(out,{recursive:true});
const makeSketch=(vertices,bores=[])=>{
  const points=vertices.map(([x,y],i)=>({id:'vertex.'+i,x,y}));
  const lines=vertices.map((_,i)=>({id:'edge.'+i,
    start:'vertex.'+i,end:'vertex.'+((i+1)%vertices.length)}));
  const circles=bores.map((b,i)=>{
    const center='bore.'+i;
    points.push({id:center,x:b.x,y:b.y});
    return {id:'circle.'+i,center,radius:b.r};
  });
  const constraints=points.map(p=>({id:'fixed.'+p.id,
    kind:'fixed',point:p.id,x:p.x,y:p.y}));
  bores.forEach((b,i)=>constraints.push({id:'radius.'+i,kind:'radius',
    circle:'circle.'+i,value:b.r}));
  return sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
};
const plate=makeSketch([[-60,-40],[60,-40],[60,40],[-60,40]],
  [{x:-30,y:0,r:6},{x:30,y:0,r:6}]);
const notch=makeSketch([[50,-10],[70,-10],[70,10],[50,10]]);
const selected=s=>{
  const report=discovery.discoverPlateProfiles(s);
  if(report.status!=='ready'||report.candidates.length!==1)
    throw Error('selected sketch must have one solved profile');
  return report.candidates[0].id;
};
let history=transactions.startUndoHistory(model.newProject('runtime.notch.demo'));
for(const [id,source] of [['sketch.plate',plate],['sketch.notch',notch]]){
  history=runtime.commit(history,[{eventId:'create.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:source}}}],history.document.revision);
}
const extruded=authorProfileExtrusion(history,{
  ...fmt,eventId:'create.extrusion',expectedRevision:history.document.revision,
  sourceSketchId:'sketch.plate',profileCandidateId:selected(plate),
  extrudeFeatureId:'extrude.plate',outputBodyId:'body.plate',depthMm:8
},services);
const authored=authorProfileBodyCut(extruded.history,{
  ...fmt,eventId:'create.notch',expectedRevision:extruded.history.document.revision,
  sourceSketchId:'sketch.notch',profileCandidateId:selected(notch),
  extrudeFeatureId:'extrude.plate',cutFeatureId:'cut.notch',targetBodyId:'body.plate'
},services);
history=authored.history;
const initialHistory=history;
const results=[];
async function evaluate(label){
  const q=requestFromRuntimePerimeterNotch(history,'cut.notch',{
    runtime,model,requestId:'notch.native.'+label,exportStep:true});
  const result=await runExperimentalRuntimePerimeterNotch(history,'cut.notch',{
    runtime,model,requestId:q.requestId,
    readCurrentRevision:()=>history.document.revision,
    stepOutput:join(out,label+'.step'),
    pythonExecutable:process.env.INTUIT3D_OCP_PYTHON||
      (process.platform==='win32'?'python':'python3')
  });
  if(result.kind!=='experimental_body_cut_brep')
    throw Error(JSON.stringify(result));
  const expected=(9600-2*Math.PI*36-200)*q.baseExtrude.thicknessMm;
  if(Math.abs(result.footprintIntersectionAreaMm2-200)>1e-7||
     Math.abs(result.source.volumeMm3-expected)>1e-6||
     Math.abs(result.stepReadback.volumeMm3-expected)>1e-6)
    throw Error('physical STEP does not match signed original dimensions');
  results.push({label,revision:history.document.revision,bodyId:result.targetBodyId,
    thicknessMm:q.baseExtrude.thicknessMm,volumeMm3:result.source.volumeMm3,
    stepBytes:result.artifact.bytes,stepSha256:result.artifact.sha256});
}
await evaluate('original-8mm');
const edited=editExtrudeThickness(history,{
  eventId:'edit.plate.thickness',featureId:'extrude.plate',
  expectedRevision:history.document.revision,thicknessMm:12
},services);
if(!edited.invalidation.invalidatedFeatureIds.includes('extrude.plate')||
   !edited.invalidation.invalidatedFeatureIds.includes('cut.notch')||
   edited.invalidation.invalidatedFeatureIds.includes('sketch.notch'))
  throw Error('dependency invalidation did not rebuild correct downstream cut');
history=runtime.reopen(runtime.save(edited.history));
await evaluate('edited-12mm');
const undone=runtime.undo(edited.history,['undo.depth']);
const redone=runtime.redo(undone,['redo.depth']);
const redoRequest=requestFromRuntimePerimeterNotch(redone,'cut.notch',{
  runtime,model,requestId:'native.redo'});
if(redoRequest.baseExtrude.thicknessMm!==12)
  throw Error('journal undo/redo lost extrusion dimension');
if(results[0].bodyId!==results[1].bodyId||
   results[0].stepSha256===results[1].stepSha256)
  throw Error('physical STEP edit or semantic body identity failure');
await fs.writeFile(join(out,'history.json'),runtime.save(history),{flag:'wx'});
const manifest={execution:'real-authored-runtime-edge-notch-OCP-7.9.3.1',
  qualifiedOCCT8Cxx:false,independentCadInterop:false,
  invalidation:edited.invalidation,results};
await fs.writeFile(join(out,'manifest.json'),
  JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(manifest,null,2));
