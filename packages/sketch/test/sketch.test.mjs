import test from 'node:test';
import assert from 'node:assert/strict';
import { plateSketchFixture, solveSketch, editConstraint, serializeSketch, parseSketch, createSketch, buildPlateProfile } from '../index.mjs';
const edges = ['bottom','right','top','left'];
const holes = ['holeA','holeB'];
const solve = () => solveSketch(plateSketchFixture());

test('two-hole rectangle reaches unique solution, 0 DOF, analytic area', () => {
  const doc = plateSketchFixture();
  const solution = solveSketch(doc);
  assert.equal(solution.status,'solved');
  assert.equal(solution.degreesOfFreedom,0);
  assert.equal(solution.rank,14);
  const profile = buildPlateProfile(doc,solution,edges,holes);
  assert.equal(profile.status,'analytic_profile_only');
  assert.ok(Math.abs(profile.areaMm2 - (120*80 - 2*Math.PI*36)) < 1e-9);
  assert.deepEqual(profile.holes.map((h)=>h.id),holes);
});

test('dimension edits preserve semantic IDs and never mutate input', () => {
  const original = plateSketchFixture();
  const after = editConstraint(original,'width',{value:140});
  assert.equal(original.constraints.find((c)=>c.id==='width').value,120);
  const result = solveSketch(after);
  assert.equal(result.status,'solved');
  assert.equal(result.geometry.points.find((p)=>p.id==='p1').x,140);
  assert.equal(result.geometry.points.find((p)=>p.id==='p2').x,140);
  assert.equal(after.points.find((p)=>p.id==='p1').x,120);
  assert.ok(Math.abs(buildPlateProfile(after,result,edges,holes).areaMm2 - (140*80 - 2*Math.PI*36)) < 1e-9);
});

test('serialized document replays identical geometry and constraint IDs', () => {
  const doc = editConstraint(plateSketchFixture(),'width',{value:130});
  const replay = parseSketch(serializeSketch(doc));
  assert.deepEqual(replay,doc);
  assert.deepEqual(solveSketch(replay),solveSketch(doc));
  assert.deepEqual(replay.constraints.map((c)=>c.id),doc.constraints.map((c)=>c.id));
});

test('underconstraint retains preview but does not admit exact profile', () => {
  const doc = plateSketchFixture();
  doc.constraints = doc.constraints.filter((c)=>c.id!=='width');
  const result = solveSketch(doc);
  assert.equal(result.status,'underconstrained');
  assert.equal(result.degreesOfFreedom,1);
  assert.ok(result.geometry);
  assert.throws(()=>buildPlateProfile(doc,result,edges,holes),/fully constrained/);
});

test('contradictory dimensions are explicit: no fabricated valid geometry', () => {
  const doc = plateSketchFixture();
  doc.constraints.push({id:'impossibleWidth',kind:'distanceX',a:'p0',b:'p1',value:140});
  const result = solveSketch(doc);
  assert.equal(result.status,'conflicted');
  assert.equal(result.geometry,null);
  assert.ok(result.diagnostics.some((d)=>d.code==='contradictory_constraints'));
});

test('redundant consistent constraints are counted but do not fail the sketch', () => {
  const doc = plateSketchFixture();
  doc.constraints.push({id:'duplicateWidth',kind:'distanceX',a:'p0',b:'p1',value:120});
  const result = solveSketch(doc);
  assert.equal(result.status,'solved');
  assert.equal(result.redundantEquations,1);
});

test('stale and missing input references are rejected', () => {
  const doc = plateSketchFixture();
  doc.lines[0].end='unknown';
  assert.throws(()=>createSketch(doc),/bad line endpoints/);
});

test('unsupported nonlinear constraints fail closed', () => {
  const doc = plateSketchFixture();
  doc.constraints.push({id:'d',kind:'distance',a:'p0',b:'p1',value:120});
  assert.throws(()=>solveSketch(doc),/unsupported constraint kind/);
});

test('nonfinite and nonpositive values are rejected, as are duplicates', () => {
  const doc = plateSketchFixture();
  doc.points[0].x=NaN;
  assert.throws(()=>solveSketch(doc),/nonfinite point/);
  doc.points[0].x=0;
  doc.circles[0].radius=0;
  assert.throws(()=>solveSketch(doc),/bad circle/);
  doc.circles[0].radius=6;
  doc.points[1].id='p0';
  assert.throws(()=>solveSketch(doc),/duplicate ID/);
});

test('free variables retain initial seed, do not claim unique solution', () => {
  const doc = plateSketchFixture();
  doc.constraints=[];
  const solution = solveSketch(doc);
  assert.equal(solution.status,'underconstrained');
  assert.equal(solution.degreesOfFreedom,14);
  assert.deepEqual(solution.geometry.points,doc.points);
});

test('profile rejects non-cycle / unknown edges', () => {
  assert.throws(()=>buildPlateProfile(plateSketchFixture(),solve(),['bottom','top','right']),/matching endpoints/);
  assert.throws(()=>buildPlateProfile(plateSketchFixture(),solve(),['bottom','right','top','nonexistent']),/unknown profile edge/);
});

test('profile rejects crossing, outside or overlapping circular holes', () => {
  const doc=plateSketchFixture();
  const outside=editConstraint(doc,'holeA:fixed',{x:125});
  assert.throws(()=>buildPlateProfile(outside,solveSketch(outside),edges,holes),/outside profile/);
  const overlap=editConstraint(doc,'holeB:fixed',{x:40});
  assert.throws(()=>buildPlateProfile(overlap,solveSketch(overlap),edges,holes),/overlap/);
  const edge=editConstraint(doc,'holeA:fixed',{x:6});
  assert.throws(()=>buildPlateProfile(edge,solveSketch(edge),edges,holes),/touches/);
});

test('equalRadius yields determined positive radius without changing identity', () => {
  const doc=plateSketchFixture();
  doc.constraints=doc.constraints.filter((c)=>c.id!=='holeA:diameter');
  doc.constraints.push({id:'impossible',kind:'equalRadius',a:'holeA',b:'holeB'});
  assert.equal(solveSketch(doc).status,'solved');
});

test('coincident constraints are solved linearly and reduce two degrees of freedom',()=>{
  const doc=createSketch({version:1,units:'mm',points:[{id:'a',x:3,y:4},{id:'b',x:9,y:7}],lines:[],circles:[],constraints:[{id:'same',kind:'coincident',a:'a',b:'b'}]});
  const s=solveSketch(doc);
  assert.equal(s.status,'underconstrained');
  assert.equal(s.degreesOfFreedom,2);
  const [a,b]=s.geometry.points;
  assert.ok(Math.abs(a.x-b.x)<1e-12 && Math.abs(a.y-b.y)<1e-12);
});

test('stale solver output cannot be paired with an edited sketch',()=>{
  const original=plateSketchFixture();
  const before=solveSketch(original);
  const changed=editConstraint(original,'width',{value:140});
  assert.throws(()=>buildPlateProfile(changed,before,edges,holes),/stale or mismatched/);
});

test('numeric policy is explicit and checked',()=>{
  assert.throws(()=>solveSketch(plateSketchFixture(),{residualToleranceMm:0}),/numerical policy/);
  assert.throws(()=>solveSketch(plateSketchFixture(),{pivotTolerance:NaN}),/numerical policy/);
});


test('cannot enlarge tolerance or edit wrong constraint fields',()=>{
  const doc=plateSketchFixture();
  assert.throws(()=>solveSketch(doc,{residualToleranceMm:1}),/numerical policy/);
  assert.throws(()=>editConstraint(doc,'width',{x:3}),/patch keys/);
});

test('polygon with self-intersection cannot be admitted as a profile',()=>{
  const doc=createSketch({version:1,units:'mm',points:[
    {id:'a',x:0,y:0},{id:'b',x:2,y:2},{id:'c',x:0,y:2},{id:'d',x:2,y:0}
  ],lines:[{id:'ab',start:'a',end:'b'},{id:'bc',start:'b',end:'c'},{id:'cd',start:'c',end:'d'},{id:'da',start:'d',end:'a'}],circles:[],constraints:[
    {id:'fa',kind:'fixed',point:'a',x:0,y:0},{id:'fb',kind:'fixed',point:'b',x:2,y:2},
    {id:'fc',kind:'fixed',point:'c',x:0,y:2},{id:'fd',kind:'fixed',point:'d',x:2,y:0}
  ]});
  assert.throws(()=>buildPlateProfile(doc,solveSketch(doc),['ab','bc','cd','da']),/self-intersecting/);
});


test('unknown fields cannot silently enter authoritative sketch documents', () => {
  const doc = plateSketchFixture();
  doc.points[0].backendFaceId = 'transient-7';
  assert.throws(() => createSketch(doc), /invalid point fields/);
});

test('reject foreign constraint payloads and extra document-level keys', () => {
  const doc = plateSketchFixture();
  doc.constraints[0].inferredKernelId = 12;
  assert.throws(() => createSketch(doc), /invalid constraint fields/);
  delete doc.constraints[0].inferredKernelId;
  doc.previewMesh = [];
  assert.throws(() => createSketch(doc), /invalid document fields/);
});

test('overflow during linear elimination never claims a solved sketch', () => {
  const doc = createSketch({version:1, units:'mm', points:[
    {id:'a',x:1e308,y:0}, {id:'b',x:-1e308,y:0}
  ], lines:[],circles:[],constraints:[
    {id:'fixedA',kind:'fixed',point:'a',x:1e308,y:0},
    {id:'fixedB',kind:'fixed',point:'b',x:-1e308,y:0},
    {id:'enormousDifference',kind:'distanceX',a:'a',b:'b',value:1e308}
  ]});
  const result = solveSketch(doc);
  assert.notEqual(result.status, 'solved');
  assert.equal(result.geometry, null);
  assert.ok(result.diagnostics.some(d=>d.code === 'arithmetic_overflow' || d.code === 'contradictory_constraints'));
});


test('inherited object properties cannot impersonate persistent sketch IDs', () => {
  const d = plateSketchFixture();
  const phantom = Object.create({id:'not-own'});
  phantom.x = 0; phantom.y = 0;
  d.points[0] = phantom;
  assert.throws(() => createSketch(d), /invalid point fields/);
});


test('mutated or forged solver results cannot be admitted as profile geometry', () => {
  const doc = plateSketchFixture();
  const result = solveSketch(doc);
  result.geometry.points[1].x = 9000;
  assert.throws(() => buildPlateProfile(doc, result, edges, holes), /modified or unverifiable/);
});

test('overflowed polygon area is refused instead of exported as Infinity', () => {
  const coords = [[0,0], [1e200,0], [1e200,1e200], [0,1e200]];
  const points = coords.map(([x,y],i) => ({id:`p${i}`,x,y}));
  const lines = points.map((p,i) => ({id:`e${i}`,start:p.id,end:points[(i+1)%points.length].id}));
  const constraints = points.map(p => ({id:`fix:${p.id}`,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  const doc = createSketch({version:1,units:'mm',points,lines,circles:[],constraints});
  const result = solveSketch(doc);
  assert.equal(result.status,'solved');
  assert.throws(() => buildPlateProfile(doc,result,lines.map(l=>l.id)), /nonfinite or zero-area/);
});
