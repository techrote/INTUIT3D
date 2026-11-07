import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {authorCircularBoltPattern,CIRCULAR_BOLT_PATTERN_FORMAT,CIRCULAR_BOLT_PATTERN_VERSION} from '../src/circular-bolt-pattern.mjs';
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
function polygon(name,coordinates,hole) {
 const points=coordinates.map(([x,y],i)=>({id:name+'.p'+i,x,y}));
 const lines=points.map((p,i)=>({id:name+'.e'+i,start:p.id,end:points[(i+1)%points.length].id}));
 const constraints=points.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
 const circles=[];
 if(hole){
  const point={id:name+'.center',x:hole.x,y:hole.y};
  points.push(point);circles.push({id:name+'.hole',center:point.id,radius:hole.r});
  constraints.push({id:'fixed.'+point.id,kind:'fixed',point:point.id,x:point.x,y:point.y},
   {id:'radius.'+name,kind:'radius',circle:name+'.hole',value:hole.r});
 }
 return sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
}
const bracket=polygon('bracket',[[-80,-50],[80,-50],[80,-20],[-20,-20],[-20,50],[-80,50]],{x:-50,y:25,r:4});
const spacer=polygon('spacer',[[0,0],[40,0],[40,20],[0,20]]);
let history=transactions.startUndoHistory(model.newProject('bolt.circle.bracket'));
history=runtime.commit(history,[['sketch.bracket',bracket],['sketch.spacer',spacer]].map(([id,doc])=>({
 eventId:'create.'+id,type:'feature.create',feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}}
})),history.document.revision);
const candidate=doc=>{
 const p=discovery.discoverPlateProfiles(doc);
 if(p.status!=='ready'||p.candidates?.length!==1)throw Error('SKETCH admission not ready');
 return p.candidates[0].id;
};
for(const [sketchId,doc,extrudeId,bodyId,depth] of [
 ['sketch.bracket',bracket,'extrude.bracket','body.bracket',8],
 ['sketch.spacer',spacer,'extrude.spacer','body.spacer',5]]) {
 history=authorProfileExtrusion(history,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
 eventId:'create.'+extrudeId,expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
 sourceSketchId:sketchId,profileCandidateId:candidate(doc),extrudeFeatureId:extrudeId,
 outputBodyId:bodyId,depthMm:depth},services).history;
}
history=authorProfileBodyCut(history,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
 eventId:'create.cut.bracket',expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
 sourceSketchId:'sketch.bracket',profileCandidateId:candidate(bracket),
 extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.bracket',
 targetBodyId:'body.bracket'},services).history;
const patterned=authorCircularBoltPattern(history,{
 format:CIRCULAR_BOLT_PATTERN_FORMAT,version:CIRCULAR_BOLT_PATTERN_VERSION,
 eventId:'pattern.bolt.circle',expectedProjectId:history.document.projectId,
 expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.bracket',extrudeFeatureId:'extrude.bracket',
 cutFeatureId:'cut.bracket',targetBodyId:'body.bracket',
 pattern:{sourceHoleId:'bracket.hole',idPrefix:'bolt.circle',instances:6,
 pivotXmm:-50,pivotYmm:10,sweepDegrees:360}
},{runtime,model});
if(patterned.kind!=='committed')throw Error('pattern rejected: '+patterned.code);
const undo=runtime.undo(patterned.history,['undo.circle']);
if(model.featuresOf(undo.document).find(f=>f.id==='sketch.bracket').payload.sketch.circles.length!==1)
 throw Error('undo failed to restore original single-hole sketch');
const redo=runtime.redo(undo,['redo.circle']);
const modified=editExtrudeThickness(redo,{
 eventId:'bracket.depth.12',expectedRevision:redo.document.revision,featureId:'extrude.bracket',thicknessMm:12
},{runtime,model});
const reopened=runtime.reopen(runtime.save(modified.history));
const features=model.featuresOf(reopened.document);
const state=runtime.inspect(reopened).features.find(f=>f.featureId==='cut.bracket')?.status;
const output={
 boltHoleCount:features.find(f=>f.id==='sketch.bracket').payload.sketch.circles.length,
 boltIds:features.find(f=>f.id==='sketch.bracket').payload.sketch.circles.map(c=>c.id),
 generatedHoleIds:patterned.generatedHoleIds,
 bracketDepthMm:features.find(f=>f.id==='extrude.bracket').payload.thicknessMm,
 independentSpacerDepthMm:features.find(f=>f.id==='extrude.spacer').payload.thicknessMm,
 invalidatedOnPattern:patterned.invalidation.invalidatedFeatureIds,
 invalidatedOnEdit:modified.invalidation.invalidatedFeatureIds,
 cutStatus:state,exactAuthority:patterned.exactAuthority
};
if(output.boltHoleCount!==6||output.bracketDepthMm!==12||output.independentSpacerDepthMm!==5||
 state!=='pending_exact_provider'||output.invalidatedOnEdit.includes('extrude.spacer'))
 throw Error('mechanical consumer failed: '+JSON.stringify(output));
console.log(JSON.stringify(output,null,2));
