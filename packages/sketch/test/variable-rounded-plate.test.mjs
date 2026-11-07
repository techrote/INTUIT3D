import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {plateSketchFixture,editConstraint,serializeSketch,parseSketch} from '../index.mjs';
import {
  createVariableRoundedPlateIntent,editVariableRoundedPlateRadius,
  solveVariableRoundedPlate,serializeVariableRoundedPlateIntent,
  parseVariableRoundedPlateIntent,inspectVariableRoundedPlateHandles,
  dragVariableRoundedPlateCorner,solveRoundedPlate
} from '@intuit3d/sketch/rounded-plate/v2';
const raw=()=>({version:2,id:'fillet:plate',edgeIds:['bottom','right','top','left'],
  holeIds:['holeA','holeB'],cornerRadii:[
    {vertexId:'p0',radiusMm:4},{vertexId:'p1',radiusMm:8},
    {vertexId:'p2',radiusMm:12},{vertexId:'p3',radiusMm:6}
  ]});
const intent=()=>createVariableRoundedPlateIntent(raw());
const run=(s=plateSketchFixture(),i=intent())=>solveVariableRoundedPlate(s,i);
const close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} differs from ${b}`);

test('separately dimensioned four corners solve as tangent circular arcs with two holes',()=>{
  const s=plateSketchFixture(),v=run(s);
  assert.equal(v.status,'solved',JSON.stringify(v.diagnostics));
  assert.equal(v.generalNonlinearSolver,false);
  assert.equal(v.geometry.previewOnly,true);
  assert.equal(v.geometry.status,'analytic_curved_profile_only');
  assert.equal(v.baseDegreesOfFreedom,0);
  assert.deepEqual(v.geometry.boundary.map(b=>b.kind),
    ['line','arc','line','arc','line','arc','line','arc']);
  assert.deepEqual(v.geometry.boundary.filter(e=>e.kind==='arc').map(a=>a.sourceVertexId),
    ['p1','p2','p3','p0']);
  assert.deepEqual(v.geometry.boundary.filter(e=>e.kind==='arc').map(a=>a.radiusMm),
    [8,12,6,4]);
  assert.deepEqual(v.geometry.holes.map(h=>h.id),['holeA','holeB']);
  assert.deepEqual(v.geometry.boundary[1].center,{x:112,y:8});
  assert.deepEqual(v.geometry.boundary[3].center,{x:108,y:68});
  assert.deepEqual(v.geometry.boundary[5].center,{x:6,y:74});
  assert.deepEqual(v.geometry.boundary[7].center,{x:4,y:4});
  close(v.geometry.areaMm2,9600-72*Math.PI-(1-Math.PI/4)*(4**2+8**2+12**2+6**2));
  const dot=(a,b)=>a.x*b.x+a.y*b.y,sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  for(let j=0;j<4;j++){
    const line=v.geometry.boundary[2*j],arc=v.geometry.boundary[2*j+1];
    const next=v.geometry.boundary[(2*j+2)%8];
    close(dot(sub(line.end,line.start),sub(arc.start,arc.center)),0);
    close(dot(sub(next.end,next.start),sub(arc.end,arc.center)),0);
    close(Math.hypot(arc.start.x-arc.center.x,arc.start.y-arc.center.y),arc.radiusMm);
    close(Math.hypot(arc.end.x-arc.center.x,arc.end.y-arc.center.y),arc.radiusMm);
  }
});

test('radius edit changes only selected corner with stable IDs across width edit and replay',()=>{
  const initial=run();
  const updated=editVariableRoundedPlateRadius(intent(),'p1',14);
  const changed=run(plateSketchFixture(),updated);
  assert.equal(changed.status,'solved',JSON.stringify(changed.diagnostics));
  assert.deepEqual(changed.geometry.boundary.map(e=>e.id),initial.geometry.boundary.map(e=>e.id));
  assert.deepEqual(changed.geometry.holes.map(h=>h.id),initial.geometry.holes.map(h=>h.id));
  assert.deepEqual(changed.geometry.boundary.filter(e=>e.kind==='arc').map(e=>e.radiusMm),
    [14,12,6,4]);
  assert.deepEqual(changed.geometry.boundary[3].center,initial.geometry.boundary[3].center);
  assert.deepEqual(changed.geometry.boundary[1].center,{x:106,y:14});
  const widened=run(editConstraint(plateSketchFixture(),'width',{value:150}),updated);
  assert.equal(widened.status,'solved');
  assert.deepEqual(widened.geometry.boundary[1].center,{x:136,y:14});
  assert.deepEqual(widened.geometry.boundary.map(e=>e.id),initial.geometry.boundary.map(e=>e.id));
  const archived=JSON.stringify({sketch:serializeSketch(plateSketchFixture()),
    intent:serializeVariableRoundedPlateIntent(updated)});
  const loaded=JSON.parse(archived);
  assert.deepEqual(run(parseSketch(loaded.sketch),parseVariableRoundedPlateIntent(loaded.intent)),
    changed);
  assert.equal(intent().cornerRadii.find(e=>e.vertexId==='p1').radiusMm,8);
});

test('dragging one corner makes one durable edit with a revision fence',()=>{
  const s=plateSketchFixture(),i=intent();
  const found=inspectVariableRoundedPlateHandles(s,i);
  assert.equal(found.status,'solved');
  assert.equal(found.handles.length,4);
  const h=found.handles.find(e=>e.sourceVertexId==='p1');
  assert.deepEqual(h.position,{x:112,y:0});
  const request={version:2,handleId:h.id,target:{x:104,y:0},
    expectedSketchSignature:found.sketchSignature,
    expectedIntentSignature:found.intentSignature};
  const changed=dragVariableRoundedPlateCorner(s,i,request);
  assert.equal(changed.status,'solved',JSON.stringify(changed.diagnostics));
  assert.equal(changed.previewOnly,true);
  assert.equal(changed.intent.cornerRadii.find(e=>e.vertexId==='p1').radiusMm,16);
  assert.deepEqual(changed.geometry.boundary.filter(e=>e.kind==='arc').map(e=>e.radiusMm),
    [16,12,6,4]);
  assert.deepEqual(changed.sketch,s);
  assert.equal(changed.projection.deviationMm,0);
  assert.throws(()=>dragVariableRoundedPlateCorner(s,changed.intent,request),/stale edit/);
  const rejected=dragVariableRoundedPlateCorner(s,i,{...request,target:{x:120,y:0}});
  assert.equal(rejected.status,'rejected');
  assert.equal(rejected.sketch,null);
  assert.equal(rejected.intent,null);
});

test('adjacent arcs consuming one edge fail closed, remain authored and recover',()=>{
  const bad=editVariableRoundedPlateRadius(intent(),'p1',70);
  const rejected=run(plateSketchFixture(),bad);
  assert.equal(rejected.status,'conflicted');
  assert.equal(rejected.geometry,null);
  assert.match(rejected.diagnostics[0].message,/unambiguous straight profile edges/);
  const recovered=run(plateSketchFixture(),editVariableRoundedPlateRadius(bad,'p1',8));
  assert.equal(recovered.status,'solved');
  assert.deepEqual(recovered.geometry,run().geometry);
});

test('missing target, hole intrusions, underconstraint and overconstraint retain truthful status',()=>{
  const source=raw();
  source.cornerRadii[0].vertexId='missing';
  assert.equal(run(plateSketchFixture(),source).status,'conflicted');
  assert.equal(run(plateSketchFixture(),source).geometry,null);
  let intruding=editConstraint(plateSketchFixture(),'holeA:fixed',{x:9});
  intruding=editConstraint(intruding,'holeA:fixed',{y:9});
  const roundedIntrusion=editVariableRoundedPlateRadius(intent(),'p0',18);
  assert.equal(run(intruding,roundedIntrusion).status,'conflicted');
  assert.equal(run(intruding,roundedIntrusion).geometry,null);
  const free=plateSketchFixture();
  free.constraints=free.constraints.filter(c=>c.id!=='width');
  assert.equal(run(free).status,'underconstrained');
  assert.equal(inspectVariableRoundedPlateHandles(free,intent()).handles.length,0);
  const conflicting=plateSketchFixture();
  conflicting.constraints.push({id:'extraWidth',kind:'distanceX',a:'p0',b:'p1',value:180});
  assert.equal(run(conflicting).status,'conflicted');
  assert.equal(run(conflicting).geometry,null);
});

test('strict schema and v1 compatibility survive v2 addition',()=>{
  assert.throws(()=>createVariableRoundedPlateIntent({...raw(),radiusMm:3}),/invalid versioned/);
  assert.throws(()=>createVariableRoundedPlateIntent({...raw(),cornerRadii:[
    {vertexId:'p0',radiusMm:8},{vertexId:'p0',radiusMm:8},
    {vertexId:'p2',radiusMm:8},{vertexId:'p3',radiusMm:8}
  ]}),/duplicate/);
  assert.throws(()=>editVariableRoundedPlateRadius(intent(),'absent',3),/unknown corner/);
  const v1=solveRoundedPlate(plateSketchFixture(),{
    version:1,id:'fillet:plate',edgeIds:['bottom','right','top','left'],
    holeIds:['holeA','holeB'],radiusMm:8});
  const v2=run(plateSketchFixture(),createVariableRoundedPlateIntent({
    ...raw(),cornerRadii:raw().cornerRadii.map(e=>({...e,radiusMm:8}))}));
  assert.equal(v1.status,'solved');
  assert.equal(v2.status,'solved');
  close(v1.geometry.areaMm2,v2.geometry.areaMm2);
  assert.deepEqual(v1.geometry.boundary,v2.geometry.boundary);
  assert.deepEqual(v1.geometry.holes,v2.geometry.holes);
});

test('the public package-importing user example actually runs through archive replay',()=>{
  const path=fileURLToPath(new URL('../examples/variable-corner-fillets.mjs',import.meta.url));
  const r=spawnSync(process.execPath,[path],{encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,r.stderr);
  const steps=r.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.deepEqual(steps.map(x=>x.step),
    ['initial','drag-p1-only','width-and-p2','reopened']);
  assert.equal(steps[0].cornerRadiiMm.p1,8);
  assert.equal(steps[1].cornerRadiiMm.p1,15);
  assert.equal(steps[1].cornerRadiiMm.p2,12);
  assert.equal(steps[2].cornerRadiiMm.p2,10);
  assert.deepEqual({...steps[2],step:'reopened'},steps[3]);
  for(const step of steps){
    assert.equal(step.status,'solved');
    assert.equal(step.previewOnly,true);
    assert.equal(step.arcIds.length,4);
    assert.deepEqual(step.holeIds,['holeA','holeB']);
  }
});
