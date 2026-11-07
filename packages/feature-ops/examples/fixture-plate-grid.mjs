/** Real FEATUREOPS INTENT/SKETCH/RUNTIME consumer, no C++/STEP claim. */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
 PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {authorRectangularHoleGrid,resizeRectangularHoleGrid,
 RECTANGULAR_HOLE_GRID_FORMAT,RECTANGULAR_HOLE_GRID_VERSION} from '../src/rectangular-hole-grid.mjs';
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={model,runtime,sketch,discovery};
function rectangle(name,x0,y0,x1,y1,hole){
 const corners=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
 const points=corners.map(([x,y],i)=>({id:`${name}.p${i}`,x,y}));
 const lines=points.map((p,i)=>({id:`${name}.edge${i}`,start:p.id,end:points[(i+1)%4].id}));
 const constraints=points.map(p=>({id:`fixed.${p.id}`,kind:'fixed',point:p.id,x:p.x,y:p.y}));
 const circles=[];
 if(hole){
  points.push({id:`${name}.center`,x:hole.x,y:hole.y});
  circles.push({id:`${name}.hole`,center:`${name}.center`,radius:hole.r});
  constraints.push({id:`fixed.${name}.center`,kind:'fixed',point:`${name}.center`,x:hole.x,y:hole.y},
   {id:`radius.${name}`,kind:'radius',circle:`${name}.hole`,value:hole.r});
 }
 return sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
}
const plate=rectangle('fixture',-80,-50,80,50,{x:-60,y:-30,r:2.5});
const spacer=rectangle('spacer',0,0,35,20);
let history=transactions.startUndoHistory(model.newProject('rectangular.fixture.grid'));
history=runtime.commit(history,[['sketch.fixture',plate],['sketch.spacer',spacer]]
 .map(([id,doc])=>({eventId:'create.'+id,type:'feature.create',
  feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}}})),
 history.document.revision);
function profileId(doc){
 const result=discovery.discoverPlateProfiles(doc);
 if(result.status!=='ready'||result.candidates.length!==1)
  throw Error('SKETCH profile admission failed');
 return result.candidates[0].id;
}
for(const [sketchId,doc,extrudeId,bodyId,depth] of [
 ['sketch.fixture',plate,'extrude.fixture','body.fixture',8],
 ['sketch.spacer',spacer,'extrude.spacer','body.spacer',5]]){
 const res=authorProfileExtrusion(history,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
  eventId:'create.'+extrudeId,expectedRevision:history.document.revision,
  units:'mm',frame:'local_xy',sourceSketchId:sketchId,
  profileCandidateId:profileId(doc),extrudeFeatureId:extrudeId,
  outputBodyId:bodyId,depthMm:depth},services);
 if(res.kind!=='committed')throw Error('extrude not admitted');
 history=res.history;
}
const cut=authorProfileBodyCut(history,{format:PROFILE_OPS_FORMAT,
 version:PROFILE_OPS_VERSION,eventId:'cut.fixture',expectedRevision:history.document.revision,
 units:'mm',frame:'local_xy',sourceSketchId:'sketch.fixture',
 profileCandidateId:profileId(plate),extrudeFeatureId:'extrude.fixture',
 cutFeatureId:'cut.fixture',targetBodyId:'body.fixture'},services);
if(cut.kind!=='committed')throw Error('cut not admitted');
history=cut.history;
function request(grid,eventId){return {
 format:RECTANGULAR_HOLE_GRID_FORMAT,version:RECTANGULAR_HOLE_GRID_VERSION,
 eventId,expectedProjectId:history.document.projectId,
 expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.fixture',extrudeFeatureId:'extrude.fixture',
 cutFeatureId:'cut.fixture',targetBodyId:'body.fixture',grid};}
const created=authorRectangularHoleGrid(history,request({sourceHoleId:'fixture.hole',
 idPrefix:'fixture.grid',columns:4,rows:3,pitchXmm:40,pitchYmm:30},'grid.create'),services);
if(created.kind!=='committed')throw Error('rectangular grid inadmissible: '+created.code);
history=created.history;
const beforeResize=history;
const resized=resizeRectangularHoleGrid(history,request({sourceHoleId:'fixture.hole',
 idPrefix:'fixture.grid',columns:4,rows:3,scaleX:.75,scaleY:1.2,radiusScale:1},
 'grid.resize'),services);
if(resized.kind!=='committed')throw Error('rectangular resize inadmissible: '+resized.code);
history=resized.history;
const afterResize=history;
const undo=runtime.undo(history,['grid.resize.undo']);
const undoneIds=model.featuresOf(undo.document).find(f=>f.id==='sketch.fixture')
 .payload.sketch.circles.map(c=>c.id);
if(undoneIds.length!==12)throw Error('undo lost grid holes');
const redo=runtime.redo(undo,['grid.resize.redo']);
const modified=editExtrudeThickness(redo,{eventId:'fixture.depth.12',
 expectedRevision:redo.document.revision,featureId:'extrude.fixture',thicknessMm:12},services);
const reopened=runtime.reopen(runtime.save(modified.history));
const parts=model.featuresOf(reopened.document);
const fixture=parts.find(f=>f.id==='sketch.fixture').payload.sketch;
const oldOriginal=model.featuresOf(beforeResize.document).find(f=>f.id==='sketch.fixture')
 .payload.sketch;
const newOriginal=model.featuresOf(afterResize.document).find(f=>f.id==='sketch.fixture')
 .payload.sketch;
const oldFirst=oldOriginal.circles.find(c=>c.id==='fixture.grid:r0c1');
const newFirst=newOriginal.circles.find(c=>c.id==='fixture.grid:r0c1');
// Authored point seeds are NOT solved coordinates after retrospective edits.
// Read both configurations through the authoritative SKETCH solver.
const oldX=sketch.solveSketch(sketch.validateSketch(oldOriginal)).geometry.points
 .find(p=>p.id===oldFirst.center).x;
const newX=sketch.solveSketch(sketch.validateSketch(newOriginal)).geometry.points
 .find(p=>p.id===newFirst.center).x;
const source=fixture.circles.find(c=>c.id==='fixture.hole');
const result={
 gridHoleCount:fixture.circles.length,generatedHoleIds:created.gridHoleIds,
 oldFirstGridXmm:oldX,newFirstGridXmm:newX,
 sourceHoleId:source.id,sourceRadiusMm:source.radius,
 fixtureThicknessMm:parts.find(f=>f.id==='extrude.fixture').payload.thicknessMm,
 independentSpacerThicknessMm:parts.find(f=>f.id==='extrude.spacer').payload.thicknessMm,
 invalidatedOnCreate:created.invalidation.invalidatedFeatureIds,
 invalidatedOnResize:resized.invalidation.invalidatedFeatureIds,
 invalidatedOnDepthEdit:modified.invalidation.invalidatedFeatureIds,
 cutStatus:runtime.inspect(reopened).features.find(f=>f.featureId==='cut.fixture')?.status,
 exactAuthority:false,independentInteroperability:false};
if(result.gridHoleCount!==12||result.generatedHoleIds.length!==11||
 Math.abs(oldX-(-20))>1e-7||Math.abs(newX-(-30))>1e-7||
 result.fixtureThicknessMm!==12||result.independentSpacerThicknessMm!==5||
 result.cutStatus!=='pending_exact_provider'||
 result.invalidatedOnDepthEdit.includes('extrude.spacer'))
 throw Error('real consumer regression: '+JSON.stringify(result));
console.log(JSON.stringify(result,null,2));
