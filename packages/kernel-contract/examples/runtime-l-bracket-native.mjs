/**
 * Actual accepted INTENT+SKETCH+RUNTIME -> isolated native OCP STEP.
 * Six-sided L bracket, circular hole, 8 -> 14 mm retrospective edit,
 * dependency-aware rebuild and model save/reopen. Not pinned C++/external CAD.
 */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {runExperimentalRuntimeProfile} from '../src/runtime-profile-provider.mjs';
import {resolve,join} from 'node:path';
import {promises as fs} from 'node:fs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const out=resolve(process.argv[2]||'/tmp/intuit3d-runtime-l-bracket');
await fs.mkdir(out,{recursive:true});
const coords=[[-80,-50],[80,-50],[80,-10],[10,-10],[10,50],[-80,50]];
const points=coords.map(([x,y],i)=>({id:'corner.p'+i,x,y}));
const lines=points.map((p,i)=>({id:'line.'+i,start:p.id,
  end:points[(i+1)%points.length].id}));
points.push({id:'bolt.center',x:-50,y:0});
const authored=sketch.validateSketch({version:1,units:'mm',points,lines,
  circles:[{id:'bolt.circle',center:'bolt.center',radius:6}],
  constraints:[...points.map(p=>({id:'fixed.'+p.id,kind:'fixed',
    point:p.id,x:p.x,y:p.y})),
  {id:'bolt.radius',kind:'radius',circle:'bolt.circle',value:6}]});
const proposal=discovery.discoverPlateProfiles(authored);
if(proposal.status!=='ready'||proposal.candidates.length!==1)
  throw Error('SKETCH did not admit one solved L-profile');
let history=transactions.startUndoHistory(model.newProject('native.l.bracket'));
history=runtime.commit(history,[{eventId:'create.sketch',type:'feature.create',
  feature:{id:'sketch.bracket',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:authored}}}],history.document.revision);
history=runtime.commit(history,[{eventId:'create.extrude',type:'feature.create',
  feature:{id:'extrude.bracket',kind:'extrude',dependsOn:['sketch.bracket'],
    writeTargets:['body.bracket'],payload:{sourceSketchId:'sketch.bracket',
      thicknessMm:8,units:'mm',frame:'local_xy'}}}],history.document.revision);
const original=history,outputs=[];
for(let i=0;i<2;i++){
  if(i===1){
    history=runtime.commit(history,[{eventId:'edit.depth',type:'feature.edit',
      featureId:'extrude.bracket',patch:{payload:{sourceSketchId:'sketch.bracket',
        thicknessMm:14,units:'mm',frame:'local_xy'}}}],history.document.revision);
    history=runtime.reopen(runtime.save(history));
  }
  const report=runtime.inspect(history);
  const extrude=report.features.find(f=>f.featureId==='extrude.bracket');
  if(extrude?.status!=='preview_only'||extrude.profile?.outer?.length!==6)
    throw Error('RUNTIME did not retain the admitted L-profile');
  const result=await runExperimentalRuntimeProfile(report,'extrude.bracket',{
    requestId:'bracket.r'+report.revision,
    readCurrentRevision:()=>history.document.revision,
    stepOutput:join(out,'l-bracket-rev'+report.revision+'.step')});
  if(result.kind!=='experimental_profile_brep')throw Error(JSON.stringify(result));
  outputs.push({revision:report.revision,thicknessMm:extrude.thicknessMm,
    actualVolumeMm3:result.source.volumeMm3,
    analyticVolumeMm3:extrude.profile.areaMm2*extrude.thicknessMm,
    semanticBodyId:result.semanticBodyId,stepSha256:result.artifact.sha256,
    stepBytes:result.artifact.bytes});
}
if(outputs[0].actualVolumeMm3>=outputs[1].actualVolumeMm3||
  outputs[0].semanticBodyId!==outputs[1].semanticBodyId)
  throw Error('retrospective edit or semantic body identity failed');
const invalidation=runtime.diff(original,history);
if(!invalidation.invalidatedFeatureIds.includes('extrude.bracket')||
  invalidation.invalidatedFeatureIds.includes('sketch.bracket'))
  throw Error('dependency-aware invalidation failed');
await fs.writeFile(join(out,'authoritative-history.json'),runtime.save(history),{flag:'wx'});
await fs.writeFile(join(out,'manifest.json'),JSON.stringify({
  actualEngine:'OCP-7.9.3.1',nativeOcct8Qualified:false,independentCadQualified:false,
  selectedSketchAdmitted:true,invalidation,outputs},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'EXPERIMENTAL_REAL_BREP',outputs,invalidation},null,2));
