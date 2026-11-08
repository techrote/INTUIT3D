import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {SELECTED_PROFILE_DIMENSIONS_VERSION,inspectSelectedProfileDimensions,
  editSelectedProfileDimensions,dragSelectedProfileDimension}
  from '../selected-profile-dimensions.mjs';

const select=doc=>({
  candidateId:discoverPlateProfiles(doc).candidates.find(c=>c.lineIds.includes('L:edge0')).id,
  sourceSignature:serializeSketch(doc)
});
const command=(doc,changes)=>({kind:'edit-selected-dimensions',version:1,
  sourceSignature:serializeSketch(doc),changes});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);

test('real selected L contour exposes named constraint handles, not synthetic sliders',()=>{
  const doc=createDimensionedLPlateSketch(),view=inspectSelectedProfileDimensions(doc,select(doc));
  assert.equal(SELECTED_PROFILE_DIMENSIONS_VERSION,1);
  assert.equal(view.kind,'selected_profile_dimensions',JSON.stringify(view));
  assert.equal(view.solverStatus,'solved');
  assert.equal(view.degreesOfFreedom,0);
  assert.deepEqual(view.profile.holeIds.sort(),['L:holeLower','L:holeUpper']);
  const ids=new Set(view.dimensions.map(d=>d.constraintId));
  for(const id of ['L:length','L:flangeHeight','L:webWidth','L:height',
    'L:holeLowerOffsetX','L:holeLowerRadius'])assert.ok(ids.has(id),id);
  assert.equal(view.dimensions.find(d=>d.constraintId==='L:length').handle.id,
    'dimension:L:length');
  assert.equal(view.nativeExact,false);
});

test('atomic multi-dimension edit changes actual solved L geometry and both real hole dimensions',()=>{
  const doc=createDimensionedLPlateSketch(),before=serializeSketch(doc);
  const result=editSelectedProfileDimensions(doc,select(doc),command(doc,[
    {constraintId:'L:length',value:150},
    {constraintId:'L:flangeHeight',value:34},
    {constraintId:'L:holeLowerOffsetX',value:-26},
    {constraintId:'L:holeLowerRadius',value:6}
  ]));
  assert.equal(result.kind,'accepted',JSON.stringify(result));
  assert.equal(serializeSketch(doc),before);
  assert.equal(solveSketch(result.sketch).status,'solved');
  assert.equal(result.degreesOfFreedom,0);
  assert.deepEqual(result.changedConstraintIds,[
    'L:flangeHeight','L:holeLowerOffsetX','L:holeLowerRadius','L:length']);
  assert.deepEqual(result.changedRadiusIds,['L:holeLower']);
  const solution=solveSketch(result.sketch);
  const p=new Map(solution.geometry.points.map(x=>[x.id,x]));
  near(p.get('L:b').x,150);
  near(p.get('L:c').y,34);
  near(p.get('L:holeLowerCenter').x,124);
  near(result.profile.profile.areaMm2,6940-Math.PI*(36+25));
  assert.deepEqual(result.profile.holeIds.sort(),['L:holeLower','L:holeUpper']);
  assert.equal(result.nativeExact,false);
  assert.equal(result.exactBrepAvailable,false);
});

test('consistent redundant constraints show diagnostic; one-sided edit refuses with exact conflict witness',()=>{
  const doc=createDimensionedLPlateSketch();
  doc.constraints.push({id:'L:length:shadow',kind:'distanceX',
    a:'L:a',b:'L:b',value:120});
  const source=createSketch(doc),selection=select(source);
  const view=inspectSelectedProfileDimensions(source,selection);
  assert.equal(view.kind,'selected_profile_dimensions');
  assert.ok(view.redundantEquations>0);
  const saved=serializeSketch(source);
  const rejected=editSelectedProfileDimensions(source,selection,
    command(source,[{constraintId:'L:length',value:145}]));
  assert.equal(rejected.kind,'refused');
  assert.equal(rejected.reason,'proposed_dimensions_not_solved');
  assert.equal(rejected.sourceStatus,'conflicted');
  assert.equal(rejected.conflict.status,'minimal_conflict');
  assert.deepEqual(rejected.conflict.constraintIds,['L:length','L:length:shadow']);
  assert.equal(serializeSketch(source),saved,'refusal must never alter authored truth');
  const repaired=editSelectedProfileDimensions(source,selection,
    command(source,[{constraintId:'L:length',value:145},
      {constraintId:'L:length:shadow',value:145}]));
  assert.equal(repaired.kind,'accepted',JSON.stringify(repaired));
  assert.equal(solveSketch(repaired.sketch).status,'solved');
  assert.ok(repaired.redundantEquations>0,'user-authored redundancy is preserved');
  assert.ok(repaired.sketch.constraints.some(c=>c.id==='L:length:shadow'&&c.value===145));
});

test('drag of signed X dimension is projected without moving other authored dimensions',()=>{
  const doc=createDimensionedLPlateSketch(),sel=select(doc);
  const r=dragSelectedProfileDimension(doc,sel,{version:1,
    sourceSignature:sel.sourceSignature,handleId:'dimension:L:length',
    target:{x:155,y:9}});
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  const v=inspectSelectedProfileDimensions(r.sketch,r.selection);
  assert.equal(v.kind,'selected_profile_dimensions');
  assert.equal(v.dimensions.find(d=>d.constraintId==='L:length').value,155);
  near(r.gesture.applied.x,155);
  near(r.gesture.applied.y,0);
  near(r.gesture.projectionDeviationMm,9);
  assert.equal(r.changedConstraintIds.length,1);
  const archived=parseSketch(serializeSketch(r.sketch));
  assert.equal(inspectSelectedProfileDimensions(archived,r.selection).kind,
    'selected_profile_dimensions');
});

test('radial handle changes genuine hole radius; unsafe off-axis pointer does not invent geometry',()=>{
  const doc=createDimensionedLPlateSketch(),sel=select(doc);
  const initial=inspectSelectedProfileDimensions(doc,sel);
  const radius=initial.dimensions.find(d=>d.constraintId==='L:holeLowerRadius');
  const r=dragSelectedProfileDimension(doc,sel,{
    version:1,sourceSignature:sel.sourceSignature,handleId:radius.handle.id,
    target:{x:radius.handle.position.x+1,y:radius.handle.position.y+7}});
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  const v=inspectSelectedProfileDimensions(r.sketch,r.selection);
  near(v.dimensions.find(d=>d.constraintId===radius.constraintId).value,6);
  near(r.gesture.projectionDeviationMm,7);
  const invalid=dragSelectedProfileDimension(doc,sel,{
    version:1,sourceSignature:sel.sourceSignature,handleId:radius.handle.id,
    target:{x:radius.handle.position.x-10,y:radius.handle.position.y}});
  assert.equal(invalid.kind,'refused');
  assert.equal(invalid.reason,'nonpositive_radius');
});

test('stale, foreign, duplicate, nonfinite, no-op and invalid radius edits refuse',()=>{
  const doc=createDimensionedLPlateSketch(),sel=select(doc);
  const c=changes=>command(doc,changes);
  const cases=[
    [c([{constraintId:'other:width',value:45}]),'dimension_not_selected_or_editable'],
    [c([{constraintId:'L:length',value:130},{constraintId:'L:length',value:140}]),
      'invalid_dimension_change'],
    [c([{constraintId:'L:length',value:Infinity}]),'invalid_dimension_change'],
    [c([{constraintId:'L:length',value:120}]),'no_change'],
    [c([{constraintId:'L:holeLowerRadius',value:0}]),'nonpositive_radius'],
    [{...c([{constraintId:'L:length',value:140}]),sourceSignature:'old'},'stale_source']
  ];
  const original=serializeSketch(doc);
  for(const [cmd,reason] of cases){
    const result=editSelectedProfileDimensions(doc,sel,cmd);
    assert.equal(result.kind,'refused',JSON.stringify(result));
    assert.equal(result.reason,reason);
    assert.equal(serializeSketch(doc),original);
  }
});

test('profile-invalid dimensional changes refuse rather than merely accepting solved equations',()=>{
  const doc=createDimensionedLPlateSketch(),sel=select(doc);
  const r=editSelectedProfileDimensions(doc,sel,
    command(doc,[{constraintId:'L:webWidth',value:140}]));
  assert.equal(r.kind,'refused');
  assert.ok(['selected_contour_no_longer_admissible','selected_profile_rejected']
    .includes(r.reason),JSON.stringify(r));
  assert.equal(serializeSketch(doc),sel.sourceSignature);
});

test('incomplete original constraints refuse inspection/edit with underconstrained diagnostics',()=>{
  const doc=createDimensionedLPlateSketch();
  doc.constraints=doc.constraints.filter(c=>c.id!=='L:length');
  assert.equal(solveSketch(doc).status,'underconstrained');
  const selection={candidateId:'missing',sourceSignature:serializeSketch(doc)};
  const r=inspectSelectedProfileDimensions(doc,selection);
  assert.equal(r.kind,'refused');
  const attempted=editSelectedProfileDimensions(doc,selection,
    command(doc,[{constraintId:'L:flangeHeight',value:32}]));
  assert.equal(attempted.kind,'refused');
});

test('disjoint nonselected contour remains geometrically unchanged',()=>{
  const doc=createDimensionedLPlateSketch();
  const vertices=[{id:'q0',x:250,y:0},{id:'q1',x:270,y:0},
    {id:'q2',x:270,y:20},{id:'q3',x:250,y:20}];
  doc.points.push(...vertices);
  for(let i=0;i<4;i++)doc.lines.push({id:'q:edge'+i,
    start:vertices[i].id,end:vertices[(i+1)%4].id});
  for(const p of vertices)doc.constraints.push({
    id:'fix:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y});
  const source=createSketch(doc),selection=select(source);
  const before=solveSketch(source).geometry.points.filter(p=>p.id.startsWith('q'));
  const result=editSelectedProfileDimensions(source,selection,
    command(source,[{constraintId:'L:length',value:160}]));
  assert.equal(result.kind,'accepted',JSON.stringify(result));
  const after=solveSketch(result.sketch).geometry.points.filter(p=>p.id.startsWith('q'));
  assert.deepEqual(after,before);
  assert.equal(result.profile.lineIds.length,6);
});

test('retrospective edits and archive reopen preserve semantic constraint IDs and selection',()=>{
  const first=createDimensionedLPlateSketch(),originalIds=first.constraints.map(c=>c.id);
  const a=editSelectedProfileDimensions(first,select(first),
    command(first,[{constraintId:'L:length',value:145}]));
  assert.equal(a.kind,'accepted',JSON.stringify(a));
  const replay=parseSketch(serializeSketch(a.sketch));
  const b=editSelectedProfileDimensions(replay,a.selection,
    command(replay,[{constraintId:'L:height',value:95}]));
  assert.equal(b.kind,'accepted',JSON.stringify(b));
  assert.deepEqual(b.sketch.constraints.map(c=>c.id),originalIds);
  assert.equal(b.selection.sourceSignature,serializeSketch(b.sketch));
  near(solveSketch(b.sketch).geometry.points.find(p=>p.id==='L:e').y,95);
});
