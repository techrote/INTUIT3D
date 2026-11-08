import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {createClosedContour,editClosedContourVertices,inspectClosedContour}
  from '../closed-contour-authoring.mjs';
import {editSelectedProfileHole} from '../selected-profile-hole-authoring.mjs';
import {pickContourEdgeAtPointer} from '../pointer-contour-selection.mjs';
import {inspectClosedContourEdges,planClosedContourEdgeOffset,
  dragClosedContourEdge,CONTOUR_EDGE_OFFSET_VERSION}
  from '../contour-edge-offset.mjs';

const blank=()=>createSketch({version:1,units:'mm',points:[],lines:[],
  circles:[],constraints:[]});
const rectangle=[{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}];
const make=(vertices=rectangle,contourId='panel',base=blank())=>{
  const created=createClosedContour(base,{
    kind:'create-closed-contour',version:1,
    sourceSignature:serializeSketch(base),contourId,vertices
  });
  assert.equal(created.kind,'accepted',JSON.stringify(created));
  return created;
};
const inspect=a=>inspectClosedContourEdges(a.sketch,a.selection,'panel');
const offset=(a,edgeId,offsetMm)=>planClosedContourEdgeOffset(
  a.sketch,a.selection,{kind:'offset-closed-contour-edge',version:1,
    sourceSignature:a.nextSourceSignature,contourId:'panel',edgeId,offsetMm});
const accept=plan=>assert.equal(plan.kind,'planned_edge_offset',JSON.stringify(plan));
const pointPositions=a=>inspectClosedContour(a.sketch,a.selection,'panel').vertices;
const round=(n)=>Math.round(n*1e8)/1e8;

test('source-admitted semantic edge inventory is stable and orientation-aware',()=>{
  assert.equal(CONTOUR_EDGE_OFFSET_VERSION,1);
  const a=make();
  const view=inspect(a);
  assert.equal(view.kind,'contour_edges',JSON.stringify(view));
  assert.equal(view.edges.length,4);
  assert.deepEqual(view.edges.map(e=>e.edgeId),
    ['panel:edge:0','panel:edge:1','panel:edge:2','panel:edge:3']);
  assert.deepEqual(view.edges[1].normal,{x:1,y:0});
  assert.deepEqual(view.edges[0].normal,{x:0,y:-1});
  assert.deepEqual(view.edges[1].midpoint,{x:120,y:40});
  assert.equal(view.solverStatus,'solved');
  assert.equal(view.degreesOfFreedom,0);
  assert.equal(view.nativeExact,false);
  const reopened=inspectClosedContourEdges(parseSketch(serializeSketch(a.sketch)),
    a.selection,'panel');
  assert.deepEqual(reopened.edges,view.edges);
});

test('one edge offset alters both vertices through genuine constraints and replays exactly',()=>{
  const a=make(),source=serializeSketch(a.sketch);
  const p=offset(a,'panel:edge:1',20);accept(p);
  assert.equal(p.editCommand.kind,'edit-closed-contour-vertices');
  assert.deepEqual(p.editCommand.changes.map(x=>x.index),[1,2]);
  assert.deepEqual(pointPositions(p.acceptance),[
    {x:0,y:0},{x:140,y:0},{x:140,y:80},{x:0,y:80}]);
  assert.equal(solveSketch(p.acceptance.sketch).status,'solved');
  assert.equal(p.acceptance.profile.profile.areaMm2,11200);
  assert.equal(p.appliedOffsetMm,20);
  assert.equal(p.residualMm,0);
  assert.equal(serializeSketch(a.sketch),source,'source immutable');
  // This is the exact EXISTING RUNTIME edit operation, not a new journal type.
  const runtimeReplay=editClosedContourVertices(a.sketch,a.selection,p.editCommand);
  assert.deepEqual(runtimeReplay,p.acceptance);
  const reopened=parseSketch(serializeSketch(p.acceptance.sketch));
  const after=inspectClosedContourEdges(reopened,p.acceptance.selection,'panel');
  assert.equal(after.kind,'contour_edges');
  assert.deepEqual(after.edges.map(x=>x.edgeId),inspect(a).edges.map(x=>x.edgeId));
});

test('offsetting an edge incident to the fixed datum does not translate other vertices',()=>{
  const a=make();
  const p=offset(a,'panel:edge:0',10);accept(p);
  assert.equal(p.editCommand.changes.length,4,
    'moving the datum must supply explicit stationary-vertex dimensions');
  assert.deepEqual(pointPositions(p.acceptance),[
    {x:0,y:-10},{x:120,y:-10},{x:120,y:80},{x:0,y:80}]);
  assert.equal(p.acceptance.profile.profile.areaMm2,10800);
  const opposite=offset(a,'panel:edge:3',5);accept(opposite);
  assert.deepEqual(pointPositions(opposite.acceptance),[
    {x:-5,y:0},{x:120,y:0},{x:120,y:80},{x:-5,y:80}]);
});

test('clockwise contours use the physical outward normal rather than screen-space sidedness',()=>{
  const a=make([{x:0,y:0},{x:0,y:80},{x:120,y:80},{x:120,y:0}]);
  const v=inspect(a);
  assert.equal(v.kind,'contour_edges');
  assert.deepEqual(v.edges[0].normal,{x:-1,y:0});
  const p=offset(a,'panel:edge:0',10);accept(p);
  assert.deepEqual(pointPositions(p.acceptance),[
    {x:-10,y:0},{x:-10,y:80},{x:120,y:80},{x:120,y:0}]);
  assert.equal(p.acceptance.profile.profile.areaMm2,10400);
});

test('pointer drag is normal-projected with reported tangential error',()=>{
  const a=make();
  const p=dragClosedContourEdge(a.sketch,a.selection,{
    version:1,sourceSignature:a.nextSourceSignature,
    contourId:'panel',edgeId:'panel:edge:1',
    start:{x:120,y:40},target:{x:140,y:45}});
  accept(p);
  assert.equal(p.offsetMm,20);
  assert.equal(p.gesture.tangentialDeviationMm,5);
  assert.deepEqual(p.gesture.projected,{x:140,y:40});
  assert.deepEqual(p.gesture.applied,{x:140,y:40});
  assert.equal(p.gesture.appliedDeviationMm,5);
});

test('real pointer-selected edge moves by displacement without off-edge grab jump',()=>{
  const a=make(),stamp=a.nextSourceSignature;
  const picked=pickContourEdgeAtPointer(a.sketch,{
    kind:'pick-contour-edge-at-pointer',version:1,sourceSignature:stamp,
    point:{x:123,y:45},maxDistanceMm:5});
  assert.equal(picked.kind,'selected_edge',JSON.stringify(picked));
  assert.equal(picked.edgeId,'panel:edge:1');
  const moved=dragClosedContourEdge(a.sketch,picked.selection,{
    version:1,sourceSignature:stamp,contourId:'panel',edgeId:picked.edgeId,
    start:{x:123,y:45},target:{x:143,y:55}});
  accept(moved);
  assert.equal(moved.offsetMm,20,'20 mm displacement, not 23 mm from edge centre');
  assert.deepEqual(moved.gesture.start,{x:123,y:45});
  assert.deepEqual(moved.gesture.projected,{x:143,y:45});
  assert.deepEqual(moved.gesture.applied,{x:143,y:45});
  assert.equal(moved.gesture.tangentialDeviationMm,10);
  assert.equal(moved.gesture.appliedDeviationMm,10);
  assert.deepEqual(pointPositions(moved.acceptance),[
    {x:0,y:0},{x:140,y:0},{x:140,y:80},{x:0,y:80}]);
  assert.deepEqual(editClosedContourVertices(a.sketch,picked.selection,
    moved.editCommand),moved.acceptance,'RUNTIME replay admission stays unchanged');
  assert.equal(serializeSketch(a.sketch),stamp);
});

test('oblique edge drag preserves true normal distance and associative hole replay',()=>{
  // A sloped mounting flange must move as a rigid semantic edge; the edit is
  // not two unrelated freehand vertex drags or an axis-aligned approximation.
  const a=make([{x:0,y:0},{x:100,y:0},{x:120,y:60},{x:0,y:80}]);
  const bore=editSelectedProfileHole(a.sketch,a.selection,{
    kind:'add-hole',sourceSignature:a.nextSourceSignature,
    holeId:'flange-bolt',anchorPointId:'panel:vertex:2',
    xMm:105,yMm:40,radiusMm:4
  });
  assert.equal(bore.kind,'accepted',JSON.stringify(bore));
  const view=inspect(bore);
  assert.equal(view.kind,'contour_edges');
  const edge=view.edges[1],normal=edge.normal;
  assert.ok(normal.x>0&&normal.y<0,'outward direction is oblique');
  const start={x:edge.midpoint.x+normal.x*2,
    y:edge.midpoint.y+normal.y*2};
  const target={x:start.x+normal.x*10+normal.y*3,
    y:start.y+normal.y*10-normal.x*3};
  const result=dragClosedContourEdge(bore.sketch,bore.selection,{
    version:1,sourceSignature:bore.nextSourceSignature,
    contourId:'panel',edgeId:edge.edgeId,start,target
  });
  accept(result);
  const close=(a,b)=>Math.abs(a-b)<1e-9;
  assert.ok(close(result.offsetMm,10),'normal displacement exactly projected');
  assert.ok(close(result.appliedOffsetMm,10));
  assert.ok(close(result.gesture.tangentialDeviationMm,3));
  const sourcePoints=pointPositions(bore),nextPoints=pointPositions(result.acceptance);
  for(const index of [0,3])
    assert.deepEqual(nextPoints[index],sourcePoints[index],
      'unselected flange corners remain unchanged');
  for(const index of [1,2]){
    assert.ok(close(nextPoints[index].x-sourcePoints[index].x,10*normal.x));
    assert.ok(close(nextPoints[index].y-sourcePoints[index].y,10*normal.y));
  }
  assert.deepEqual(result.acceptance.movedDependentHoles.map(h=>h.holeId),
    ['flange-bolt']);
  const hole=result.acceptance.movedDependentHoles[0];
  assert.ok(close(hole.to.x-hole.from.x,10*normal.x));
  assert.ok(close(hole.to.y-hole.from.y,10*normal.y));
  assert.deepEqual(editClosedContourVertices(bore.sketch,bore.selection,
    result.editCommand),result.acceptance,'RUNTIME structural replay remains exact');
  const restored=inspectClosedContourEdges(
    parseSketch(serializeSketch(result.acceptance.sketch)),
    result.acceptance.selection,'panel');
  assert.equal(restored.kind,'contour_edges');
  assert.equal(restored.edges[1].edgeId,edge.edgeId);
});

test('associated hole follows selected edge endpoint and preserves its dimensions',()=>{
  const a=make();
  const bored=editSelectedProfileHole(a.sketch,a.selection,{
    kind:'add-hole',sourceSignature:a.nextSourceSignature,
    holeId:'bolt',anchorPointId:'panel:vertex:2',xMm:105,yMm:25,
    radiusMm:5});
  assert.equal(bored.kind,'accepted',JSON.stringify(bored));
  const p=offset(bored,'panel:edge:1',20);accept(p);
  assert.deepEqual(p.acceptance.movedDependentHoles.map(h=>h.holeId),['bolt']);
  assert.deepEqual(p.acceptance.movedDependentHoles[0].to,{x:125,y:25});
  assert.deepEqual(p.acceptance.profile.holeIds,['bolt']);
  assert.equal(solveSketch(p.acceptance.sketch).status,'solved');
  const collision=offset(bored,'panel:edge:1',-110);
  assert.equal(collision.kind,'refused',JSON.stringify(collision));
  assert.equal(serializeSketch(bored.sketch),bored.nextSourceSignature);
});

test('separate material contours remain protected against an edge-offset collision',()=>{
  const a=make();
  const other=make([{x:150,y:0},{x:190,y:0},{x:190,y:30},{x:150,y:30}],
    'island',a.sketch);
  const selection={candidateId:a.selection.candidateId,
    sourceSignature:other.nextSourceSignature};
  const otherSource={...other,selection};
  const attempt=offset(otherSource,'panel:edge:1',40);
  assert.equal(attempt.kind,'refused',JSON.stringify(attempt));
  assert.equal(serializeSketch(other.sketch),other.nextSourceSignature);
});

test('stale, forged, invalid, degenerate, and unsolved offsets refuse without mutation',()=>{
  const a=make(),before=serializeSketch(a.sketch);
  const stale=planClosedContourEdgeOffset(a.sketch,a.selection,{
    kind:'offset-closed-contour-edge',version:1,sourceSignature:'wrong',
    contourId:'panel',edgeId:'panel:edge:1',offsetMm:20});
  assert.equal(stale.kind,'refused');
  assert.equal(stale.reason,'stale_source');
  assert.equal(offset(a,'other:edge:1',10).reason,'edge_not_in_selected_contour');
  assert.equal(offset(a,'panel:edge:1',0).reason,'no_change');
  assert.equal(offset(a,'panel:edge:1',Infinity).reason,'invalid_offset_command');
  const collapsed=offset(a,'panel:edge:1',-120);
  assert.equal(collapsed.kind,'refused');
  const fake=planClosedContourEdgeOffset(a.sketch,a.selection,{
    kind:'offset-closed-contour-edge',version:1,sourceSignature:before,
    contourId:'panel',edgeId:'panel:edge:1',offsetMm:20,
    forged:true});
  assert.equal(fake.reason,'invalid_offset_command');
  const badDrag=dragClosedContourEdge(a.sketch,a.selection,{
    version:1,sourceSignature:before,contourId:'panel',
    edgeId:'panel:edge:1',start:{x:120,y:20},target:{x:NaN,y:20}});
  assert.equal(badDrag.reason,'invalid_edge_gesture');
  const badStart=dragClosedContourEdge(a.sketch,a.selection,{
    version:1,sourceSignature:before,contourId:'panel',
    edgeId:'panel:edge:1',start:{x:NaN,y:20},target:{x:140,y:20}});
  assert.equal(badStart.reason,'invalid_edge_gesture');
  const missingStart=dragClosedContourEdge(a.sketch,a.selection,{
    version:1,sourceSignature:before,contourId:'panel',
    edgeId:'panel:edge:1',target:{x:140,y:20}});
  assert.equal(missingStart.reason,'invalid_edge_gesture');
  const unsolved=blank();
  unsolved.points.push({id:'loose',x:4,y:9});
  const failed=inspectClosedContourEdges(createSketch(unsolved),a.selection,'panel');
  assert.equal(failed.kind,'refused');
  assert.equal(failed.reason,'source_not_fully_solved');
  assert.equal(serializeSketch(a.sketch),before);
});

test('public mechanical edge-offset example executes source and replay checks',async()=>{
  await import('../examples/contour-edge-offset.mjs');
});
