import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {inspectSelectedEdgeHolePlacement} from '../selected-edge-hole-placement.mjs';
import {createSelectedEdgeBreakpoints,inspectSelectedEdgeBreakpoints,
  editSelectedEdgeBreakpoints,dragSelectedEdgeBreakpoint,
  removeSelectedEdgeBreakpoints,MAX_SELECTED_EDGE_BREAKPOINTS,
  SELECTED_EDGE_BREAKPOINTS_VERSION} from '../selected-edge-breakpoints.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);
const select=(doc,edge='L:edge0')=>{
  const c=discoverPlateProfiles(doc).candidates.find(c=>c.lineIds.includes(edge));
  assert.ok(c,'selected contour must be real');
  return {candidateId:c.id,sourceSignature:serializeSketch(doc)};
};
const command=(doc,over={})=>({
  kind:'create-edge-breakpoints',version:1,
  sourceSignature:serializeSketch(doc),splitId:'datum',edgeId:'L:edge0',
  offsetsMm:[35,55],...over
});
const setup=()=>{
  const doc=createDimensionedLPlateSketch();
  const created=createSelectedEdgeBreakpoints(doc,select(doc),command(doc));
  assert.equal(created.kind,'accepted',JSON.stringify(created));
  return {doc,created};
};

test('selected L contour is genuinely split at solved dimensioned datums without altering area or holes',()=>{
  const {doc,created}=setup();
  assert.equal(SELECTED_EDGE_BREAKPOINTS_VERSION,1);
  assert.equal(MAX_SELECTED_EDGE_BREAKPOINTS,8);
  assert.equal(solveSketch(created.sketch).status,'solved');
  assert.equal(solveSketch(created.sketch).degreesOfFreedom,0);
  assert.equal(created.profile.lineIds.length,8);
  assert.deepEqual([...created.profile.holeIds].sort(),['L:holeLower','L:holeUpper']);
  near(created.profile.profile.areaMm2,5600-50*Math.PI);
  assert.deepEqual(created.sketch.lines.slice(-2).map(l=>l.id),
    ['datum:segment1','datum:segment2']);
  assert.ok(created.sketch.lines.some(l=>l.id==='L:edge0'));
  assert.equal(created.createdEntityIds.length,8);
  assert.equal(created.changedConstraintIds.length,2);
  const inspected=inspectSelectedEdgeBreakpoints(created.sketch,
    created.selection,'datum');
  assert.equal(inspected.kind,'selected_edge_breakpoints',JSON.stringify(inspected));
  assert.deepEqual(inspected.offsetsMm,[35,55]);
  assert.deepEqual(inspected.handles.map(h=>h.id),
    ['datum:handle1','datum:handle2']);
  assert.equal(inspected.originalEdgeId,'L:edge0');
  const edges=inspectSelectedEdgeHolePlacement(created.sketch,created.selection);
  assert.equal(edges.kind,'selected_edge_hole_placement');
  assert.ok(edges.edges.filter(e=>e.edgeId.startsWith('datum:segment'))
    .every(e=>e.editable));
  assert.equal(serializeSketch(doc),serializeSketch(createDimensionedLPlateSketch()));
});
test('independent drag and batch dimension edits preserve stable IDs, full solution and archived intent',()=>{
  const {created}=setup();
  const oldIds=created.sketch.lines.map(l=>l.id);
  const moved=dragSelectedEdgeBreakpoint(created.sketch,created.selection,{
    version:1,sourceSignature:created.nextSourceSignature,splitId:'datum',
    handleId:'datum:handle1',target:{x:39,y:100}});
  assert.equal(moved.kind,'accepted',JSON.stringify(moved));
  near(moved.gesture.projectionDeviationMm,100);
  near(moved.gesture.applied.x,39);
  assert.deepEqual(moved.sketch.lines.map(l=>l.id),oldIds);
  const updated=editSelectedEdgeBreakpoints(moved.sketch,moved.selection,{
    kind:'edit-edge-breakpoints',version:1,
    sourceSignature:moved.nextSourceSignature,splitId:'datum',
    offsetsMm:[30,70]});
  assert.equal(updated.kind,'accepted',JSON.stringify(updated));
  assert.deepEqual(updated.sketch.lines.map(l=>l.id),oldIds);
  assert.equal(solveSketch(updated.sketch).status,'solved');
  const archived=parseSketch(serializeSketch(updated.sketch));
  const view=inspectSelectedEdgeBreakpoints(archived,updated.selection,'datum');
  assert.equal(view.kind,'selected_edge_breakpoints');
  assert.deepEqual(view.offsetsMm,[30,70]);
});
test('retrospective bracket length and selected-edge re-admission preserve semantic reference offsets',()=>{
  const {created}=setup();
  const widened=editConstraint(created.sketch,'L:length',{value:150});
  const view=inspectSelectedEdgeBreakpoints(widened,select(widened),'datum');
  assert.equal(view.kind,'selected_edge_breakpoints',JSON.stringify(view));
  near(view.lengthMm,150);
  assert.deepEqual(view.offsetsMm,[35,55]);
  near(view.profile.profile.areaMm2,6500-50*Math.PI);
  assert.equal(solveSketch(widened).status,'solved');
});
test('vertical reverse-direction edge offsets remain signed relative to selected contour',()=>{
  const doc=createDimensionedLPlateSketch();
  const created=createSelectedEdgeBreakpoints(doc,select(doc),command(doc,{
    splitId:'leftDatum',edgeId:'L:edge5',offsetsMm:[10,25]}));
  assert.equal(created.kind,'accepted',JSON.stringify(created));
  const view=inspectSelectedEdgeBreakpoints(created.sketch,
    created.selection,'leftDatum');
  assert.equal(view.kind,'selected_edge_breakpoints',JSON.stringify(view));
  assert.equal(view.axis,'vertical');
  near(view.tangent.y,-1);
  near(view.handles[0].position.y,70);
  assert.equal(solveSketch(created.sketch).degreesOfFreedom,0);
});
test('remove restores original edge and contour; external authored references refuse removal',()=>{
  const {doc,created}=setup();
  const removed=removeSelectedEdgeBreakpoints(created.sketch,created.selection,{
    kind:'remove-edge-breakpoints',version:1,
    sourceSignature:created.nextSourceSignature,splitId:'datum'});
  assert.equal(removed.kind,'accepted',JSON.stringify(removed));
  assert.equal(removed.profile.lineIds.length,6);
  assert.deepEqual(removed.sketch,doc);
  assert.equal(serializeSketch(removed.sketch),serializeSketch(doc));
  const linked=createSketch({...created.sketch,
    constraints:[...created.sketch.constraints,
      {id:'external:offset',kind:'distanceX',a:'L:a',b:'datum:break1',value:35}]});
  const refuse=removeSelectedEdgeBreakpoints(linked,select(linked),{
    kind:'remove-edge-breakpoints',version:1,
    sourceSignature:serializeSketch(linked),splitId:'datum'});
  assert.equal(refuse.kind,'refused');
  assert.equal(refuse.reason,'dependent_constraint_blocks_removal');
});
test('disjoint unselected contour and unrelated entities are undisturbed',()=>{
  const d=createDimensionedLPlateSketch();
  const pts=[[300,100],[340,100],[340,130],[300,130]]
    .map(([x,y],i)=>({id:'other:p'+i,x,y}));
  d.points.push(...pts);
  d.lines.push(...pts.map((p,i)=>({id:'other:edge'+i,
    start:p.id,end:pts[(i+1)%4].id})));
  d.constraints.push(...pts.map(p=>({
    id:'other:fixed:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y})));
  const doc=createSketch(d),original=solveSketch(doc).geometry;
  const result=createSelectedEdgeBreakpoints(doc,select(doc),command(doc));
  assert.equal(result.kind,'accepted',JSON.stringify(result));
  assert.deepEqual(solveSketch(result.sketch).geometry.points.filter(p=>
    p.id.startsWith('other:')),original.points.filter(p=>
    p.id.startsWith('other:')));
  assert.equal(result.profile.unselectedLineIds.length,4);
});
test('stale, duplicate, unsorted, escaped and collapsed requests refuse atomically',()=>{
  const doc=createDimensionedLPlateSketch(),before=serializeSketch(doc);
  for(const override of [
    {sourceSignature:'stale'},{edgeId:'not-in-contour'},
    {offsetsMm:[]},{offsetsMm:[-1]},{offsetsMm:[0]},
    {offsetsMm:[60,40]},{offsetsMm:[40,40]},
    {offsetsMm:[121]},{offsetsMm:[119,120]},
    {offsetsMm:Array.from({length:9},(_,i)=>i+1)},
    {splitId:'L:edge0'},{splitId:'bad space'}
  ]){
    const r=createSelectedEdgeBreakpoints(doc,select(doc),command(doc,override));
    assert.equal(r.kind,'refused',JSON.stringify(override)+': '+JSON.stringify(r));
  }
  assert.equal(serializeSketch(doc),before);
  const {created}=setup();
  const edit=(stamp,offsets)=>editSelectedEdgeBreakpoints(
    created.sketch,created.selection,{
      kind:'edit-edge-breakpoints',version:1,sourceSignature:stamp,
      splitId:'datum',offsetsMm:offsets});
  assert.equal(edit('stale',[30,70]).reason,'stale_source');
  assert.equal(edit(created.nextSourceSignature,[60,30]).reason,
    'invalid_breakpoint_offsets');
  assert.equal(edit(created.nextSourceSignature,[35,55]).reason,'no_change');
  assert.equal(dragSelectedEdgeBreakpoint(created.sketch,created.selection,{
    version:1,sourceSignature:created.nextSourceSignature,
    splitId:'datum',handleId:'unknown',target:{x:10,y:20}}).reason,
    'unknown_handle');
});
test('underconstrained/conflicted originals cannot become admitted selected contour',()=>{
  const doc=createDimensionedLPlateSketch();
  const under=createSketch({...doc,
    constraints:doc.constraints.filter(c=>c.id!=='L:length')});
  const conflict=createSketch({...doc,constraints:[...doc.constraints,
    {id:'bad:length',kind:'distanceX',a:'L:a',b:'L:b',value:121}]});
  for(const bad of [under,conflict]){
    const r=createSelectedEdgeBreakpoints(bad,{
      candidateId:'unknown',sourceSignature:serializeSketch(bad)},command(bad));
    assert.equal(r.kind,'refused',JSON.stringify(r));
  }
});
test('published sketch breakpoint authoring demo executes against real modules',async()=>{
  await import('../examples/selected-edge-breakpoints.mjs');
});
