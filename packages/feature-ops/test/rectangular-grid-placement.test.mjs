import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {placeRectangularHoleGrid,GRID_PLACEMENT_FORMAT,GRID_PLACEMENT_VERSION}
 from '../src/rectangular-grid-placement.mjs';
const report=revision=>({projectId:'grid.project',revision,features:[
 {featureId:'sketch.mount',status:'analytic_profile_only'},
 {featureId:'extrude.mount',status:'preview_only'},
 {featureId:'cut.mount',status:'pending_exact_provider'}
]});
function fixture(){
 const points=[],circles=[];
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
  const h=row===0&&col===0?'source.hole':'mount.grid:r'+row+'c'+col;
  points.push({id:h+':center',x:-30+col*20,y:-15+row*20});
  circles.push({id:h,center:h+':center',radius:2.5});
 }
 const doc={version:1,units:'mm',points,lines:[],circles,constraints:[]};
 const features=[
 {id:'sketch.mount',kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}},
 {id:'extrude.mount',kind:'extrude',dependsOn:['sketch.mount'],writeTargets:['body.mount'],
  payload:{sourceSketchId:'sketch.mount'}},
 {id:'cut.mount',kind:'cut',dependsOn:['extrude.mount','sketch.mount'],
  writeTargets:['body.mount'],payload:{sourceSketchId:'sketch.mount',targetBodyId:'body.mount'}}
 ];
 const history={document:{projectId:'grid.project',revision:9}};
 const request={
  format:GRID_PLACEMENT_FORMAT,version:GRID_PLACEMENT_VERSION,
  eventId:'move.grid',expectedProjectId:'grid.project',expectedRevision:9,
  units:'mm',frame:'local_xy',sketchFeatureId:'sketch.mount',
  extrudeFeatureId:'extrude.mount',cutFeatureId:'cut.mount',targetBodyId:'body.mount',
  placement:{sourceHoleId:'source.hole',idPrefix:'mount.grid',columns:3,rows:2,
   stepX:{dxMm:20,dyMm:0},stepY:{dxMm:0,dyMm:20},
   pivotXmm:0,pivotYmm:0,rotateDegrees:15,translateXmm:2,translateYmm:-1}
 };
 let next=doc;
 const calls=[];
 const runtime={inspect:()=>report(9),transformPlateHoles:(h,r)=>{
  calls.push(r);
  next=structuredClone(doc);
  const c=Math.cos(r.rotateDegrees*Math.PI/180),s=Math.sin(r.rotateDegrees*Math.PI/180);
  for(const circle of next.circles){
   const point=next.points.find(p=>p.id===circle.center);
   const dx=point.x-r.pivotXmm,dy=point.y-r.pivotYmm;
   point.x=r.pivotXmm+c*dx-s*dy+r.translateXmm;
   point.y=r.pivotYmm+s*dx+c*dy+r.translateYmm;
  }
  return {kind:'committed',history:{document:{projectId:'grid.project',revision:10}},
    report:report(10),
    invalidation:{invalidatedFeatureIds:['sketch.mount','extrude.mount','cut.mount']}};
 }};
 const model={featuresOf:d=>{
  if(d.revision===9)return features;
  const result=structuredClone(features);result[0].payload.sketch=next;return result;
 }};
 const sketch={validateSketch:d=>d,solveSketch:d=>({status:'solved',
  geometry:{points:d.points.map(p=>({...p})),
   circles:d.circles.map(c=>({id:c.id,radius:c.radius}))}})};
 return {history,request,services:{runtime,model,sketch},calls,features,doc};
}
test('atomic whole-grid rigid edit uses solved current source, preserves identities and exact boundary',()=>{
 const f=fixture(),result=placeRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(result.kind,'committed');
 assert.deepEqual(result.holeIds,['source.hole','mount.grid:r0c1','mount.grid:r0c2',
  'mount.grid:r1c0','mount.grid:r1c1','mount.grid:r1c2']);
 assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0],{
  sketchFeatureId:'sketch.mount',eventId:'move.grid',expectedRevision:9,
  admission:'require_admissible',holeIds:result.holeIds,
  rotateDegrees:15,translateXmm:2,translateYmm:-1,pivotXmm:0,pivotYmm:0
 });
 assert.equal(result.status,'pending_exact_provider');
 assert.equal(result.exactAuthority,false);
 assert.equal(result.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
 assert.equal(f.doc.points[0].x,-30,'source journal remains immutable');
});
test('real rotated basis is a valid retrospective second edit, not axis-aligned-only',()=>{
 const f=fixture(),angle=.35,c=Math.cos(angle),s=Math.sin(angle);
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
  const p=f.doc.points[row*3+col],x=p.x,y=p.y;
  p.x=c*x-s*y;p.y=s*x+c*y;
 }
 f.request.placement.stepX={dxMm:20*c,dyMm:20*s};
 f.request.placement.stepY={dxMm:-20*s,dyMm:20*c};
 f.request.placement.rotateDegrees=0;
 const result=placeRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(result.kind,'committed');assert.equal(f.calls[0].rotateDegrees,0);
});
test('incomplete, drifted or independently resized pattern never reaches RUNTIME',()=>{
 for(const [label,mutate] of Object.entries({
  stale:f=>f.request.expectedRevision=8,
  project:f=>f.request.expectedProjectId='another',
  units:f=>f.request.units='cm',
  frame:f=>f.request.frame='world_xy',
  extra:f=>f.request.placement.unexpected=1,
  missing:f=>f.doc.circles.splice(2,1),
  drift:f=>f.doc.points[4].x+=.1,
  radius:f=>f.doc.circles[5].radius=3,
  wrongBody:f=>f.features[2].payload.targetBodyId='wrong',
  writer:f=>f.features.push({id:'other',writeTargets:['body.mount']}),
  revisionReport:f=>f.services.runtime.inspect=()=>report(8),
  zero:f=>f.request.placement.stepX={dxMm:0,dyMm:0},
  skew:f=>f.request.placement.stepY={dxMm:1,dyMm:20},
  noop:f=>{f.request.placement.rotateDegrees=0;f.request.placement.translateXmm=0;f.request.placement.translateYmm=0;},
  overflow:f=>f.request.placement.translateXmm=Infinity,
  tooMany:f=>{f.request.placement.columns=8;f.request.placement.rows=8;},
  collision:f=>f.request.placement.idPrefix='source.hole',
  invalidRole:f=>f.features[0].writeTargets=['body.mount'],
  solver:f=>f.services.sketch.solveSketch=()=>({status:'unsolved'})
 })){
  const f=fixture();mutate(f);
  assert.throws(()=>placeRectangularHoleGrid(f.history,f.request,f.services),
    undefined,'must refuse '+label);
  assert.equal(f.calls.length,0,'runtime not called for '+label);
 }
});
test('runtime refusal preserves immutable source with truthful pending status',()=>{
 const f=fixture();
 f.services.runtime.transformPlateHoles=()=>({kind:'refused',code:'inadmissible_sketch',
  notCommitted:true,sourceRevision:9});
 const r=placeRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(r.kind,'refused');assert.equal(r.notCommitted,true);
 assert.equal(r.history,undefined);assert.equal(r.exactAuthority,false);
});
test('post-commit false geometry cannot be advertised as successful',()=>{
 const f=fixture();
 f.services.runtime.transformPlateHoles=()=>({kind:'committed',
  history:{document:{projectId:'grid.project',revision:10}},
  report:report(10),invalidation:{invalidatedFeatureIds:[
   'sketch.mount','extrude.mount','cut.mount']}});
 assert.throws(()=>placeRectangularHoleGrid(f.history,f.request,f.services),
  /actual solved rigid edit differs/);
});
test('real authored fixture consumer: rotation/translation, undo/redo, earlier depth edit, reopen',()=>{
 const script=fileURLToPath(new URL('../examples/fixture-grid-placement.mjs',import.meta.url));
 const result=spawnSync(process.execPath,['--experimental-strip-types',script],{
  encoding:'utf8',timeout:40000,maxBuffer:1024*1024});
 assert.equal(result.status,0,result.stderr||result.stdout);
 const output=JSON.parse(result.stdout);
 assert.equal(output.gridHoles,12);
 assert.equal(output.fixtureThicknessMm,12);
 assert.equal(output.spacerThicknessMm,5);
 assert.equal(output.cutStatus,'pending_exact_provider');
 assert.equal(output.exactAuthority,false);
 assert.equal(output.undoRestoredPrevious,true);
 assert.equal(output.redoRestoredPlacement,true);
 assert.equal(output.secondUndoRestoredFirst,true);
 assert.equal(output.secondRedoRestoredSecond,true);
 assert.notDeepEqual(output.afterFirstPlacementXYmm,output.afterSecondPlacementXYmm);
 assert.equal(output.reopenedSolvedMatches,true);
 assert.equal(output.outOfBoundsRefused,true);
});
