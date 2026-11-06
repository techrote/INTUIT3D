import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch, plateSketchFixture, editConstraint, serializeSketch, parseSketch} from '../index.mjs';
import {suggestSketchSnaps,SKETCH_SNAP_VERSION} from '../snap.mjs';
import {evaluateSnapGeometry} from '../snap-core.mjs';

const opt=(extra={})=>({radiusMm:2,maxCandidates:16,maxEntities:4096,excludeIds:[],...extra});
const minimal=(points,lines=[],circles=[])=>({points,lines,circles});

test('nearest plate endpoint, stable authored ID and no source mutation',()=>{
  const doc=plateSketchFixture(),before=serializeSketch(doc);
  const response=suggestSketchSnaps(doc,{x:0.5,y:0.25});
  assert.equal(response.version,SKETCH_SNAP_VERSION);
  assert.equal(response.previewOnly,true);
  assert.equal(response.status,'ready');
  assert.equal(response.sourceStatus,'solved');
  assert.equal(response.provisionalGeometry,false);
  assert.equal(response.selected.id,'point:p0');
  assert.equal(response.selected.entityId,'p0');
  assert.equal(response.selected.kind,'point');
  assert.equal(response.inputSignature,before);
  assert.equal(serializeSketch(doc),before);
});

test('closed segment projections use bounded parameters and midpoint tie priority',()=>{
  const geom=minimal([{id:'a',x:0,y:0},{id:'b',x:10,y:0}], [{id:'line',start:'a',end:'b'}]);
  const middle=evaluateSnapGeometry(geom,{x:5,y:1},opt());
  assert.equal(middle.selected.kind,'midpoint');
  assert.deepEqual(middle.candidates.filter(x=>['midpoint','segment'].includes(x.kind)).map(x=>x.parameter),[0.5,0.5]);
  const projection=evaluateSnapGeometry(geom,{x:3,y:1},opt());
  assert.equal(projection.selected.kind,'segment');
  assert.ok(Math.abs(projection.selected.parameter-0.3)<1e-15);
  assert.equal(projection.selected.x,3);
  assert.equal(projection.selected.y,0);
  const beyond=evaluateSnapGeometry(geom,{x:12,y:0},opt({radiusMm:3}));
  assert.equal(beyond.selected.id,'point:b');
  assert.equal(beyond.candidates.some(x=>x.kind==='segment'),false);
});

test('circle reference kinds distinguish center, quadrants, and arbitrary perimeter',()=>{
  const g=minimal([{id:'center',x:10,y:20}],[],[{id:'c',center:'center',radius:6}]);
  const perimeter=evaluateSnapGeometry(g,{x:14,y:24},opt({radiusMm:2}));
  assert.equal(perimeter.selected.kind,'circle_perimeter');
  assert.ok(Math.abs(Math.hypot(perimeter.selected.x-10,perimeter.selected.y-20)-6)<1e-12);
  const quadrant=evaluateSnapGeometry(g,{x:16,y:20},opt({radiusMm:1}));
  assert.equal(quadrant.selected.id,'circle_quadrant:c:E');
  const center=evaluateSnapGeometry(g,{x:10,y:20},opt({radiusMm:0.01}));
  assert.equal(center.selected.kind,'point');
  assert.equal(center.candidates.some(x=>x.kind==='circle_perimeter'),false);
});

test('grid tie priority and nearest quantization with negative coordinates',()=>{
  const geom=minimal([{id:'p',x:-3,y:-7}]);
  const r=evaluateSnapGeometry(geom,{x:-3,y:-7},opt({gridMm:1}));
  assert.equal(r.selected.id,'point:p');
  assert.equal(r.candidates.find(x=>x.kind==='grid').x,-3);
  const onlyGrid=evaluateSnapGeometry(minimal([]),{x:-2.6,y:-7.4},opt({gridMm:1}));
  assert.deepEqual([onlyGrid.selected.x,onlyGrid.selected.y],[-3,-7]);
});

test('equal-distance candidates deterministic under entity permutation',()=>{
  const points=[{id:'z',x:-1,y:0},{id:'a',x:1,y:0}];
  const run=p=>evaluateSnapGeometry(minimal(p),{x:0,y:0},opt());
  assert.equal(run(points).selected.id,'point:a');
  assert.deepEqual(run(points).candidates,run([...points].reverse()).candidates);
});

test('exclusions, exact radius boundaries, and result limits',()=>{
  const g=minimal([{id:'a',x:0,y:0},{id:'b',x:1,y:0},{id:'c',x:2,y:0}]);
  const r=evaluateSnapGeometry(g,{x:0,y:0},opt({radiusMm:1,maxCandidates:1,excludeIds:['a']}));
  assert.equal(r.candidates.length,1);
  assert.equal(r.selected.entityId,'b');
  assert.equal(r.selected.distanceMm,1);
  assert.equal(evaluateSnapGeometry(g,{x:10,y:0},opt()).status,'no_candidate');
});

test('large representable line coordinates avoid squared-norm overflow',()=>{
  const g=minimal([{id:'a',x:0,y:0},{id:'b',x:1e200,y:0}], [{id:'big',start:'a',end:'b'}]);
  assert.equal(evaluateSnapGeometry(g,{x:4e199,y:1e199},opt({radiusMm:1e9})).status,'no_candidate');
  const on=evaluateSnapGeometry(g,{x:4e199,y:0},opt({radiusMm:1e9}));
  assert.equal(on.status,'ready');
  assert.equal(on.selected.kind,'segment');
  assert.equal(on.selected.x,4e199);
});

test('degenerate, nonfinite, overflowing geometry refuses all candidates',()=>{
  const bad=[
    minimal([{id:'a',x:0,y:0},{id:'b',x:0,y:0}],[{id:'line',start:'a',end:'b'}]),
    minimal([{id:'a',x:-1e308,y:0},{id:'b',x:1e308,y:0}],[{id:'line',start:'a',end:'b'}]),
    minimal([{id:'a',x:0,y:0}],[],[{id:'c',center:'a',radius:Infinity}]),
    minimal([{id:'a',x:1e308,y:0}],[],[{id:'c',center:'a',radius:1e308}]),
    minimal([{id:'a',x:1e308,y:0}])
  ];
  const cursors=[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:1e308,y:0},{x:-1e308,y:0}];
  for(let i=0;i<bad.length;i++){
    const r=evaluateSnapGeometry(bad[i],cursors[i],opt());
    assert.equal(r.status,'numerical_failure',`case ${i}`);
    assert.deepEqual(r.candidates,[]);
    assert.equal(r.selected,null);
  }
});

test('fully conflicted sketch never produces inferred snap points',()=>{
  const doc=plateSketchFixture();
  doc.constraints.push({id:'opposed',kind:'distanceX',a:'p0',b:'p1',value:121});
  const before=serializeSketch(doc);
  const r=suggestSketchSnaps(doc,{x:120,y:0});
  assert.equal(r.status,'source_unsolved');
  assert.equal(r.sourceStatus,'conflicted');
  assert.deepEqual(r.candidates,[]);
  assert.equal(serializeSketch(doc),before);
});

test('underconstrained seed positions explicitly marked provisional',()=>{
  const doc=createSketch({version:1,units:'mm',points:[{id:'free',x:5,y:7}],lines:[],circles:[],constraints:[]});
  const r=suggestSketchSnaps(doc,{x:5,y:7});
  assert.equal(r.status,'ready');
  assert.equal(r.sourceStatus,'underconstrained');
  assert.equal(r.provisionalGeometry,true);
  assert.equal(r.selected.id,'point:free');
});

test('retrospective dimension edit and JSON replay update inference stamp and geometry',()=>{
  const original=plateSketchFixture();
  const updated=editConstraint(original,'width',{value:140});
  const replay=parseSketch(serializeSketch(updated));
  const a=suggestSketchSnaps(original,{x:120,y:0});
  const b=suggestSketchSnaps(replay,{x:140,y:0});
  assert.equal(a.selected.id,'point:p1');
  assert.equal(b.selected.id,'point:p1');
  assert.notEqual(a.inputSignature,b.inputSignature);
  assert.equal(b.selected.x,140);
  assert.deepEqual(b,suggestSketchSnaps(updated,{x:140,y:0}));
});

test('budget and validation refuse unsafe or stale selections',()=>{
  const doc=plateSketchFixture();
  const exhausted=suggestSketchSnaps(doc,{x:0,y:0},{maxEntities:1});
  assert.equal(exhausted.status,'budget_exceeded');
  assert.equal(exhausted.sourceStatus,null);
  assert.equal(exhausted.selected,null);
  for(const options of [null,[],{radiusMm:0},{radiusMm:Infinity},{maxCandidates:65},
    {maxEntities:4097},{gridMm:0},{excludeIds:['absent']},{excludeIds:['p0','p0']},{bogus:true}])
    assert.throws(()=>suggestSketchSnaps(doc,{x:0,y:0},options),/sketch snap:/);
  for(const cursor of [null,{x:Infinity,y:0},{x:0,y:0,z:1},{x:0},{x:0,y:NaN}])
    assert.throws(()=>suggestSketchSnaps(doc,cursor),/sketch snap:/);
});

test('64 cursor samples and changing widths return bounded sorted candidates',()=>{
  for(const width of [80,100,120,150]){
    const doc=editConstraint(plateSketchFixture(),'width',{value:width});
    for(let i=0;i<16;i++){
      const x=width*i/15;
      const r=suggestSketchSnaps(doc,{x,y:0.3},{radiusMm:5,maxCandidates:4,gridMm:10});
      assert.ok(['ready','no_candidate'].includes(r.status));
      assert.ok(r.candidates.length<=4);
      assert.equal(r.inputSignature,serializeSketch(doc));
      assert.deepEqual(r.candidates.map(c=>c.distanceMm),[...r.candidates.map(c=>c.distanceMm)].sort((a,b)=>a-b));
      if(r.selected)assert.deepEqual(r.selected,r.candidates[0]);
    }
  }
});
