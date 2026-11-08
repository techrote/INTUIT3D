import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {createSelectedEdgeBreakpoints} from '../selected-edge-breakpoints.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle}
  from '../selected-profile-handles.mjs';
import {inspectPointerSelectableContours,selectContourAtPointer,
  pickContourEdgeAtPointer,POINTER_CONTOUR_SELECTION_VERSION}
  from '../pointer-contour-selection.mjs';

const stamp=doc=>serializeSketch(doc);
const pick=(doc,point={x:10,y:40},boundaryClearanceMm=0)=>selectContourAtPointer(
  doc,{kind:'select-contour-at-pointer',version:1,sourceSignature:stamp(doc),
    point,boundaryClearanceMm});
const edge=(doc,point={x:65,y:0.5},maxDistanceMm=1)=>pickContourEdgeAtPointer(
  doc,{kind:'pick-contour-edge-at-pointer',version:1,sourceSignature:stamp(doc),
    point,maxDistanceMm});
const addRectangle=(doc,prefix,x,y,w,h)=>{
  const result=structuredClone(doc);
  const pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
    .map(([px,py],i)=>({id:prefix+':p'+i,x:px,y:py}));
  result.points.push(...pts);
  result.lines.push(...pts.map((p,i)=>({
    id:prefix+':line'+i,start:p.id,end:pts[(i+1)%4].id
  })));
  result.constraints.push(...pts.map(p=>({
    id:prefix+':fixed:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
  })));
  return createSketch(result);
};

test('click picks genuine L interior and obtains usable source-fenced selection, without native claims',()=>{
  const doc=createDimensionedLPlateSketch();
  const inventory=inspectPointerSelectableContours(doc);
  assert.equal(POINTER_CONTOUR_SELECTION_VERSION,1);
  assert.equal(inventory.kind,'pointer_selectable_contours');
  assert.equal(inventory.candidates.length,1);
  const result=pick(doc);
  assert.equal(result.kind,'selected',JSON.stringify(result));
  assert.equal(result.profile.kind,'selected_analytic_profile');
  assert.ok(result.profile.lineIds.includes('L:edge0'));
  assert.deepEqual(result.profile.holeIds.sort(),['L:holeLower','L:holeUpper']);
  assert.equal(result.selection.sourceSignature,stamp(doc));
  assert.equal(result.nativeExact,false);
  assert.equal(result.exactBrepAvailable,false);
  assert.equal(result.independentStepQualified,false);
});

test('explicit click inside each disjoint solved contour selects correct semantic loop',()=>{
  const doc=addRectangle(createDimensionedLPlateSketch(),'second',300,100,40,30);
  const list=inspectPointerSelectableContours(doc);
  assert.equal(list.discoveryStatus,'ambiguous');
  assert.equal(list.candidates.length,2);
  const first=pick(doc,{x:10,y:40});
  const second=pick(doc,{x:310,y:110});
  assert.equal(first.kind,'selected');
  assert.equal(second.kind,'selected');
  assert.notEqual(first.selection.candidateId,second.selection.candidateId);
  assert.equal(first.profile.boundary.length,6);
  assert.equal(second.profile.boundary.length,4);
  assert.deepEqual(second.profile.holeIds,[]);
  assert.equal(pick(doc,{x:250,y:100}).reason,'outside_contours');
});

test('void holes, contour boundaries and configurable clearance never become material',()=>{
  const doc=createDimensionedLPlateSketch();
  assert.equal(pick(doc,{x:90,y:15}).reason,'hole_void');
  assert.equal(pick(doc,{x:95,y:15}).reason,'boundary_ambiguous');
  assert.equal(pick(doc,{x:0,y:40}).reason,'boundary_ambiguous');
  assert.equal(pick(doc,{x:0.1,y:40},0.2).reason,'boundary_ambiguous');
  assert.equal(pick(doc,{x:0.1,y:40},0).kind,'selected');
  assert.equal(pick(doc,{x:45,y:40}).reason,'outside_contours');
});

test('edge click returns actual directed semantic edge and mm projection, not a face index',()=>{
  const doc=createDimensionedLPlateSketch();
  const result=edge(doc);
  assert.equal(result.kind,'selected_edge',JSON.stringify(result));
  assert.equal(result.edgeId,'L:edge0');
  assert.equal(result.startPointId,'L:a');
  assert.equal(result.endPointId,'L:b');
  assert.equal(result.hit.fraction,65/120);
  assert.equal(result.hit.alongMm,65);
  assert.equal(result.hit.distanceMm,0.5);
  assert.equal(result.selection.sourceSignature,stamp(doc));
  assert.equal(edge(doc,{x:0,y:0}).reason,'ambiguous_edges');
  assert.equal(edge(doc,{x:75,y:50}).reason,'no_edge_in_range');
});

test('pointer-select -> existing true dimension handle -> atomic solver edit -> archive/reselect',()=>{
  const doc=createDimensionedLPlateSketch();
  const selected=pick(doc);
  assert.equal(selected.kind,'selected');
  const controls=inspectSelectedProfileHandles(doc,selected.selection);
  assert.equal(controls.kind,'selected_profile_handles');
  const length=controls.controls.find(h=>h.constraintId==='L:length');
  assert.ok(length);
  const edited=editSelectedProfileHandle(doc,selected.selection,{
    kind:'set-dimension',sourceSignature:stamp(doc),handleId:length.id,valueMm:150
  });
  assert.equal(edited.kind,'accepted',JSON.stringify(edited));
  assert.equal(solveSketch(edited.sketch).status,'solved');
  assert.equal(edited.sketch.constraints.find(c=>c.id==='L:length').value,150);
  assert.equal(edited.selection.candidateId,selected.selection.candidateId);
  const reopened=parseSketch(stamp(edited.sketch));
  const fresh=pick(reopened,{x:140,y:15});
  assert.equal(fresh.kind,'selected',JSON.stringify(fresh));
  assert.equal(fresh.selection.candidateId,selected.selection.candidateId);
  assert.equal(selectContourAtPointer(reopened,{
    kind:'select-contour-at-pointer',version:1,
    sourceSignature:selected.selection.sourceSignature,
    point:{x:140,y:15},boundaryClearanceMm:0
  }).reason,'stale_source');
  assert.equal(edited.sketch.constraints.find(c=>c.id==='L:holeLowerOffsetX').value,-30);
});

test('pointer selection survives genuine solver-authored subdivision and follows new segment IDs',()=>{
  const doc=createDimensionedLPlateSketch();
  const selected=pick(doc);
  const split=createSelectedEdgeBreakpoints(doc,selected.selection,{
    kind:'create-edge-breakpoints',version:1,sourceSignature:stamp(doc),
    splitId:'datum',edgeId:'L:edge0',offsetsMm:[55,75]
  });
  assert.equal(split.kind,'accepted',JSON.stringify(split));
  const inside=pick(split.sketch,{x:10,y:40});
  assert.equal(inside.kind,'selected');
  assert.equal(inside.selection.candidateId,split.selection.candidateId);
  const subedge=edge(split.sketch);
  assert.equal(subedge.kind,'selected_edge',JSON.stringify(subedge));
  assert.equal(subedge.edgeId,'datum:segment1');
  assert.equal(subedge.hit.alongMm,10);
});

test('unsolved or intersecting sketches cannot be laundered through pointer selection',()=>{
  const base=createDimensionedLPlateSketch();
  const under=createSketch({...base,
    constraints:base.constraints.filter(c=>c.id!=='L:length')});
  const conflicting=createSketch({...base,constraints:[
    ...base.constraints,{id:'conflict',kind:'distanceX',a:'L:a',b:'L:b',value:121}
  ]});
  for(const doc of [under,conflicting]){
    const inventory=inspectPointerSelectableContours(doc);
    assert.equal(inventory.kind,'refused');
    assert.equal(inventory.reason,'source_not_profile_ready');
    assert.ok(inventory.diagnostics.length>0);
    assert.ok(inventory.diagnostics.some(d=>d.code==='free_degrees_of_freedom'||
      d.code==='contradictory_constraints'));
    assert.equal(pick(doc).kind,'refused');
  }
  const nested=addRectangle(base,'nested',10,10,10,10);
  assert.equal(inspectPointerSelectableContours(nested).reason,
    'no_admissible_contour');
  assert.equal(pick(nested).kind,'refused');
});

test('invalid/stale pointer commands refuse deterministically and never mutate sketch',()=>{
  const doc=createDimensionedLPlateSketch(),before=stamp(doc);
  const baseline={
    kind:'select-contour-at-pointer',version:1,sourceSignature:before,
    point:{x:10,y:40},boundaryClearanceMm:0
  };
  for(const changes of [
    {sourceSignature:'stale'},{point:{x:NaN,y:40}},
    {point:{x:Infinity,y:40}},{point:{x:10,y:40,z:5}},
    {boundaryClearanceMm:-1},{boundaryClearanceMm:21},
    {version:2},{kind:'guess-contour'}
  ]){
    const r=selectContourAtPointer(doc,{...baseline,...changes});
    assert.equal(r.kind,'refused');
  }
  for(const changes of [
    {maxDistanceMm:0},{maxDistanceMm:100},
    {point:{x:NaN,y:0}},{sourceSignature:'stale'}
  ]){
    const r=pickContourEdgeAtPointer(doc,{
      kind:'pick-contour-edge-at-pointer',version:1,sourceSignature:before,
      point:{x:65,y:0.5},maxDistanceMm:1,...changes
    });
    assert.equal(r.kind,'refused');
  }
  assert.equal(stamp(doc),before);
});
test('published source-fenced pointer consumer example executes',async()=>{
  await import('../examples/pointer-contour-selection.mjs');
});
