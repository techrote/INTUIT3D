import {orientCircularBoltPattern,BOLT_ORIENTATION_FORMAT,BOLT_ORIENTATION_VERSION} from '../src/circular-bolt-transform.mjs';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {authorCircularBoltPattern,resizeCircularBoltPattern,CIRCULAR_BOLT_PATTERN_FORMAT,CIRCULAR_BOLT_PATTERN_VERSION} from '../src/circular-bolt-pattern.mjs';
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

const resized=resizeCircularBoltPattern(redo,{
 format:CIRCULAR_BOLT_PATTERN_FORMAT,version:CIRCULAR_BOLT_PATTERN_VERSION,
 eventId:'resize.bolt.circle',expectedProjectId:redo.document.projectId,
 expectedRevision:redo.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.bracket',extrudeFeatureId:'extrude.bracket',
 cutFeatureId:'cut.bracket',targetBodyId:'body.bracket',
 pattern:{sourceHoleId:'bracket.hole',idPrefix:'bolt.circle',instances:6,
  pivotXmm:-50,pivotYmm:10,sweepDegrees:360,
  pitchCircleScale:1.2,boreRadiusScale:0.75}
},{runtime,model,sketch});
if(resized.kind!=='committed')throw Error('bolt-circle retrospective edit rejected: '+resized.code);
if(resized.holeIds.length!==6||resized.dimensions.newPitchCircleRadiusMm!==18||
 resized.dimensions.newBoreRadiusMm!==3)throw Error('incorrect resized dimensions');
const undoneResize=runtime.undo(resized.history,['undo.resize']);
const originalSketch=model.featuresOf(undoneResize.document)
 .find(f=>f.id==='sketch.bracket').payload.sketch;
const originalSolution=sketch.solveSketch(originalSketch);
if(originalSolution.status!=='solved'||
 Math.abs(originalSolution.geometry.circles.find(c=>c.id==='bracket.hole').radius-4)>1e-8)
 throw Error('undo did not restore original hole radius');
const redoneResize=runtime.redo(undoneResize,['redo.resize']);
const oriented=orientCircularBoltPattern(redoneResize,{
 format:BOLT_ORIENTATION_FORMAT,version:BOLT_ORIENTATION_VERSION,
 eventId:'orient.bolt.circle',expectedProjectId:redoneResize.document.projectId,
 expectedRevision:redoneResize.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.bracket',extrudeFeatureId:'extrude.bracket',
 cutFeatureId:'cut.bracket',targetBodyId:'body.bracket',
 orientation:{sourceHoleId:'bracket.hole',idPrefix:'bolt.circle',instances:6,
  pivotXmm:-50,pivotYmm:10,sweepDegrees:360,
  rotateDegrees:15,translateXmm:2,translateYmm:-1}
},{runtime,model,sketch});
if(oriented.kind!=='committed')throw Error('bolt-circle orientation refused: '+oriented.code);
const undoOrientation=runtime.undo(oriented.history,['undo.orientation']);
const undoneOrientationSketch=model.featuresOf(undoOrientation.document)
 .find(f=>f.id==='sketch.bracket').payload.sketch;
const unrotated=sketch.solveSketch(undoneOrientationSketch);
const undoneSource=unrotated.geometry.points.find(p=>p.id==='bracket.center');
if(unrotated.status!=='solved'||Math.hypot(undoneSource.x+50,undoneSource.y-28)>1e-6)
 throw Error('orientation undo failed');
const redoOrientation=runtime.redo(undoOrientation,['redo.orientation']);
// The current pivot is returned by the first edit, not inferred from an old
// chronological fixture. An obsolete pivot must fail provenance before write.
const nextRequest={
 format:BOLT_ORIENTATION_FORMAT,version:BOLT_ORIENTATION_VERSION,
 eventId:'orient.bolt.circle.second',
 expectedProjectId:redoOrientation.document.projectId,
 expectedRevision:redoOrientation.document.revision,
 units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.bracket',extrudeFeatureId:'extrude.bracket',
 cutFeatureId:'cut.bracket',targetBodyId:'body.bracket',
 orientation:{sourceHoleId:'bracket.hole',idPrefix:'bolt.circle',instances:6,
  pivotXmm:oriented.movedPivot.xMm,pivotYmm:oriented.movedPivot.yMm,
  sweepDegrees:360,rotateDegrees:-5,translateXmm:-1,translateYmm:2}
};
let stalePivotRejected=false;
try {
 orientCircularBoltPattern(redoOrientation,{
  ...nextRequest,eventId:'orient.bolt.circle.stale.pivot',
  orientation:{...nextRequest.orientation,pivotXmm:-50,pivotYmm:10}
 },{runtime,model,sketch});
} catch(error) {
 stalePivotRejected=/provenance/.test(String(error));
}
if(!stalePivotRejected)throw Error('old-pattern pivot was not rejected');
const secondOrientation=orientCircularBoltPattern(redoOrientation,nextRequest,
 {runtime,model,sketch});
if(secondOrientation.kind!=='committed'||
 secondOrientation.holeIds.join('|')!==oriented.holeIds.join('|')||
 secondOrientation.movedPivot.xMm!==-49||
 secondOrientation.movedPivot.yMm!==11)
 throw Error('second orientation rejected or lost stable bolt identities');
const undoSecond=runtime.undo(secondOrientation.history,['undo.second.orientation']);
const undoSecondSketch=model.featuresOf(undoSecond.document)
 .find(f=>f.id==='sketch.bracket').payload.sketch;
const undoSecondSolved=sketch.solveSketch(undoSecondSketch);
if(undoSecondSolved.status!=='solved'||
 undoSecondSolved.geometry.circles.length!==6)
 throw Error('second orientation undo did not restore solved bolt circle');
const redoSecond=runtime.redo(undoSecond,['redo.second.orientation']);
const modified=editExtrudeThickness(redoSecond,{
 eventId:'bracket.depth.12',expectedRevision:redoSecond.document.revision,featureId:'extrude.bracket',thicknessMm:12
},{runtime,model});
const reopened=runtime.reopen(runtime.save(modified.history));
const features=model.featuresOf(reopened.document);

const finalSketch=features.find(f=>f.id==='sketch.bracket').payload.sketch;
const solved=sketch.solveSketch(finalSketch);
if(solved.status!=='solved')throw Error('bolt circle did not survive archive reopening');
const geometry=solved.geometry;
for(const circle of finalSketch.circles){
 const position=geometry.points.find(p=>p.id===circle.center);
 const radius=geometry.circles.find(c=>c.id===circle.id)?.radius;
 if(Math.abs(Math.hypot(position.x+49,position.y-11)-18)>1e-6||
    Math.abs(radius-3)>1e-6)
  throw Error('archive replay lost bolt-circle radius or pitch: '+circle.id);
}
const state=runtime.inspect(reopened).features.find(f=>f.featureId==='cut.bracket')?.status;
const output={
 boltHoleCount:features.find(f=>f.id==='sketch.bracket').payload.sketch.circles.length,
 boltIds:features.find(f=>f.id==='sketch.bracket').payload.sketch.circles.map(c=>c.id),
 generatedHoleIds:patterned.generatedHoleIds,
 resizedHoleIds:resized.holeIds,
 orientedHoleIds:oriented.holeIds,movedPivot:oriented.movedPivot,
 chainedMovedPivot:secondOrientation.movedPivot,stalePivotRejected,
 invalidatedOnSecondOrientation:secondOrientation.invalidation.invalidatedFeatureIds,
 invalidatedOnOrientation:oriented.invalidation.invalidatedFeatureIds,
 pitchCircleRadiusMm:resized.dimensions.newPitchCircleRadiusMm,
 boreRadiusMm:resized.dimensions.newBoreRadiusMm,
 invalidatedOnResize:resized.invalidation.invalidatedFeatureIds,
 bracketDepthMm:features.find(f=>f.id==='extrude.bracket').payload.thicknessMm,
 independentSpacerDepthMm:features.find(f=>f.id==='extrude.spacer').payload.thicknessMm,
 invalidatedOnPattern:patterned.invalidation.invalidatedFeatureIds,
 invalidatedOnEdit:modified.invalidation.invalidatedFeatureIds,
 cutStatus:state,exactAuthority:patterned.exactAuthority
};
if(output.boltHoleCount!==6||output.bracketDepthMm!==12||output.independentSpacerDepthMm!==5||
 output.pitchCircleRadiusMm!==18||output.boreRadiusMm!==3||
 output.invalidatedOnResize.includes('extrude.spacer')||
 output.invalidatedOnOrientation.includes('extrude.spacer')||
 output.invalidatedOnSecondOrientation.includes('extrude.spacer')||
 !output.stalePivotRejected||output.chainedMovedPivot.xMm!==-49||
 output.chainedMovedPivot.yMm!==11||
 state!=='pending_exact_provider'||output.invalidatedOnEdit.includes('extrude.spacer'))
 throw Error('mechanical consumer failed: '+JSON.stringify(output));
console.log(JSON.stringify(output,null,2));
