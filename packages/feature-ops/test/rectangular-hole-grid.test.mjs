import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {authorRectangularHoleGrid,resizeRectangularHoleGrid,
 RECTANGULAR_HOLE_GRID_FORMAT,RECTANGULAR_HOLE_GRID_VERSION} from '../src/rectangular-hole-grid.mjs';
const report=rev=>({projectId:'grid.project',revision:rev,features:[
 {featureId:'sketch.mount',status:'analytic_profile_only'},
 {featureId:'extrude.mount',status:'preview_only'},
 {featureId:'cut.mount',status:'pending_exact_provider'}]});
function fixture(){
 const sk={points:[{id:'source.center',x:-60,y:-30}],lines:[],
  circles:[{id:'source.hole',center:'source.center',radius:2.5}],constraints:[]};
 const features=[
  {id:'sketch.mount',kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:sk}},
  {id:'extrude.mount',kind:'extrude',dependsOn:['sketch.mount'],writeTargets:['body.mount'],
   payload:{sourceSketchId:'sketch.mount'}},
  {id:'cut.mount',kind:'cut',dependsOn:['extrude.mount','sketch.mount'],
   writeTargets:['body.mount'],payload:{sourceSketchId:'sketch.mount',targetBodyId:'body.mount'}}];
 const history={document:{projectId:'grid.project',revision:9}};
 const request={format:RECTANGULAR_HOLE_GRID_FORMAT,version:RECTANGULAR_HOLE_GRID_VERSION,
  eventId:'event.grid',expectedProjectId:'grid.project',expectedRevision:9,
  units:'mm',frame:'local_xy',sketchFeatureId:'sketch.mount',extrudeFeatureId:'extrude.mount',
  cutFeatureId:'cut.mount',targetBodyId:'body.mount',
  grid:{sourceHoleId:'source.hole',idPrefix:'mount.grid',columns:3,rows:2,
   pitchXmm:40,pitchYmm:30}};
 const calls=[];
 let nextSketch;
 const result=()=>({kind:'committed',history:{document:{projectId:'grid.project',revision:10}},
  report:report(10),invalidation:{invalidatedFeatureIds:['sketch.mount','extrude.mount','cut.mount']}});
 const runtime={inspect:()=>report(9),patternPlateHoles:(h,r)=>{
  calls.push({kind:'create',r});nextSketch=structuredClone(sk);
  for(let row=0;row<r.rows;row++)for(let col=0;col<r.columns;col++){
   if(row===0&&col===0)continue;
   nextSketch.circles.push({id:`${r.idPrefix}:r${row}c${col}`,center:'point.'+row+col,radius:2.5});
  }
  return result();
 },resizePlateHoleLayout:(h,r)=>{
  calls.push({kind:'resize',r});nextSketch=structuredClone(sk);return result();
 }};
 const model={featuresOf:d=>{
  if(d.revision===9)return features;
  const cloned=structuredClone(features);cloned[0].payload.sketch=nextSketch;return cloned;
 }};
 const sketch={validateSketch:x=>x,solveSketch:()=>({status:'solved',geometry:{
  points:[{id:'source.center',x:-60,y:-30}],circles:[{id:'source.hole',radius:2.5}]}})};
 return {history,request,services:{runtime,model,sketch},calls,sk,features};
}
test('authoring uses RUNTIME solved 3x2 pattern and exact provenance fences',()=>{
 const f=fixture(),out=authorRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(out.kind,'committed');assert.deepEqual(out.gridHoleIds,[
  'mount.grid:r0c1','mount.grid:r0c2','mount.grid:r1c0','mount.grid:r1c1','mount.grid:r1c2']);
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].r,{
  sketchFeatureId:'sketch.mount',eventId:'event.grid',expectedRevision:9,
  admission:'require_admissible',sourceHoleId:'source.hole',idPrefix:'mount.grid',
  columns:3,rows:2,pitchXmm:40,pitchYmm:30});
 assert.equal(out.status,'pending_exact_provider');assert.equal(out.exactAuthority,false);
 assert.equal(out.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
 assert.equal(f.sk.circles.length,1);
});
test('wrong bodies, sources, identities, stale revisions and invalid pitches never commit',()=>{
 for(const [index,mutate] of [
  f=>f.request.expectedProjectId='other',f=>f.request.expectedRevision=8,
  f=>f.request.units='cm',f=>f.request.frame='world_xy',
  f=>f.request.grid.columns=0,f=>f.request.grid.rows=9,
  f=>f.request.grid.columns=9,f=>{f.request.grid.columns=8;f.request.grid.rows=8;},
  f=>f.request.grid.pitchXmm=0,f=>f.request.grid.pitchXmm=Infinity,
  f=>f.request.grid.sourceHoleId='unknown',
  f=>f.sk.circles.push({id:'mount.grid:r0c1',center:'point',radius:2}),
  f=>f.sk.points.push({id:'mount.grid:r0c1:center',x:0,y:0}),
  f=>f.features[1].writeTargets=['body.unrelated'],
  f=>f.features[2].dependsOn=[],
  f=>f.features[2].payload.targetBodyId='other',
  f=>f.features.push({id:'cut.unknown',writeTargets:['body.mount']}),
  f=>f.services.runtime.inspect=()=>({...report(9),revision:8}),
 ].entries()){
  const f=fixture();mutate(f);
  assert.throws(()=>authorRectangularHoleGrid(f.history,f.request,f.services),undefined,`case ${index}`);
  assert.equal(f.calls.length,0);
 }
});
test('RUNTIME refused inadmissible holes without commit; no false exact claim',()=>{
 const f=fixture();f.services.runtime.patternPlateHoles=()=>({kind:'refused',code:'inadmissible_sketch',
  sourceRevision:9,notCommitted:true});
 const out=authorRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(out.kind,'refused');assert.equal(out.notCommitted,true);
 assert.equal(out.exactAuthority,false);assert.equal(out.history,undefined);
});
test('resize preserves explicit copy identities and pivots about solved source',()=>{
 const f=fixture(),copies=['r0c1','r0c2','r1c0','r1c1','r1c2'];
 for(const suffix of copies)f.sk.circles.push({id:'mount.grid:'+suffix,center:'point.'+suffix,radius:2.5});
 f.request.grid={sourceHoleId:'source.hole',idPrefix:'mount.grid',columns:3,rows:2,
  scaleX:0.75,scaleY:1.2,radiusScale:1.1};
 const out=resizeRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(out.kind,'committed');assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].kind,'resize');
 assert.deepEqual(f.calls[0].r.holeIds,copies.map(x=>'mount.grid:'+x));
 assert.equal(f.calls[0].r.pivotXmm,-60);assert.equal(f.calls[0].r.pivotYmm,-30);
 assert.equal(f.calls[0].r.scaleX,.75);assert.equal(f.calls[0].r.scaleY,1.2);
 assert.equal(f.calls[0].r.radiusScale,1.1);
 assert.equal(out.gridHoleIds.length,5);assert.equal(out.exactAuthority,false);
});
test('resize refuses missing copies, no-op, solver failure and invalid body before write',()=>{
 for(const mutate of [
  f=>f.request.grid.scaleX=0,f=>f.request.grid.scaleX=NaN,
  f=>{f.request.grid.scaleX=1;f.request.grid.scaleY=1;f.request.grid.radiusScale=1;},
  f=>f.sk.circles.pop(),
  f=>f.services.sketch.solveSketch=()=>({status:'underconstrained'}),
  f=>f.features[1].writeTargets=['body.wrong'],
 ]){
  const f=fixture();for(const suffix of ['r0c1','r0c2','r1c0','r1c1','r1c2'])
   f.sk.circles.push({id:'mount.grid:'+suffix,center:'point.'+suffix,radius:2.5});
  f.request.grid={sourceHoleId:'source.hole',idPrefix:'mount.grid',columns:3,rows:2,
    scaleX:.75,scaleY:1.2,radiusScale:1};
  mutate(f);assert.throws(()=>resizeRectangularHoleGrid(f.history,f.request,f.services));
  assert.equal(f.calls.length,0);
 }
});
test('no accidental false acceptance of missing dependent invalidation',()=>{
 const f=fixture();f.services.runtime.patternPlateHoles=()=>({kind:'committed',
  history:{document:{projectId:'grid.project',revision:10}},report:report(10),
  invalidation:{invalidatedFeatureIds:['sketch.mount']}});
 assert.throws(()=>authorRectangularHoleGrid(f.history,f.request,f.services),/invalidation/);
});
test('real 4x3 fixture-plate grid: resize, undo/redo, archive, depth edit, independent body',()=>{
 const script=fileURLToPath(new URL('../examples/fixture-plate-grid.mjs',import.meta.url));
 const run=spawnSync(process.execPath,['--experimental-strip-types',script],{
  encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 assert.equal(run.status,0,run.stderr||String(run.error));
 const o=JSON.parse(run.stdout);
 assert.equal(o.gridHoleCount,12);assert.equal(o.generatedHoleIds.length,11);
 assert.equal(o.oldFirstGridXmm,-20);assert.equal(o.newFirstGridXmm,-30);
 assert.equal(o.fixtureThicknessMm,12);assert.equal(o.independentSpacerThicknessMm,5);
 assert.equal(o.cutStatus,'pending_exact_provider');assert.equal(o.exactAuthority,false);
 for(const id of ['sketch.fixture','extrude.fixture','cut.fixture'])
  assert.ok(o.invalidatedOnResize.includes(id));
 assert.ok(!o.invalidatedOnDepthEdit.includes('extrude.spacer'));
});
