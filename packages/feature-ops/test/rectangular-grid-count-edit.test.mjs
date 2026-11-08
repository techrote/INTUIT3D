
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reshapeRectangularHoleGrid,
 RECTANGULAR_HOLE_GRID_FORMAT,RECTANGULAR_HOLE_GRID_VERSION}
 from '../src/rectangular-hole-grid.mjs';

function fixture(){
 const points=[],circles=[];
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
  const id=row===0&&col===0?'source.hole':'grid:r'+row+'c'+col;
  const point='center.'+row+col;
  points.push({id:point,x:-60+40*col,y:-30+30*row});
  circles.push({id,center:point,radius:2.5});
 }
 const doc={version:1,units:'mm',points,circles,lines:[],constraints:[]};
 const features=[
  {id:'sketch.fixture',kind:'sketch',payload:{sketch:doc},
    dependsOn:[],writeTargets:[]},
  {id:'extrude.fixture',kind:'extrude',payload:{sourceSketchId:'sketch.fixture'},
    dependsOn:['sketch.fixture'],writeTargets:['body.fixture']},
  {id:'cut.fixture',kind:'cut',payload:{targetBodyId:'body.fixture',
    sourceSketchId:'sketch.fixture'},dependsOn:['extrude.fixture'],
    writeTargets:['body.fixture']}
 ];
 const history={document:{projectId:'fixture.project',revision:10}};
 const request={format:RECTANGULAR_HOLE_GRID_FORMAT,version:RECTANGULAR_HOLE_GRID_VERSION,
  eventId:'grid.expand',expectedProjectId:'fixture.project',
  expectedRevision:10,units:'mm',frame:'local_xy',
  sketchFeatureId:'sketch.fixture',extrudeFeatureId:'extrude.fixture',
  cutFeatureId:'cut.fixture',targetBodyId:'body.fixture',
  grid:{sourceHoleId:'source.hole',idPrefix:'grid',columns:3,rows:2,
   pitchXmm:40,pitchYmm:30,nextColumns:4,nextRows:3}};
 const report=rev=>({projectId:'fixture.project',revision:rev,features:[
  {featureId:'sketch.fixture',status:'analytic_profile_only'},
  {featureId:'extrude.fixture',status:'preview_only'},
  {featureId:'cut.fixture',status:'pending_exact_provider'}]});
 const calls=[];
 let changed;
 const services={
  model:{featuresOf:document=>{
   if(document.revision===10)return features;
   const next=structuredClone(features);
   next[0].payload.sketch=changed;return next;
  }},
  sketch:{validateSketch:input=>input,solveSketch:input=>({
   status:'solved',geometry:{points:input.points,circles:input.circles}})},
  runtime:{inspect:()=>report(10),editPlateHoles:(_history,input)=>{
   calls.push(input);
   changed=structuredClone(doc);
   for(const op of input.operations){
    if(op.kind==='remove'){
     const circle=changed.circles.find(c=>c.id===op.id);
     changed.circles=changed.circles.filter(c=>c.id!==op.id);
     changed.points=changed.points.filter(p=>p.id!==circle.center);
    }else{
     changed.points.push({id:op.id+':center',x:op.x,y:op.y});
     changed.circles.push({id:op.id,center:op.id+':center',radius:op.radius});
    }
   }
   return {kind:'committed',history:{document:{projectId:'fixture.project',revision:11}},
    report:report(11),invalidation:{invalidatedFeatureIds:[
    'sketch.fixture','extrude.fixture','cut.fixture']}};
  }}
 };
 return {history,request,doc,features,services,calls};
}

test('grow 3x2 to 4x3 preserves all existing cell IDs; one authoritative edit',()=>{
 const f=fixture();
 const result=reshapeRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(result.kind,'committed');
 assert.deepEqual(result.changes.added,['grid:r0c3','grid:r1c3',
   'grid:r2c0','grid:r2c1','grid:r2c2','grid:r2c3']);
 assert.equal(result.changes.removed.length,0);
 assert.equal(result.changes.retained.length,5);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].admission,'require_admissible');
 assert.equal(f.calls[0].operations.length,6);
 assert.deepEqual(f.calls[0].operations[0],
  {kind:'add',id:'grid:r0c3',x:60,y:-30,radius:2.5});
 assert.equal(f.calls[0].operations.at(-1).y,30);
 assert.equal(result.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
 assert.equal(result.exactAuthority,false);
 assert.equal(f.doc.circles.length,6);
});

test('shrink 3x2 to 2x2 removes only excluded cells in one batch',()=>{
 const f=fixture();f.request.grid.nextColumns=2;f.request.grid.nextRows=2;
 const out=reshapeRectangularHoleGrid(f.history,f.request,f.services);
 assert.deepEqual(out.changes.added,[]);
 assert.deepEqual(out.changes.removed,['grid:r0c2','grid:r1c2']);
 assert.deepEqual(out.changes.retained,['grid:r0c1','grid:r1c0','grid:r1c1']);
 assert.deepEqual(f.calls[0].operations,[
  {kind:'remove',id:'grid:r0c2'}, {kind:'remove',id:'grid:r1c2'}]);
});

test('stale project, wrong body, drift, missing copy, occupied ID and invalid counts fail before commit',()=>{
 const mutations=[
  f=>{f.request.expectedRevision=9;},
  f=>{f.request.expectedProjectId='different';},
  f=>{f.features[2].payload.targetBodyId='wrong';},
  f=>{f.features[1].writeTargets=['wrong'];},
  f=>{f.doc.points.find(p=>p.id==='center.01').x+=.01;},
  f=>{f.doc.circles.find(c=>c.id==='grid:r1c2').radius=3.25;},
  f=>{f.doc.circles.pop();},
  f=>{f.doc.points.push({id:'grid:r0c3:center',x:0,y:0});},
  f=>{f.request.grid.nextColumns=3;f.request.grid.nextRows=2;},
  f=>{f.request.grid.nextColumns=9;},
  f=>{f.request.grid.nextRows=0;},
  f=>{f.request.grid.pitchXmm=0;},
  f=>{f.request.grid.pitchYmm=Infinity;},
  f=>{f.services.sketch.solveSketch=()=>({status:'underconstrained'});},
 ];
 for(const [index,mutate] of mutations.entries()){
  const f=fixture();mutate(f);
  assert.throws(()=>reshapeRectangularHoleGrid(f.history,f.request,f.services),
   undefined,'negative case '+index);
  assert.equal(f.calls.length,0,'runtime must not commit case '+index);
 }
});

test('unadmitted new geometry is a recoverable refusal with unchanged source',()=>{
 const f=fixture();
 f.services.runtime.editPlateHoles=()=>({kind:'refused',
  code:'inadmissible_sketch',notCommitted:true,sourceRevision:10});
 const out=reshapeRectangularHoleGrid(f.history,f.request,f.services);
 assert.equal(out.kind,'refused');assert.equal(out.notCommitted,true);
 assert.equal(out.history,undefined);assert.equal(out.exactAuthority,false);
 assert.equal(f.doc.circles.length,6);
});

test('real fixture grid: 4x3 to 5x3 to 3x2, undo redo archive and 8 to 12 mm depth',()=>{
 const script=fileURLToPath(new URL('../examples/fixture-grid-count-edit.mjs',import.meta.url));
 const run=spawnSync(process.execPath,['--experimental-strip-types',script],
  {encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 assert.equal(run.status,0,run.stderr||String(run.error));
 const result=JSON.parse(run.stdout);
 assert.equal(result.gridHoleCount,6);
 assert.equal(result.grownAdded.length,3);
 assert.equal(result.shrunkRemoved.length,9);
 assert.equal(result.retainedAfterShrink.length,5);
 assert.equal(result.undoRestoredFifteen,true);
 assert.equal(result.outOfBoundsRefused,true);
 assert.equal(result.fixtureThicknessMm,12);
 assert.equal(result.independentSpacerThicknessMm,5);
 assert.equal(result.cutStatus,'pending_exact_provider');
 assert.equal(result.exactAuthority,false);
 assert.ok(!result.invalidatedOnDepthEdit.includes('extrude.spacer'));
 for(const id of ['sketch.fixture','extrude.fixture','cut.fixture']){
  assert.ok(result.invalidatedOnGrow.includes(id));
  assert.ok(result.invalidatedOnShrink.includes(id));
 }
});
