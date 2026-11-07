import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {authorCircularBoltPattern,CIRCULAR_BOLT_PATTERN_FORMAT,CIRCULAR_BOLT_PATTERN_VERSION} from '../src/circular-bolt-pattern.mjs';
function fixture(){
 const doc={circles:[{id:'source.hole',center:'point.1',radius:3}],points:[{id:'point.1',x:0,y:20}],lines:[],constraints:[]};
 const features=[
 {id:'sketch.1',kind:'sketch',payload:{sketch:doc},writeTargets:[],dependsOn:[]},
 {id:'extrude.1',kind:'extrude',payload:{sourceSketchId:'sketch.1'},dependsOn:['sketch.1'],writeTargets:['body.1']},
 {id:'cut.1',kind:'cut',payload:{targetBodyId:'body.1',sourceSketchId:'sketch.1'},dependsOn:['extrude.1'],writeTargets:['body.1']}
 ];
 const history={document:{projectId:'proj.1',revision:5}},calls=[];
 const report=revision=>({projectId:'proj.1',revision,features:[
 {featureId:'sketch.1',status:'analytic_profile_only'},
 {featureId:'extrude.1',status:'preview_only'},
 {featureId:'cut.1',status:'pending_exact_provider'}]});
 const services={model:{featuresOf:d=>{
  if(d.revision===5)return features;
  const copy=structuredClone(features);
  for(let i=1;i<4;i++)copy[0].payload.sketch.circles.push({id:'array:p'+i,center:'p'+i,radius:3});
  return copy;
 }},runtime:{inspect:()=>report(5),patternCircularHoles:(h,r)=>{
  calls.push(r);
  return {kind:'committed',history:{document:{projectId:'proj.1',revision:6}},
   report:report(6),invalidation:{invalidatedFeatureIds:['sketch.1','extrude.1','cut.1']}};
 }}};
 const request={format:CIRCULAR_BOLT_PATTERN_FORMAT,version:CIRCULAR_BOLT_PATTERN_VERSION,
 eventId:'pattern.1',expectedProjectId:'proj.1',expectedRevision:5,units:'mm',frame:'local_xy',
 sketchFeatureId:'sketch.1',extrudeFeatureId:'extrude.1',cutFeatureId:'cut.1',targetBodyId:'body.1',
 pattern:{sourceHoleId:'source.hole',idPrefix:'array',instances:4,pivotXmm:0,pivotYmm:0,sweepDegrees:-270}};
 return {history,request,services,features,calls};
}
test('delegates one solved-source pattern to RUNTIME, retaining stable IDs and no exact claim',()=>{
 const f=fixture(),out=authorCircularBoltPattern(f.history,f.request,f.services);
 assert.equal(out.kind,'committed');assert.equal(f.calls.length,1);
 assert.deepEqual(out.generatedHoleIds,['array:p1','array:p2','array:p3']);
 assert.equal(f.calls[0].admission,'require_admissible');
 assert.equal(f.calls[0].sweepDegrees,-270);
 assert.equal(out.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
 assert.equal(out.exactAuthority,false);assert.equal(f.features[0].payload.sketch.circles.length,1);
});
test('stale, colliding, wrong-body and invalid patterns do not reach the runtime writer',()=>{
 for(const mutate of [
  f=>f.request.expectedProjectId='other',f=>f.request.expectedRevision=4,
  f=>f.request.units='cm',f=>f.request.frame='world_xy',
  f=>f.request.pattern.instances=1,f=>f.request.pattern.instances=33,
  f=>f.request.pattern.pivotXmm=NaN,f=>f.request.pattern.sweepDegrees=0,
  f=>f.request.pattern.sweepDegrees=361,f=>f.request.pattern.idPrefix='source.hole',
  f=>f.features[2].payload.targetBodyId='body.other',
  f=>f.features[2].dependsOn=[],
  f=>f.features.push({id:'cut.extra',writeTargets:['body.1']}),
  f=>f.services.runtime.inspect=()=>({projectId:'proj.1',revision:5,features:[]})
 ]){
  const f=fixture();mutate(f);
  assert.throws(()=>authorCircularBoltPattern(f.history,f.request,f.services));
  assert.equal(f.calls.length,0);
 }
});
test('inadmissible circle placement remains a recoverable noncommit',()=>{
 const f=fixture();
 f.services.runtime.patternCircularHoles=()=>({kind:'refused',code:'inadmissible_sketch',
  sourceRevision:5,notCommitted:true});
 const out=authorCircularBoltPattern(f.history,f.request,f.services);
 assert.equal(out.kind,'refused');assert.equal(out.history,undefined);
 assert.equal(out.exactAuthority,false);
});
test('real L-bracket + independent spacer: six-hole ring, thickness edit, undo/redo, archive',()=>{
 const script=fileURLToPath(new URL('../examples/bolt-circle-l-bracket.mjs',import.meta.url));
 const run=spawnSync(process.execPath,['--experimental-strip-types',script],{
  encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
 assert.equal(run.status,0,run.stderr||String(run.error));
 const result=JSON.parse(run.stdout);
 assert.equal(result.boltHoleCount,6);
 assert.equal(result.generatedHoleIds.length,5);
 assert.equal(result.bracketDepthMm,12);
 assert.equal(result.independentSpacerDepthMm,5);
 assert.equal(result.cutStatus,'pending_exact_provider');
 assert.equal(result.exactAuthority,false);
 for(const id of ['sketch.bracket','extrude.bracket','cut.bracket'])
  assert.ok(result.invalidatedOnPattern.includes(id));
 assert.ok(!result.invalidatedOnEdit.includes('extrude.spacer'));
});
