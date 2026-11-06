import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCircularProfile,CIRCLE_GUARD_VERSION} from '../circle-guard.mjs';
import {createSketch,solveSketch,buildPlateProfile,serializeSketch,parseSketch,plateSketchFixture} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';

const square=[{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}];
const circle=(id,x,y,radius)=>({id,x,y,radius});
function fixedSketch(coords,circles=[]) {
  const points=coords.map(([x,y],i)=>({id:'p'+i,x,y}));
  const lines=points.map((p,i)=>({id:'e'+i,start:p.id,end:points[(i+1)%points.length].id}));
  const entityCircles=circles.map(({id,x,y,radius})=>{
    points.push({id:id+':center',x,y});
    return {id,center:id+':center',radius};
  });
  const constraints=points.map(p=>({id:'fix:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  constraints.push(...entityCircles.map(c=>({id:'radius:'+c.id,kind:'radius',circle:c.id,value:c.radius})));
  return createSketch({version:1,units:'mm',points,lines,circles:entityCircles,constraints});
}
const coords=pts=>pts.map(p=>[p.x,p.y]);

test('ordinary two-hole plate, exterior circle and versioned classifications',()=>{
  assert.equal(CIRCLE_GUARD_VERSION,1);
  const report=assessCircularProfile(square,[circle('a',35,40,6),circle('b',85,40,6),circle('exterior',150,100,1)]);
  assert.equal(report.status,'verified');
  assert.deepEqual(report.insideIds,['a','b']);
  assert.deepEqual(report.outsideIds,['exterior']);
  assert.equal(discoverPlateProfiles(plateSketchFixture()).status,'ready');
});
test('demonstrated former floating denominator underflow now refuses boundary contact',()=>{
  const t=1e-170;
  const polygon=[{x:0,y:0},{x:t,y:t},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  const center={x:t/2,y:t/2},radius=t/10;
  assert.equal(t*t+t*t,0); // prior denominator zero despite a nonzero encoded segment
  const a=polygon[0],b=polygon[1],dx=b.x-a.x,dy=b.y-a.y;
  const oldT=((center.x-a.x)*dx+(center.y-a.y)*dy)/(dx*dx+dy*dy);
  assert.ok(Number.isNaN(oldT));
  assert.equal(assessCircularProfile(polygon,[circle('tiny',center.x,center.y,radius)]).reason,
    'circle_touches_or_crosses_boundary:tiny');
  const doc=fixedSketch(coords(polygon),[circle('tiny',center.x,center.y,radius)]);
  const solved=solveSketch(doc);
  assert.equal(solved.status,'solved');
  assert.throws(()=>buildPlateProfile(doc,solved,doc.lines.map(e=>e.id),['tiny']),
    /hole tiny touches or crosses outer boundary/);
  const discovery=discoverPlateProfiles(doc);
  assert.equal(discovery.status,'no_profile');
  assert.match(discovery.rejected[0].detail,/circle_touches_or_crosses_boundary:tiny/);
});
test('a distant tiny edge is not itself a reason to reject an otherwise safe circle',()=>{
  const t=1e-170,polygon=[[0,0],[t,t],[10,0],[10,10],[0,10]];
  const doc=fixedSketch(polygon,[circle('safe',2,2,0.1)]);
  assert.equal(assessCircularProfile(polygon.map(([x,y])=>({x,y})),[circle('safe',2,2,0.1)]).status,'verified');
  const result=buildPlateProfile(doc,solveSketch(doc),doc.lines.map(e=>e.id),['safe']);
  assert.equal(result.holes[0].id,'safe');
  assert.equal(discoverPlateProfiles(doc).status,'ready');
});
test('inside, outside, boundary contact and exact tangency remain distinct',()=>{
  assert.equal(assessCircularProfile(square,[circle('i',35,40,6)]).status,'verified');
  assert.deepEqual(assessCircularProfile(square,[circle('o',130,40,1)]).outsideIds,['o']);
  assert.equal(assessCircularProfile(square,[circle('t',35,6,6)]).reason,'circle_touches_or_crosses_boundary:t');
  const onBoundary=assessCircularProfile(square,[circle('on',0,40,1)]);
  assert.equal(onBoundary.reason,'circle_touches_or_crosses_boundary:on');
  assert.deepEqual(onBoundary.outsideIds,[]);
  const crossingFromOutside=assessCircularProfile(square,[circle('outer',125,40,6)]);
  assert.equal(crossingFromOutside.reason,'circle_touches_or_crosses_boundary:outer');
  assert.deepEqual(crossingFromOutside.outsideIds,['outer']);
  assert.equal(assessCircularProfile(square,[circle('x',-1,40,2)]).reason,'circle_touches_or_crosses_boundary:x');
});
test('touching holes are refused at vanishing and ordinary radii',()=>{
  assert.equal(assessCircularProfile(square,[circle('a',35,40,6),circle('b',47,40,6)]).reason,
    'circular_holes_touch_or_overlap:a:b');
  const t=1e-170;
  const box=[{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}];
  assert.equal(assessCircularProfile(box,[circle('a',t,t,2*t),circle('b',2*t,t,2*t)]).reason,
    'circular_holes_touch_or_overlap:a:b');
});
test('wide exponent ranges do not overflow squared-distance comparisons',()=>{
  const huge=[{x:0,y:0},{x:1e155,y:0},{x:1e155,y:1e155},{x:0,y:1e155}];
  assert.equal(assessCircularProfile(huge,[circle('i',5e154,5e154,1e154)]).status,'verified');
  assert.equal(assessCircularProfile(huge,[circle('t',5e154,1e154,1e154)]).status,'rejected');
  const subnormal=[{x:0,y:0},{x:1e-300,y:0},{x:1e-300,y:1e-300},{x:0,y:1e-300}];
  assert.equal(assessCircularProfile(subnormal,[circle('i',5e-301,5e-301,1e-301)]).status,'verified');
});
test('winding, cyclic start and serialization replay preserve classification',()=>{
  const doc=fixedSketch([[0,0],[120,0],[120,80],[0,80]],[circle('a',35,40,6)]);
  const replay=parseSketch(serializeSketch(doc));
  assert.equal(discoverPlateProfiles(replay).status,'ready');
  for(let i=0;i<square.length;i++){
    const rot=square.slice(i).concat(square.slice(0,i));
    for(const vertices of [rot,[...rot].reverse()])
      assert.deepEqual(assessCircularProfile(vertices,[circle('i',35,40,6),circle('o',200,0,2)]).insideIds,['i']);
  }
});
test('invalid boundary, nonfinite input, duplicate IDs and resource limits fail closed',()=>{
  assert.equal(assessCircularProfile([[0,0],[1,1]].map(([x,y])=>({x,y})),[]).reason,'invalid_input');
  assert.match(assessCircularProfile([{x:0,y:0},{x:4,y:4},{x:0,y:4},{x:4,y:0}],[]).reason,/invalid_boundary/);
  assert.equal(assessCircularProfile(square,[circle('bad',NaN,1,1)]).reason,'invalid_input');
  assert.equal(assessCircularProfile(square,[circle('a',1,1,1),circle('a',2,2,1)]).reason,'invalid_input');
  assert.equal(assessCircularProfile(square,[circle('bad',1,1,0)]).reason,'invalid_input');
  assert.equal(assessCircularProfile(square,Array.from({length:65},(_,i)=>circle('p'+i,1,1,1))).reason,'budget_exceeded');
});
