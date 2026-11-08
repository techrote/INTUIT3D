import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {orientCircularBoltPattern,BOLT_ORIENTATION_FORMAT,BOLT_ORIENTATION_VERSION}
 from '../src/circular-bolt-transform.mjs';
function fixture(){
 const holeIds=['hole.0','ring:p1','ring:p2','ring:p3'];
 const coords=[[0,20],[-20,0],[0,-20],[20,0]];
 const doc={version:1,units:'mm',
  points:coords.map(([x,y],i)=>({id:'centre.'+i,x,y})),
  lines:[],circles:holeIds.map((id,i)=>({id,center:'centre.'+i,radius:3})),
  constraints:holeIds.flatMap((id,i)=>[
   {id:'fixed.'+i,kind:'fixed',point:'centre.'+i,x:coords[i][0],y:coords[i][1]},
   {id:'radius.'+i,kind:'radius',circle:id,value:3}])};
 const sourceFeatures=[
  {id:'sketch.a',kind:'sketch',payload:{sketch:doc},writeTargets:[],dependsOn:[]},
  {id:'extrude.a',kind:'extrude',payload:{sourceSketchId:'sketch.a'},
   dependsOn:['sketch.a'],writeTargets:['body.a']},
  {id:'cut.a',kind:'cut',payload:{targetBodyId:'body.a',sourceSketchId:'sketch.a'},
   dependsOn:['extrude.a'],writeTargets:['body.a']}];
 const history={document:{projectId:'orientation.demo',revision:7}},calls=[];
 let outputSketch=structuredClone(doc);
 const report=rev=>({projectId:'orientation.demo',revision:rev,features:[
  {featureId:'sketch.a',status:'analytic_profile_only'},
  {featureId:'extrude.a',status:'preview_only'},
  {featureId:'cut.a',status:'pending_exact_provider'}]});
 const model={featuresOf:d=>{
  const f=structuredClone(sourceFeatures);
  f[0].payload.sketch=d.revision===7?doc:outputSketch;
  return f;
 }};
 const sketch={validateSketch:x=>x,solveSketch:x=>({status:'solved',geometry:{
  points:x.points,circles:x.circles}})};
 const runtime={inspect:()=>report(7),transformPlateHoles:(h,r)=>{
  calls.push(r);
  outputSketch=structuredClone(doc);
  const angle=r.rotateDegrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  for(const hole of outputSketch.circles){
   const point=outputSketch.points.find(p=>p.id===hole.center);
   const x=point.x-r.pivotXmm,y=point.y-r.pivotYmm;
   point.x=r.pivotXmm+c*x-s*y+r.translateXmm;
   point.y=r.pivotYmm+s*x+c*y+r.translateYmm;
  }
  return {kind:'committed',history:{document:{projectId:'orientation.demo',revision:8}},
   report:report(8),invalidation:{invalidatedFeatureIds:['sketch.a','extrude.a','cut.a']}};
 }};
 const request={format:BOLT_ORIENTATION_FORMAT,version:BOLT_ORIENTATION_VERSION,
  eventId:'rotate.ring',expectedProjectId:'orientation.demo',expectedRevision:7,
  units:'mm',frame:'local_xy',sketchFeatureId:'sketch.a',
  extrudeFeatureId:'extrude.a',cutFeatureId:'cut.a',targetBodyId:'body.a',
  orientation:{sourceHoleId:'hole.0',idPrefix:'ring',instances:4,
   pivotXmm:0,pivotYmm:0,sweepDegrees:360,rotateDegrees:30,
   translateXmm:4,translateYmm:-3}};
 return {history,request,services:{model,sketch,runtime},doc,sourceFeatures,calls};
}
test('rotates and translates all four solved holes as one fenced RUNTIME event',()=>{
 const f=fixture(),result=orientCircularBoltPattern(f.history,f.request,f.services);
 assert.equal(result.kind,'committed');
 assert.deepEqual(result.holeIds,['hole.0','ring:p1','ring:p2','ring:p3']);
 assert.deepEqual(result.movedPivot,{xMm:4,yMm:-3});
 assert.equal(result.pitchCircleRadiusMm,20);
 assert.equal(result.boreRadiusMm,3);
 assert.equal(result.status,'pending_exact_provider');
 assert.equal(result.exactAuthority,false);
 assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0],{
  sketchFeatureId:'sketch.a',eventId:'rotate.ring',expectedRevision:7,
  admission:'require_admissible',holeIds:result.holeIds,
  rotateDegrees:30,translateXmm:4,translateYmm:-3,
  pivotXmm:0,pivotYmm:0
 });
 assert.equal(f.doc.points[0].y,20);
 assert.ok(result.invalidation.invalidatedFeatureIds.includes('cut.a'));
});
test('invalid/stale/noncommuting/drifted selections never write',()=>{
 const changes=[
  f=>f.request.expectedRevision=6,
  f=>f.request.expectedProjectId='other',
  f=>f.request.frame='world_xy',
  f=>f.request.orientation.instances=5,
  f=>f.request.orientation.rotateDegrees=360,
  f=>f.request.orientation.sweepDegrees=-360,
  f=>f.request.orientation.pivotXmm=10,
  f=>f.request.orientation.translateXmm=NaN,
  f=>{f.request.orientation.rotateDegrees=0;f.request.orientation.translateXmm=0;
    f.request.orientation.translateYmm=0;},
  f=>f.doc.circles.pop(),
  f=>f.doc.points[1].x+=0.02,
  f=>f.doc.circles[1].radius=4,
  f=>f.sourceFeatures[1].writeTargets=['body.different'],
  f=>f.sourceFeatures[2].payload.targetBodyId='body.different',
  f=>f.sourceFeatures[2].dependsOn=[],
  f=>f.sourceFeatures.push({id:'cut.another',writeTargets:['body.a']}),
  f=>f.services.sketch.solveSketch=()=>({status:'underconstrained'}),
  f=>f.services.runtime.inspect=()=>({projectId:'orientation.demo',revision:7,features:[]})
 ];
 for(let i=0;i<changes.length;i++){
  const f=fixture();changes[i](f);
  assert.throws(()=>orientCircularBoltPattern(f.history,f.request,f.services),
   undefined,'negative '+i);
  assert.equal(f.calls.length,0,'unexpected write '+i);
 }
});
test('inadmissible rotated hole remains unchanged, not an exact shape',()=>{
 const f=fixture();
 f.services.runtime.transformPlateHoles=()=>({kind:'refused',notCommitted:true,
  code:'inadmissible_sketch',sourceRevision:7});
 const result=orientCircularBoltPattern(f.history,f.request,f.services);
 assert.equal(result.kind,'refused');
 assert.equal(result.history,undefined);
 assert.equal(result.exactAuthority,false);
 assert.deepEqual(result.holeIds,['hole.0','ring:p1','ring:p2','ring:p3']);
});
test('wrong RUNTIME output coordinate fails closed, never accepted',()=>{
 const f=fixture();
 const report={projectId:'orientation.demo',revision:8,features:[
  {featureId:'sketch.a',status:'analytic_profile_only'},
  {featureId:'cut.a',status:'pending_exact_provider'}]};
 f.services.runtime.transformPlateHoles=()=>({kind:'committed',
  history:{document:{projectId:'orientation.demo',revision:8}},report,
  invalidation:{invalidatedFeatureIds:['sketch.a','extrude.a','cut.a']}});
 assert.throws(()=>orientCircularBoltPattern(f.history,f.request,f.services),
   /differs from solved rigid transform/);
});
test('real six-hole L-bracket orientation, independent spacer and archive replay',()=>{
 const script=fileURLToPath(new URL('../examples/bolt-circle-orientation.mjs',import.meta.url));
 const run=spawnSync(process.execPath,['--experimental-strip-types',script],{
  encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 assert.equal(run.status,0,run.stderr||String(run.error));
 const data=JSON.parse(run.stdout);
 assert.equal(data.boltHoleCount,6);
 assert.equal(data.orientedHoleIds.length,6);
 assert.deepEqual(data.movedPivot,{xMm:-48,yMm:9});
 assert.deepEqual(data.chainedMovedPivot,{xMm:-49,yMm:11});
 assert.equal(data.stalePivotRejected,true);
 assert.equal(data.pitchCircleRadiusMm,18);
 assert.equal(data.boreRadiusMm,3);
 assert.equal(data.bracketDepthMm,12);
 assert.equal(data.independentSpacerDepthMm,5);
 assert.equal(data.cutStatus,'pending_exact_provider');
 assert.equal(data.exactAuthority,false);
 for(const id of ['sketch.bracket','extrude.bracket','cut.bracket'])
  assert.ok(data.invalidatedOnOrientation.includes(id));
 assert.ok(!data.invalidatedOnOrientation.includes('extrude.spacer'));
 for(const id of ['sketch.bracket','extrude.bracket','cut.bracket'])
  assert.ok(data.invalidatedOnSecondOrientation.includes(id));
 assert.ok(!data.invalidatedOnSecondOrientation.includes('extrude.spacer'));
});
