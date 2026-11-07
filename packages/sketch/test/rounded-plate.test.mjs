import test from 'node:test';
import assert from 'node:assert/strict';
import {plateSketchFixture,editConstraint,parseSketch,serializeSketch} from '../index.mjs';
import {createRoundedPlateIntent,editRoundedPlateRadius,serializeRoundedPlateIntent,
  parseRoundedPlateIntent,solveRoundedPlate} from '../rounded-plate.mjs';

const make=()=>createRoundedPlateIntent({version:1,id:'fillet:plate',
  edgeIds:['bottom','right','top','left'],holeIds:['holeA','holeB'],radiusMm:8});
const run=(sketch=plateSketchFixture(),intent=make())=>solveRoundedPlate(sketch,intent);
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,String(a)+' differs from '+String(b));

test('dimensioned two-hole plate has four analytic quarter arcs and four tangent trimmed lines',()=>{
  const doc=plateSketchFixture(),out=run(doc);
  assert.equal(out.status,'solved');
  assert.equal(out.baseDegreesOfFreedom,0);
  assert.equal(out.generalNonlinearSolver,false);
  assert.equal(out.geometry.status,'analytic_curved_profile_only');
  assert.equal(out.geometry.previewOnly,true);
  assert.deepEqual(out.geometry.boundary.map(x=>x.kind),
    ['line','arc','line','arc','line','arc','line','arc']);
  assert.deepEqual(out.geometry.holes.map(x=>x.id),['holeA','holeB']);
  close(out.geometry.areaMm2,9600-72*Math.PI-(4-Math.PI)*64);
  const arc=out.geometry.boundary[1];
  assert.equal(arc.id,'fillet:plate:arc:p1');
  assert.deepEqual(arc.center,{x:112,y:8});
  assert.deepEqual(arc.start,{x:112,y:0});
  assert.deepEqual(arc.end,{x:120,y:8});
  close(arc.sweepRad,Math.PI/2);
  const line0=out.geometry.boundary[0],line1=out.geometry.boundary[2];
  const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const dot=(a,b)=>a.x*b.x+a.y*b.y;
  close(dot(sub(line0.end,line0.start),sub(arc.start,arc.center)),0);
  close(dot(sub(line1.end,line1.start),sub(arc.end,arc.center)),0);
  assert.equal(out.sourceSignature,serializeSketch(doc));
});

test('width and radius edits change actual analytic profile but preserve IDs',()=>{
  const before=run();
  const doc=editConstraint(plateSketchFixture(),'width',{value:140});
  const width=run(doc),radius=run(doc,editRoundedPlateRadius(make(),12));
  assert.equal(width.status,'solved');
  assert.equal(radius.status,'solved');
  assert.deepEqual(radius.geometry.boundary.map(e=>e.id),before.geometry.boundary.map(e=>e.id));
  assert.deepEqual(radius.geometry.holes.map(e=>e.id),before.geometry.holes.map(e=>e.id));
  assert.deepEqual(width.geometry.boundary[1].center,{x:132,y:8});
  assert.deepEqual(radius.geometry.boundary[1].center,{x:128,y:12});
  close(width.geometry.areaMm2,140*80-72*Math.PI-(4-Math.PI)*64);
  close(radius.geometry.areaMm2,140*80-72*Math.PI-(4-Math.PI)*144);
  assert.equal(make().radiusMm,8);
});

test('save/reopen both sketch and fillet, then replay exact semantic/curve data',()=>{
  const sketch=editConstraint(plateSketchFixture(),'height',{value:90});
  const intent=editRoundedPlateRadius(make(),10);
  const json=JSON.stringify({sketch:serializeSketch(sketch),fillet:serializeRoundedPlateIntent(intent)});
  const restored=JSON.parse(json);
  const original=run(sketch,intent);
  const replay=run(parseSketch(restored.sketch),parseRoundedPlateIntent(restored.fillet));
  assert.equal(original.status,'solved');
  assert.deepEqual(original,replay);
});

test('radius consumes full plate height: visible conflict, no fabricated geometry',()=>{
  const intent=editRoundedPlateRadius(make(),40);
  const out=run(plateSketchFixture(),intent);
  assert.equal(out.status,'conflicted');
  assert.equal(out.geometry,null);
  assert.match(out.diagnostics[0].message,/no unambiguous straight/);
  assert.equal(intent.radiusMm,40);
  const small=editConstraint(plateSketchFixture(),'width',{value:14});
  assert.equal(run(small).status,'conflicted');
});

test('hole inside base rectangle may still collide with the rounded corner',()=>{
  let sketch=editConstraint(plateSketchFixture(),'holeA:fixed',{x:6.5});
  sketch=editConstraint(sketch,'holeA:fixed',{y:6.5});
  const out=run(sketch);
  assert.equal(out.status,'conflicted');
  assert.equal(out.geometry,null);
  assert.match(out.diagnostics[0].message,/rounded boundary/);
});

test('unresolved and contradictory authored constraints do not emit filleted geometry',()=>{
  const under=plateSketchFixture();
  under.constraints=under.constraints.filter(c=>c.id!=='width');
  const a=run(under);
  assert.equal(a.status,'underconstrained');
  assert.equal(a.baseDegreesOfFreedom,1);
  assert.equal(a.geometry,null);
  const bad=plateSketchFixture();
  bad.constraints.push({id:'secondWidth',kind:'distanceX',a:'p0',b:'p1',value:135});
  const b=run(bad);
  assert.equal(b.status,'conflicted');
  assert.equal(b.geometry,null);
});

test('intent validation and semantic collision refusal',()=>{
  assert.throws(()=>createRoundedPlateIntent({...make(),radiusMm:0}),/positive finite/);
  assert.throws(()=>createRoundedPlateIntent({...make(),radiusMm:Infinity}),/positive finite/);
  assert.throws(()=>createRoundedPlateIntent({...make(),holeIds:['holeA','holeA']}),/invalid hole/);
  assert.equal(run(plateSketchFixture(),{...make(),holeIds:['missing']}).status,'conflicted');
  assert.throws(()=>run(plateSketchFixture(),{...make(),id:'p1'}),/collides/);
  assert.equal(run(plateSketchFixture(),{...make(),edgeIds:['left','top','right','bottom']}).status,'conflicted');
});

test('scaled normal-sized fixture keeps radius and tangencies through multiple edits',()=>{
  for(const r of [2,4,8,12,16]){
    const result=run(plateSketchFixture(),editRoundedPlateRadius(make(),r));
    assert.equal(result.status,'solved');
    assert.equal(result.geometry.boundary.filter(e=>e.kind==='arc').length,4);
    for(const arc of result.geometry.boundary.filter(e=>e.kind==='arc')){
      close(Math.hypot(arc.start.x-arc.center.x,arc.start.y-arc.center.y),r);
      close(Math.hypot(arc.end.x-arc.center.x,arc.end.y-arc.center.y),r);
    }
  }
});
