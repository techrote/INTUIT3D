import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPolygonBoundary, requireSimplePolygonBoundary, assessSeparatedPolygonBoundaries } from '../boundary-guard.mjs';
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


test('exact two-contour isolation admits concave cutaway despite overlapping bounding boxes',()=>{
  const l=[[0,0],[120,0],[120,30],[40,30],[40,80],[0,80]];
  const inCutaway=[[62,42],[82,42],[82,60],[62,60]];
  const polygon=coords=>coords.map(([x,y])=>({x,y}));
  const check=(a,b)=>assessSeparatedPolygonBoundaries(polygon(a),polygon(b));
  assert.deepEqual(check(l,inCutaway),{version:1,status:'separated',reason:null});
  assert.equal(check(inCutaway,l).status,'separated');
  assert.equal(check([...l].reverse(),[...inCutaway].reverse()).status,'separated');
  for(const other of [
    [[10,10],[20,10],[20,20],[10,20]], // nested inside L
    [[100,10],[140,10],[140,20],[100,20]], // intersection
    [[120,0],[140,0],[140,20],[120,20]], // shared edge
    [[35,25],[50,25],[50,45],[35,45]] // concave corner crossing
  ]){
    assert.equal(check(l,other).status,'refused',JSON.stringify(other));
    assert.equal(check(other,l).status,'refused',JSON.stringify(other));
  }
  const enclosing=[[-10,-10],[150,-10],[150,100],[-10,100]];
  assert.deepEqual(check(l,enclosing),{version:1,status:'refused',
    reason:'nested_contour'});
  assert.deepEqual(check(enclosing,l),{version:1,status:'refused',
    reason:'nested_contour'});
  assert.equal(check(l,[[0,0],[0,0],[3,3]]).reason,'invalid_boundary');
  assert.equal(check(l,[[NaN,0],[1,0],[1,1]]).reason,'invalid_boundary');
});

test('exact two-contour isolation recognizes tiny encoded contact without tolerance changes',()=>{
  const t=1e-170;
  const a=[[0,0],[t,0],[t,t],[0,t]].map(([x,y])=>({x,y}));
  const b=[[t,t/2],[2*t,t/2],[2*t,t],[t,t]].map(([x,y])=>({x,y}));
  assert.deepEqual(assessSeparatedPolygonBoundaries(a,b),{
    version:1,status:'refused',reason:'boundary_contact'
  });
});
