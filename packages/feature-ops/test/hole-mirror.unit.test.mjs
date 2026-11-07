import test from 'node:test';
import assert from 'node:assert/strict';
import {mirrorProfileHoles,HOLE_MIRROR_FORMAT,HOLE_MIRROR_VERSION} from '../src/hole-mirror.mjs';
const protocol={format:HOLE_MIRROR_FORMAT,version:HOLE_MIRROR_VERSION,units:'mm',frame:'local_xy'};
function fixture() {
  const doc={points:[{id:'centre.1',x:4,y:8}],lines:[],
    circles:[{id:'hole.1',center:'centre.1',radius:4}],
    constraints:[{id:'fix.1',kind:'fixed',point:'centre.1',x:4,y:8}]};
  const features=[
    {id:'sketch.1',kind:'sketch',payload:{sketch:doc},dependsOn:[],writeTargets:[]},
    {id:'extrude.1',kind:'extrude',payload:{sourceSketchId:'sketch.1'},dependsOn:['sketch.1'],writeTargets:['body.1']},
    {id:'cut.1',kind:'cut',payload:{sourceSketchId:'sketch.1',targetBodyId:'body.1'},dependsOn:['extrude.1'],writeTargets:['body.1']}
  ];
  const history={document:{revision:7}}, calls=[];
  const report={features:[{featureId:'sketch.1',status:'analytic_profile_only'},
    {featureId:'extrude.1',status:'preview_only'},{featureId:'cut.1',status:'pending_exact_provider'}]};
  const services={model:{featuresOf:()=>features},sketch:{
    validateSketch:v=>v,solveSketch:()=>({status:'solved',geometry:{
      points:[{id:'centre.1',x:30,y:20}],circles:[{id:'hole.1',radius:5}]}})},
    runtime:{inspect:()=>report,editPlateHoles:(h,r)=>{
      calls.push(r);return {kind:'committed',history:{document:{revision:8}},report,
        invalidation:{invalidatedFeatureIds:['sketch.1','extrude.1','cut.1']}};}}};
  const request={...protocol,eventId:'mirror.1',expectedRevision:7,
    sketchFeatureId:'sketch.1',extrudeFeatureId:'extrude.1',
    cutFeatureId:'cut.1',targetBodyId:'body.1',
    axis:{xMm:0,yMm:0,dx:1,dy:0},
    copies:[{sourceHoleId:'hole.1',outputHoleId:'hole.mirror'}]};
  return {doc,features,history,request,services,report,calls};
}
test('reads real solved coordinates, adds one RUNTIME edit, retains original and provenance',()=>{
  const f=fixture(),out=mirrorProfileHoles(f.history,f.request,f.services);
  assert.equal(out.kind,'committed');
  assert.equal(out.history.document.revision,8);
  assert.deepEqual(f.calls[0].operations,[{kind:'add',id:'hole.mirror',x:30,y:-20,radius:5}]);
  assert.equal(f.calls[0].admission,'require_admissible');
  assert.equal(f.calls.length,1);assert.equal(f.doc.circles.length,1);
  assert.deepEqual(out.invalidation.invalidatedFeatureIds,['sketch.1','extrude.1','cut.1']);
  assert.equal(out.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  assert.equal(out.exactAuthority,false);
});
test('reflects vertical and diagonal axes correctly',()=>{
  const f=fixture();f.request.axis={xMm:10,yMm:0,dx:0,dy:1};
  mirrorProfileHoles(f.history,f.request,f.services);
  assert.deepEqual([f.calls[0].operations[0].x,f.calls[0].operations[0].y],[-10,20]);
  const g=fixture();g.request.axis={xMm:0,yMm:0,dx:1,dy:1};
  mirrorProfileHoles(g.history,g.request,g.services);
  assert.ok(Math.abs(g.calls[0].operations[0].x-20)<1e-10);
  assert.ok(Math.abs(g.calls[0].operations[0].y-30)<1e-10);
});
test('revision, identity, units, zero axis and lineage refusal are pre-commit',()=>{
  for (const change of [
    f=>f.request.expectedRevision=6,f=>{f.request.axis.dx=0;f.request.axis.dy=0;},
    f=>f.request.copies[0].outputHoleId='hole.1',
    f=>f.request.copies[0].outputHoleId='centre.1',
    f=>f.request.units='cm',f=>f.request.frame='world_xy',
    f=>f.request.axis.yMm=NaN,
    f=>f.features[2].payload.targetBodyId='other.body',
    f=>f.features[2].dependsOn=[],
    f=>f.features.push({id:'extra.writer',writeTargets:['body.1']}),
    f=>f.report.features[0].status='invalid_profile'
  ]) {
    const f=fixture();change(f);
    assert.throws(()=>mirrorProfileHoles(f.history,f.request,f.services));
    assert.equal(f.calls.length,0);
  }
});
test('preserves a RUNTIME refusal and does not return a committed history',()=>{
  const f=fixture();
  f.services.runtime.editPlateHoles=()=>({kind:'refused',code:'inadmissible_sketch',notCommitted:true});
  const result=mirrorProfileHoles(f.history,f.request,f.services);
  assert.equal(result.kind,'refused');assert.equal(result.notCommitted,true);
  assert.equal(result.history,undefined);assert.equal(result.exactAuthority,false);
});
