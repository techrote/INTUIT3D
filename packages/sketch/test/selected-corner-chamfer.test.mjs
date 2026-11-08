import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,serializeSketch,parseSketch,solveSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {createSelectedCornerChamfer,inspectSelectedCornerChamfer,
  editSelectedCornerChamfer,dragSelectedCornerChamferHandle,
  SELECTED_CORNER_CHAMFER_VERSION} from '../selected-corner-chamfer.mjs';
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-7,x+' != '+y);
const selection=d=>({candidateId:discoverPlateProfiles(d).candidates
  .find(c=>c.lineIds.includes('L:edge0')).id,sourceSignature:serializeSketch(d)});
const create=(d,over={})=>createSelectedCornerChamfer(d,selection(d),{
  kind:'create-corner-chamfer',version:1,sourceSignature:serializeSketch(d),
  chamferId:'bevel',cornerPointId:'L:b',incomingMm:12,outgoingMm:8,...over});
const fixture=()=>{const d=createDimensionedLPlateSketch(),r=create(d);
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  return {d,r};
};
test('selected convex corner is chamfered using the real linear solver, retaining original IDs',()=>{
  const {d,r}=fixture();
  assert.equal(SELECTED_CORNER_CHAMFER_VERSION,1);
  assert.equal(solveSketch(r.sketch).status,'solved');
  assert.equal(solveSketch(r.sketch).degreesOfFreedom,0);
  assert.deepEqual([...r.profile.holeIds].sort(),['L:holeLower','L:holeUpper']);
  assert.equal(r.profile.lineIds.length,7);
  for(const id of ['L:edge0','L:edge1','bevel:bevel'])
    assert.ok(r.profile.lineIds.includes(id));
  assert.deepEqual(r.createdEntityIds,['bevel:incoming','bevel:outgoing','bevel:bevel']);
  assert.equal(r.changedConstraintIds.length,4);
  near(r.profile.profile.areaMm2,5600-50*Math.PI-48);
  assert.equal(serializeSketch(d),serializeSketch(createDimensionedLPlateSketch()));
  assert.equal(r.nativeExact,false);assert.equal(r.previewOnly,true);
  const v=inspectSelectedCornerChamfer(r.sketch,r.selection,'bevel');
  assert.equal(v.kind,'selected_corner_chamfer',JSON.stringify(v));
  near(v.incomingMm,12);near(v.outgoingMm,8);
  assert.deepEqual(v.handles.map(h=>h.id),
    ['bevel:handle:incoming','bevel:handle:outgoing']);
});
test('atomic setback editing, actual projected handles and durable replay',()=>{
  const {r}=fixture();
  const edited=editSelectedCornerChamfer(r.sketch,r.selection,{
    kind:'edit-corner-chamfer',version:1,sourceSignature:r.nextSourceSignature,
    chamferId:'bevel',incomingMm:20,outgoingMm:10});
  assert.equal(edited.kind,'accepted',JSON.stringify(edited));
  near(edited.profile.profile.areaMm2,5600-50*Math.PI-100);
  const reopened=parseSketch(serializeSketch(edited.sketch));
  const v=inspectSelectedCornerChamfer(reopened,edited.selection,'bevel');
  assert.equal(v.kind,'selected_corner_chamfer',JSON.stringify(v));
  near(v.incomingMm,20);near(v.outgoingMm,10);
  const dragged=dragSelectedCornerChamferHandle(reopened,edited.selection,{
    version:1,sourceSignature:edited.nextSourceSignature,
    chamferId:'bevel',handleId:'bevel:handle:incoming',
    target:{x:96,y:9}});
  assert.equal(dragged.kind,'accepted',JSON.stringify(dragged));
  near(dragged.gesture.applied.x,96);
  near(dragged.gesture.projectionDeviationMm,9);
  near(inspectSelectedCornerChamfer(dragged.sketch,dragged.selection,'bevel').incomingMm,24);
});
test('retrospective source dimension alters the underlying bracket without erasing chamfer dimensions',()=>{
  const {r}=fixture();
  const bigger=editConstraint(r.sketch,'L:length',{value:150});
  const v=inspectSelectedCornerChamfer(bigger,selection(bigger),'bevel');
  assert.equal(v.kind,'selected_corner_chamfer',JSON.stringify(v));
  near(v.corner.x,150);near(v.incomingMm,12);near(v.outgoingMm,8);
  assert.equal(solveSketch(bigger).degreesOfFreedom,0);
});
test('disjoint contour geometry remains precisely untouched',()=>{
  const d=createDimensionedLPlateSketch();
  const pts=[[300,100],[340,100],[340,130],[300,130]]
    .map(([x,y],i)=>({id:'other:p'+i,x,y}));
  d.points.push(...pts);
  d.lines.push(...pts.map((p,i)=>({id:'other:edge'+i,
    start:p.id,end:pts[(i+1)%4].id})));
  d.constraints.push(...pts.map(p=>({id:'other:fixed:'+p.id,
    kind:'fixed',point:p.id,x:p.x,y:p.y})));
  const source=createSketch(d),before=solveSketch(source).geometry.points
    .filter(p=>p.id.startsWith('other:'));
  const r=create(source);
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  assert.deepEqual(solveSketch(r.sketch).geometry.points.filter(p=>
    p.id.startsWith('other:')),before);
});
test('invalid and stale transactions refuse without changing source',()=>{
  const d=createDimensionedLPlateSketch(),stamp=serializeSketch(d);
  for(const over of [{sourceSignature:'stale'},{cornerPointId:'L:d'},
    {cornerPointId:'missing'},{incomingMm:0},{outgoingMm:0},
    {incomingMm:121},{outgoingMm:31},{chamferId:'L:edge0'},
    {chamferId:'bad name'}]){
    const r=create(d,over);
    assert.equal(r.kind,'refused',JSON.stringify(over)+' '+JSON.stringify(r));
  }
  assert.equal(serializeSketch(d),stamp);
  const {r}=fixture();
  const base={kind:'edit-corner-chamfer',version:1,
    sourceSignature:r.nextSourceSignature,chamferId:'bevel',
    incomingMm:12,outgoingMm:8};
  assert.equal(editSelectedCornerChamfer(r.sketch,r.selection,
    {...base,sourceSignature:'stale'}).reason,'stale_source');
  assert.equal(editSelectedCornerChamfer(r.sketch,r.selection,base).reason,'no_change');
  assert.equal(dragSelectedCornerChamferHandle(r.sketch,r.selection,{
    version:1,sourceSignature:r.nextSourceSignature,chamferId:'bevel',
    handleId:'unknown',target:{x:3,y:4}}).reason,'unknown_handle');
});
test('hole boundary contacts, conflicted and underconstrained sketches remain refused',()=>{
  const d=createDimensionedLPlateSketch(),before=serializeSketch(d);
  const contact=create(d,{incomingMm:35,outgoingMm:26});
  assert.equal(contact.kind,'refused',JSON.stringify(contact));
  assert.equal(serializeSketch(d),before);
  const under=createSketch({...d,constraints:d.constraints.filter(c=>c.id!=='L:length')});
  const conflict=createSketch({...d,constraints:[...d.constraints,
    {id:'bad:length',kind:'distanceX',a:'L:a',b:'L:b',value:121}]});
  for(const source of [under,conflict]){
    const r=createSelectedCornerChamfer(source,
      {candidateId:'cycle:L:edge0|L:edge1|L:edge2|L:edge3|L:edge4|L:edge5',
        sourceSignature:serializeSketch(source)},
      {kind:'create-corner-chamfer',version:1,sourceSignature:serializeSketch(source),
        chamferId:'bevel',cornerPointId:'L:b',incomingMm:12,outgoingMm:8});
    assert.equal(r.kind,'refused',JSON.stringify(r));
  }
});
test('the public consumer demo executes with real SKETCH imports',async()=>{
  await import('../examples/selected-corner-chamfer.mjs');
});
