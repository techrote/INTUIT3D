/** Real INTENT/SKETCH/RUNTIME mechanical fixture consumer. No B-rep/STEP claim. */
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
import {authorRectangularHoleGrid,RECTANGULAR_HOLE_GRID_FORMAT,
 RECTANGULAR_HOLE_GRID_VERSION} from '../src/rectangular-hole-grid.mjs';
import {placeRectangularHoleGrid,GRID_PLACEMENT_FORMAT,GRID_PLACEMENT_VERSION}
 from '../src/rectangular-grid-placement.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={model,runtime,sketch,discovery};
function rectangle(name,x0,y0,x1,y1,hole){
 const corners=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
 const points=corners.map(([x,y],i)=>({id:name+'.p'+i,x,y}));
 const lines=points.map((p,i)=>({id:name+'.edge'+i,start:p.id,
  end:points[(i+1)%4].id}));
 const constraints=points.map(p=>({id:'fixed.'+p.id,kind:'fixed',
  point:p.id,x:p.x,y:p.y}));
 const circles=[];
 if(hole){
  points.push({id:name+'.center',x:hole.x,y:hole.y});
  circles.push({id:name+'.hole',center:name+'.center',radius:hole.r});
  constraints.push({id:'fixed.'+name+'.center',kind:'fixed',point:name+'.center',
    x:hole.x,y:hole.y},{id:'radius.'+name,kind:'radius',
    circle:name+'.hole',value:hole.r});
 }
 return sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
}
const plate=rectangle('fixture',-80,-50,80,50,{x:-60,y:-30,r:2.5});
const spacer=rectangle('spacer',0,0,35,20);
let history=transactions.startUndoHistory(model.newProject('rectangular.fixture.placement'));
history=runtime.commit(history,[['sketch.fixture',plate],['sketch.spacer',spacer]]
 .map(([id,doc])=>({eventId:'create.'+id,type:'feature.create',
   feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:doc}}})),history.document.revision);
function profileId(doc){
 const d=discovery.discoverPlateProfiles(doc);
 if(d.status!=='ready'||d.candidates.length!==1)
  throw Error('SKETCH profile discovery refused');
 return d.candidates[0].id;
}
for(const [sketchId,doc,extrudeId,bodyId,depth] of [
 ['sketch.fixture',plate,'extrude.fixture','body.fixture',8],
 ['sketch.spacer',spacer,'extrude.spacer','body.spacer',5]]){
 const result=authorProfileExtrusion(history,{
  format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
  eventId:'create.'+extrudeId,expectedRevision:history.document.revision,
  units:'mm',frame:'local_xy',sourceSketchId:sketchId,
  profileCandidateId:profileId(doc),extrudeFeatureId:extrudeId,
  outputBodyId:bodyId,depthMm:depth},services);
 if(result.kind!=='committed')throw Error('extrude refused');
 history=result.history;
}
const cut=authorProfileBodyCut(history,{
 format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
 eventId:'cut.fixture',expectedRevision:history.document.revision,
 units:'mm',frame:'local_xy',sourceSketchId:'sketch.fixture',
 profileCandidateId:profileId(plate),extrudeFeatureId:'extrude.fixture',
 cutFeatureId:'cut.fixture',targetBodyId:'body.fixture'},services);
if(cut.kind!=='committed')throw Error('cut refused');
history=cut.history;
const grid=authorRectangularHoleGrid(history,{
 format:RECTANGULAR_HOLE_GRID_FORMAT,version:RECTANGULAR_HOLE_GRID_VERSION,
 eventId:'grid.author',expectedProjectId:history.document.projectId,
 expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.fixture',extrudeFeatureId:'extrude.fixture',
 cutFeatureId:'cut.fixture',targetBodyId:'body.fixture',
 grid:{sourceHoleId:'fixture.hole',idPrefix:'fixture.grid',
  columns:4,rows:3,pitchXmm:40,pitchYmm:30}},services);
if(grid.kind!=='committed')throw Error('grid creation refused: '+grid.code);
history=grid.history;
function sourceXY(h){
 const doc=model.featuresOf(h.document).find(f=>f.id==='sketch.fixture').payload.sketch;
 const circle=doc.circles.find(c=>c.id==='fixture.hole');
 const solution=sketch.solveSketch(sketch.validateSketch(doc));
 if(solution.status!=='solved')throw Error('actual sketch no longer solved');
 const p=solution.geometry.points.find(p=>p.id===circle.center);
 return [p.x,p.y];
}
const before=history,old=sourceXY(history);
// A visibly off-plate displacement must be refused by the *real* SKETCH
// admission, without consuming the captured source revision.
const outside=placeRectangularHoleGrid(history,{
 format:GRID_PLACEMENT_FORMAT,version:GRID_PLACEMENT_VERSION,
 eventId:'grid.reject.outside',expectedProjectId:history.document.projectId,
 expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.fixture',extrudeFeatureId:'extrude.fixture',
 cutFeatureId:'cut.fixture',targetBodyId:'body.fixture',
 placement:{sourceHoleId:'fixture.hole',idPrefix:'fixture.grid',
  columns:4,rows:3,stepX:{dxMm:40,dyMm:0},stepY:{dxMm:0,dyMm:30},
  pivotXmm:0,pivotYmm:0,rotateDegrees:0,
  translateXmm:60,translateYmm:0}},services);
const outOfBoundsRefused=outside.kind==='refused'&&outside.notCommitted&&
 outside.code==='inadmissible_sketch';
if(!outOfBoundsRefused||history.document.revision!==before.document.revision)
 throw Error('actual out-of-plate displacement was not safely refused');
const move=placeRectangularHoleGrid(history,{
 format:GRID_PLACEMENT_FORMAT,version:GRID_PLACEMENT_VERSION,
 eventId:'grid.rotate.and.move',expectedProjectId:history.document.projectId,
 expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.fixture',extrudeFeatureId:'extrude.fixture',
 cutFeatureId:'cut.fixture',targetBodyId:'body.fixture',
 placement:{sourceHoleId:'fixture.hole',idPrefix:'fixture.grid',columns:4,rows:3,
  stepX:{dxMm:40,dyMm:0},stepY:{dxMm:0,dyMm:30},
  pivotXmm:0,pivotYmm:0,rotateDegrees:10,
  translateXmm:2,translateYmm:-1}},services);
if(move.kind!=='committed')throw Error('grid placement refused: '+move.code);
history=move.history;
const moved=sourceXY(history);
const undo=runtime.undo(history,['grid.rotate.undo']);
const undone=sourceXY(undo);
const redo=runtime.redo(undo,['grid.rotate.redo']);
const redone=sourceXY(redo);
const close=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6;
const undoRestoredPrevious=close(undone,old);
const redoRestoredPlacement=close(redone,moved);
if(!undoRestoredPrevious||!redoRestoredPlacement)
 throw Error('grid undo/redo changed solved positions');
// Apply a SECOND real CAD command against the already-rotated solved grid.
// The vectors are in current local coordinates; reusing the old axis-aligned
// pitches must fail provenance rather than moving a mistakenly selected array.
const angle=10*Math.PI/180;
const second=placeRectangularHoleGrid(redo,{
 format:GRID_PLACEMENT_FORMAT,version:GRID_PLACEMENT_VERSION,
 eventId:'grid.rotate.second',expectedProjectId:redo.document.projectId,
 expectedRevision:redo.document.revision,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.fixture',extrudeFeatureId:'extrude.fixture',
 cutFeatureId:'cut.fixture',targetBodyId:'body.fixture',
 placement:{sourceHoleId:'fixture.hole',idPrefix:'fixture.grid',
  columns:4,rows:3,
  stepX:{dxMm:40*Math.cos(angle),dyMm:40*Math.sin(angle)},
  stepY:{dxMm:-30*Math.sin(angle),dyMm:30*Math.cos(angle)},
  pivotXmm:0,pivotYmm:0,rotateDegrees:-4,
  translateXmm:-1,translateYmm:0.5}},services);
if(second.kind!=='committed')throw Error('second grid placement refused: '+second.code);
const twice=sourceXY(second.history);
const secondUndone=runtime.undo(second.history,['grid.second.undo']);
const secondRedone=runtime.redo(secondUndone,['grid.second.redo']);
const secondUndoRestoredFirst=close(sourceXY(secondUndone),moved);
const secondRedoRestoredSecond=close(sourceXY(secondRedone),twice);
if(!secondUndoRestoredFirst||!secondRedoRestoredSecond||close(moved,twice))
 throw Error('repeated retrospective grid placement lost solved positions');
const modified=editExtrudeThickness(secondRedone,{
 eventId:'fixture.depth.12',expectedRevision:redo.document.revision,
 featureId:'extrude.fixture',thicknessMm:12},services);
const reopened=runtime.reopen(runtime.save(modified.history));
const parts=model.featuresOf(reopened.document);
const circles=parts.find(f=>f.id==='sketch.fixture').payload.sketch.circles;
const reopenedSolvedMatches=close(sourceXY(reopened),twice);
const outcome={
 gridHoles:circles.length,
 beforeSourceXYmm:old,afterFirstPlacementXYmm:moved,afterSecondPlacementXYmm:twice,
 undoRestoredPrevious,redoRestoredPlacement,secondUndoRestoredFirst,
 secondRedoRestoredSecond,reopenedSolvedMatches,outOfBoundsRefused,
 fixtureThicknessMm:parts.find(f=>f.id==='extrude.fixture').payload.thicknessMm,
 spacerThicknessMm:parts.find(f=>f.id==='extrude.spacer').payload.thicknessMm,
 invalidatedOnPlacement:move.invalidation.invalidatedFeatureIds,
 invalidatedOnSecondPlacement:second.invalidation.invalidatedFeatureIds,
 cutStatus:runtime.inspect(reopened).features
  .find(f=>f.featureId==='cut.fixture')?.status,
 exactAuthority:false,independentInteroperability:false
};
if(outcome.gridHoles!==12||!reopenedSolvedMatches||!outOfBoundsRefused||
 !secondUndoRestoredFirst||!secondRedoRestoredSecond||
 outcome.fixtureThicknessMm!==12||outcome.spacerThicknessMm!==5||
 outcome.cutStatus!=='pending_exact_provider'||
 !['sketch.fixture','extrude.fixture','cut.fixture'].every(id=>
  outcome.invalidatedOnPlacement.includes(id))||
 outcome.invalidatedOnPlacement.includes('extrude.spacer')||
 !['sketch.fixture','extrude.fixture','cut.fixture'].every(id=>
  outcome.invalidatedOnSecondPlacement.includes(id))||
 outcome.invalidatedOnSecondPlacement.includes('extrude.spacer')||
 close(old,moved)||close(moved,twice))
 throw Error('real CAD consumer regression: '+JSON.stringify(outcome));
console.log(JSON.stringify(outcome,null,2));
