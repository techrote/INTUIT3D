/**
 * Real accepted INTENT/SKETCH/FEATUREOPS/RUNTIME -> isolated OCP Boolean ->
 * true STEP bytes. Two different authored sketches, no synthetic cut report.
 * Experimental OCP 7.9.3.1, NOT certified OCCT 8.0.1/external CAD.
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
import {runExperimentalRuntimeBodyCut,requestFromRuntimeBodyCut}
  from '../src/runtime-body-cut-provider.mjs';
import {promises as fs} from 'node:fs';
import {join,resolve} from 'node:path';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
const fmt={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,units:'mm',frame:'local_xy'};
const out=resolve(process.argv[2]||'/tmp/intuit3d-runtime-body-cut');
await fs.mkdir(out,{recursive:true});
const polygon=(vertices,circle)=>{
  const points=vertices.map(([x,y],i)=>({id:'vertex.'+i,x,y}));
  const lines=vertices.map((_,i)=>({id:'edge.'+i,start:points[i].id,
    end:points[(i+1)%points.length].id}));
  const circles=[];
  if(circle){points.push({id:'bore.center',x:circle.x,y:circle.y});
    circles.push({id:'bore.circle',center:'bore.center',radius:circle.r});}
  const constraints=points.map(p=>({id:'fixed.'+p.id,kind:'fixed',
    point:p.id,x:p.x,y:p.y}));
  if(circle)constraints.push({id:'bore.radius',kind:'radius',
    circle:'bore.circle',value:circle.r});
  return sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
};
const base=polygon([[-80,-50],[80,-50],[80,-10],[10,-10],[10,50],[-80,50]],
  {x:-50,y:0,r:6});
const window=polygon([[-42,-34],[-26,-34],[-26,-22],[-42,-22]]);
const candidate=s=>{const result=discovery.discoverPlateProfiles(s);
  if(result.status!=='ready'||result.candidates.length!==1)throw Error('unsolved sketch');
  return result.candidates[0].id;};
let history=transactions.startUndoHistory(model.newProject('runtime.body.cut.demo'));
for(const [id,source] of [['sketch.bracket',base],['sketch.window',window]]){
  history=runtime.commit(history,[{eventId:'create.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:source}}}],
    history.document.revision);
}
const extruded=authorProfileExtrusion(history,{
  ...fmt,eventId:'create.extrude',expectedRevision:history.document.revision,
  sourceSketchId:'sketch.bracket',profileCandidateId:candidate(base),
  extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',depthMm:8
},services);
const cut=authorProfileBodyCut(extruded.history,{
  ...fmt,eventId:'create.cut',expectedRevision:extruded.history.document.revision,
  sourceSketchId:'sketch.window',profileCandidateId:candidate(window),
  extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.window',
  targetBodyId:'body.bracket'
},services);
history=cut.history;
const initial=history;
const results=[];
const run=async label=>{
  const q=requestFromRuntimeBodyCut(history,'cut.window',{
    runtime,model,requestId:'native.'+label,exportStep:true});
  const result=await runExperimentalRuntimeBodyCut(history,'cut.window',{
    runtime,model,requestId:q.requestId,readCurrentRevision:()=>history.document.revision,
    stepOutput:join(out,label+'.step'),
    pythonExecutable:process.env.INTUIT3D_OCP_PYTHON ||
      (process.platform==='win32'?'python':'python3')});
  if(result.kind!=='experimental_body_cut_brep')throw Error(JSON.stringify(result));
  const expected=(11800-Math.PI*36-192)*q.baseExtrude.thicknessMm;
  if(Math.abs(result.source.volumeMm3-expected)>1e-6 ||
     Math.abs(result.stepReadback.volumeMm3-expected)>1e-6)
    throw Error('actual native cut material volume incorrect');
  results.push({label,revision:history.document.revision,
    bodyId:result.targetBodyId,extrusionDepthMm:q.baseExtrude.thicknessMm,
    volumeMm3:result.source.volumeMm3,stepBytes:result.artifact.bytes,
    stepSha256:result.artifact.sha256});
};
await run('initial-8mm');
const edited=editExtrudeThickness(history,{eventId:'edit.depth',
  featureId:'extrude.bracket',expectedRevision:history.document.revision,
  thicknessMm:14},services);
if(!edited.invalidation.invalidatedFeatureIds.includes('cut.window') ||
   !edited.invalidation.invalidatedFeatureIds.includes('extrude.bracket') ||
   edited.invalidation.invalidatedFeatureIds.includes('sketch.window'))
  throw Error('dependency-aware rebuild cut was not invalidated');
history=runtime.reopen(runtime.save(edited.history));
await run('edited-14mm');
if(results[0].bodyId!==results[1].bodyId||
   results[0].stepSha256===results[1].stepSha256||
   results[1].volumeMm3<=results[0].volumeMm3)
  throw Error('retrospective edit did not regenerate native body');
const undone=runtime.undo(edited.history,['undo.depth']);
const redone=runtime.redo(undone,['redo.depth']);
if(requestFromRuntimeBodyCut(redone,'cut.window',{
  runtime,model,requestId:'native.redo'}).baseExtrude.thicknessMm!==14)
  throw Error('undo/redo did not retain edited cut dependency');
await fs.writeFile(join(out,'history.json'),runtime.save(history),{flag:'wx'});
await fs.writeFile(join(out,'manifest.json'),JSON.stringify({
  execution:'real-OCP-7.9.3.1-experimental',
  qualifiedOCCT8Cxx:false,independentCadInterop:false,
  initialRevision:initial.document.revision,
  invalidation:edited.invalidation,results
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind:'EXPERIMENTAL_REAL_SEPARATELY_AUTHORED_BODY_CUT',
  invalidation:edited.invalidation,results},null,2));
