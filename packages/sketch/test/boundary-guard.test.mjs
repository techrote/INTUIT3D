import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPolygonBoundary, requireSimplePolygonBoundary } from '../boundary-guard.mjs';
import { createSketch, solveSketch, buildPlateProfile, serializeSketch, parseSketch, plateSketchFixture } from '../index.mjs';
import { discoverPlateProfiles } from '../profile-discovery.mjs';

const classify = points => assessPolygonBoundary(points.map(([x,y])=>({x,y}))).reason;
const fixedSketch = coords => {
  const points=coords.map(([x,y],i)=>({id:'p'+i,x,y}));
  const lines=points.map((p,i)=>({id:'e'+i,start:p.id,end:points[(i+1)%points.length].id}));
  const constraints=points.map(p=>({id:'fix:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  return createSketch({version:1,units:'mm',points,lines,circles:[],constraints});
};

test('conventional plate, concave simple polygon, and collinear forward edges admit',()=>{
  const square=[[0,0],[120,0],[120,80],[0,80]];
  const concave=[[0,0],[6,0],[6,6],[3,3],[0,6]];
  const collinear=[[0,0],[3,0],[6,0],[6,5],[0,5]];
  for(const coords of [square,concave,collinear]) {
    assert.equal(classify(coords),null);
    assert.equal(requireSimplePolygonBoundary(coords.map(([x,y])=>({x,y}))).status,'verified');
  }
  assert.equal(discoverPlateProfiles(plateSketchFixture()).status,'ready');
});

test('tiny crossing has nonzero encoded topology although naive double cross-products underflow',()=>{
  const t=1e-170;
  const crossed=[[0,t/2],[t,t/2],[t/2,0],[t/2,t],[10,0],[10,10],[0,10]];
  // The prior naive floating intersection orientation rounds to zero.
  const a=crossed[0],b=crossed[1],c=crossed[2];
  assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) === 0); // signed negative zero is still underflow
  assert.equal(classify(crossed),'nonadjacent_intersection');
  const doc=fixedSketch(crossed), solution=solveSketch(doc);
  assert.equal(solution.status,'solved');
  assert.throws(()=>buildPlateProfile(doc,solution,doc.lines.map(e=>e.id)),/boundary guard: nonadjacent_intersection/);
  assert.equal(discoverPlateProfiles(doc).status,'no_profile');
  const replay=parseSketch(serializeSketch(doc));
  assert.equal(assessPolygonBoundary(solveSketch(replay).geometry.points).reason,'nonadjacent_intersection');
});

test('integer-scale bow tie, endpoint contact and adjacent reversal refuse',()=>{
  assert.equal(classify([[0,0],[4,4],[0,4],[4,0]]),'nonadjacent_intersection');
  assert.equal(classify([[0,0],[8,0],[8,5],[4,0],[0,5]]),'nonadjacent_intersection');
  assert.equal(classify([[0,0],[5,0],[3,0],[3,4],[0,4]]),'adjacent_backtrack');
  const doc=fixedSketch([[0,0],[5,0],[3,0],[3,4],[0,4]]);
  assert.throws(()=>buildPlateProfile(doc,solveSketch(doc),doc.lines.map(e=>e.id)),/boundary guard: adjacent_backtrack/);
});

test('guard handles extreme finite magnitudes without floating tolerance relaxation',()=>{
  assert.equal(classify([[0,0],[1e-170,0],[1e-170,1e-170],[0,1e-170]]),null);
  assert.equal(classify([[0,0],[1e150,0],[1e150,1e150],[0,1e150]]),null);
  assert.equal(classify([[0,0],[1,0],[2,0]]),'adjacent_backtrack');
  assert.equal(classify([[0,0],[1,0],[1,0],[0,1]]),'zero_length_edge');
  assert.equal(classify([[0,0],[NaN,0],[1,1]]),'invalid_vertices');
  assert.equal(classify(Array.from({length:257},(_,i)=>[i,0])),'budget_exceeded');
});

test('classification is stable across winding reversal and cyclic reordering',()=>{
  const t=1e-170;
  const crossed=[[0,t/2],[t,t/2],[t/2,0],[t/2,t],[10,0],[10,10],[0,10]];
  for(let i=0;i<crossed.length;i++) {
    const shifted=[...crossed.slice(i),...crossed.slice(0,i)];
    assert.equal(classify(shifted),'nonadjacent_intersection');
    assert.equal(classify([...shifted].reverse()),'nonadjacent_intersection');
  }
});
