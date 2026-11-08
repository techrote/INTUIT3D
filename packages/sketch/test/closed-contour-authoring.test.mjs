import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,serializeSketch,parseSketch,solveSketch,editConstraint}
  from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {selectContourAtPointer} from '../pointer-contour-selection.mjs';
import {createClosedContour,inspectClosedContour,editClosedContourVertices,
  dragClosedContourVertex,CLOSED_CONTOUR_AUTHORING_VERSION,
  MAX_CLOSED_CONTOUR_VERTICES} from '../closed-contour-authoring.mjs';

const blank=()=>createSketch({version:1,units:'mm',points:[],lines:[],
  circles:[],constraints:[]});
const shape=[{x:0,y:0},{x:60,y:0},{x:60,y:40},{x:0,y:40}];
const stamp=doc=>serializeSketch(doc);
const create=(doc=blank(),over={})=>createClosedContour(doc,{
  kind:'create-closed-contour',version:1,sourceSignature:stamp(doc),
  contourId:'custom',vertices:shape,...over});
const edit=(accepted,changes)=>editClosedContourVertices(
  accepted.sketch,accepted.selection,{
    kind:'edit-closed-contour-vertices',version:1,
    sourceSignature:accepted.nextSourceSignature,contourId:'custom',changes});
const drag=(accepted,index,target)=>dragClosedContourVertex(
  accepted.sketch,accepted.selection,{
    version:1,sourceSignature:accepted.nextSourceSignature,contourId:'custom',
    handleId:'custom:handle:'+index,target});
const ok=(value)=>assert.equal(value.kind,'accepted',JSON.stringify(value));

test('pointer-authored four-edge contour has real fully constrained dimensions and stable semantic IDs',()=>{
  assert.equal(CLOSED_CONTOUR_AUTHORING_VERSION,1);
  assert.equal(MAX_CLOSED_CONTOUR_VERTICES,12);
  const base=blank(),result=create(base);ok(result);
  assert.equal(solveSketch(result.sketch).status,'solved');
  assert.equal(solveSketch(result.sketch).degreesOfFreedom,0);
  assert.equal(result.profile.profile.areaMm2,2400);
  assert.deepEqual(result.profile.holeIds,[]);
  assert.deepEqual(result.handles.map(h=>h.handleId),
    ['custom:handle:0','custom:handle:1','custom:handle:2','custom:handle:3']);
  assert.equal(result.sketch.constraints.filter(c=>c.kind==='fixed').length,1);
  assert.equal(result.sketch.constraints.filter(c=>c.kind==='distanceX').length,3);
  assert.equal(result.sketch.constraints.filter(c=>c.kind==='distanceY').length,3);
  assert.deepEqual(result.profile.boundary.map(e=>e.edgeId),
    ['custom:edge:0','custom:edge:1','custom:edge:2','custom:edge:3']);
  assert.equal(stamp(base),stamp(blank()),'input immutable');
  const archived=parseSketch(stamp(result.sketch));
  const inspected=inspectClosedContour(archived,result.selection,'custom');
  assert.equal(inspected.kind,'closed_contour',JSON.stringify(inspected));
  assert.deepEqual(inspected.vertices,shape);
  const selected=selectContourAtPointer(archived,{
    kind:'select-contour-at-pointer',version:1,
    sourceSignature:stamp(archived),point:{x:25,y:20},boundaryClearanceMm:0});
  assert.equal(selected.kind,'selected',JSON.stringify(selected));
  assert.equal(selected.selection.candidateId,result.selection.candidateId);
});

test('vertex drag, dimension batch and replay are atomic and preserve original IDs',()=>{
  const source=create();ok(source);
  const moved=drag(source,2,{x:75,y:45});ok(moved);
  assert.equal(moved.gesture.handleId,'custom:handle:2');
  assert.deepEqual(moved.gesture.applied,{x:75,y:45});
  assert.equal(moved.gesture.deviationMm,0);
  const changed=edit(moved,[{index:1,xMm:70,yMm:0},
    {index:3,xMm:0,yMm:45}]);ok(changed);
  assert.equal(changed.changedConstraintIds.length,4);
  assert.deepEqual(changed.sketch.lines.map(e=>e.id),
    source.sketch.lines.map(e=>e.id));
  assert.equal(solveSketch(changed.sketch).status,'solved');
  const restored=parseSketch(stamp(changed.sketch));
  const reopened=inspectClosedContour(restored,changed.selection,'custom');
  assert.equal(reopened.kind,'closed_contour');
  assert.deepEqual(reopened.handles.map(h=>h.handleId),
    source.handles.map(h=>h.handleId));
  assert.equal(reopened.dimensions[1].offsetXmm,75);
});

test('dragging the datum translates the contour while retaining signed coordinate dimensions',()=>{
  const created=create();ok(created);
  const translated=drag(created,0,{x:120,y:80});ok(translated);
  assert.deepEqual(translated.handles.map(h=>h.position),shape.map(p=>({
    x:p.x+120,y:p.y+80})));
  assert.equal(translated.profile.profile.areaMm2,2400);
  const undone=edit(translated,[{index:0,xMm:0,yMm:0}]);ok(undone);
  assert.deepEqual(undone.handles.map(h=>h.position),shape);
});

test('new independent user contour coexists with genuine L profile, holes, and overlapping AABBs',()=>{
  const source=createDimensionedLPlateSketch();
  const original=stamp(source);
  const created=create(source,{vertices:[
    {x:70,y:40},{x:90,y:40},{x:90,y:60},{x:70,y:60}
  ]});ok(created);
  assert.equal(created.profile.profile.areaMm2,400);
  assert.deepEqual(created.profile.holeIds,[]);
  assert.equal(created.sketch.circles.length,source.circles.length);
  const oldProfile=selectContourAtPointer(created.sketch,{
    kind:'select-contour-at-pointer',version:1,
    sourceSignature:created.nextSourceSignature,
    point:{x:10,y:40},boundaryClearanceMm:0});
  assert.equal(oldProfile.kind,'selected',JSON.stringify(oldProfile));
  assert.deepEqual([...oldProfile.profile.holeIds].sort(),
    ['L:holeLower','L:holeUpper']);
  assert.equal(stamp(source),original);
  const crossing=edit(created,[{index:0,xMm:25,yMm:35}]);
  assert.equal(crossing.kind,'refused',JSON.stringify(crossing));
  assert.equal(stamp(created.sketch),created.nextSourceSignature);
});

test('valid pre-existing circular hole is associated with newly drawn closed contour',()=>{
  const s=blank();
  s.points.push({id:'h:center',x:30,y:20});
  s.circles.push({id:'h:circle',center:'h:center',radius:4});
  s.constraints.push({id:'h:position',kind:'fixed',point:'h:center',x:30,y:20});
  s.constraints.push({id:'h:radius',kind:'radius',circle:'h:circle',value:4});
  const created=create(createSketch(s));ok(created);
  assert.deepEqual(created.profile.holeIds,['h:circle']);
  const changed=drag(created,2,{x:80,y:50});ok(changed);
  assert.deepEqual(changed.profile.holeIds,['h:circle']);
  assert.equal(changed.sketch.circles[0].id,'h:circle');
});

test('self-intersection, collinearity and hole crossing are rejected without changing source',()=>{
  const b=blank(),signature=stamp(b);
  const bowtie=create(b,{vertices:[
    {x:0,y:0},{x:40,y:40},{x:0,y:40},{x:40,y:0}]});
  assert.equal(bowtie.kind,'refused');
  const line=create(b,{vertices:[
    {x:0,y:0},{x:20,y:0},{x:40,y:0}]});
  assert.equal(line.kind,'refused');
  assert.equal(stamp(b),signature);
  const s=blank();
  s.points.push({id:'h:center',x:30,y:20});
  s.circles.push({id:'h:circle',center:'h:center',radius:4});
  s.constraints.push({id:'h:position',kind:'fixed',point:'h:center',x:30,y:20});
  s.constraints.push({id:'h:radius',kind:'radius',circle:'h:circle',value:4});
  const created=create(createSketch(s));ok(created);
  const crossed=drag(created,2,{x:27,y:19});
  assert.equal(crossed.kind,'refused');
});

test('underconstrained and conflicting sketches refuse explicit diagnostics',()=>{
  const u=blank();u.points.push({id:'unbound',x:7,y:9});
  const under=create(createSketch(u));
  assert.equal(under.kind,'refused');
  assert.equal(under.reason,'source_not_fully_solved');
  assert.equal(under.sourceStatus,'underconstrained');
  const c=blank();c.points.push({id:'datum',x:0,y:0});
  c.constraints.push({id:'fixA',kind:'fixed',point:'datum',x:0,y:0});
  c.constraints.push({id:'fixB',kind:'fixed',point:'datum',x:1,y:0});
  const conflicting=create(createSketch(c));
  assert.equal(conflicting.kind,'refused');
  assert.equal(conflicting.sourceStatus,'conflicted');
  assert.ok(conflicting.diagnostics.length>0);
});

test('stale commands, invalid handles, duplicate semantic IDs and unsafe edits refuse atomically',()=>{
  const source=create();ok(source);
  const stale=create(source.sketch,{sourceSignature:'obsolete'});
  assert.equal(stale.reason,'stale_source');
  const duplicate=create(source.sketch);
  assert.equal(duplicate.reason,'semantic_id_collision');
  const staleDrag=dragClosedContourVertex(source.sketch,source.selection,{
    version:1,sourceSignature:'obsolete',contourId:'custom',
    handleId:'custom:handle:1',target:{x:40,y:0}});
  assert.equal(staleDrag.reason,'stale_source');
  const unknown=drag(source,9,{x:40,y:0});
  assert.equal(unknown.reason,'handle_not_in_selected_contour');
  const invalid=edit(source,[{index:1,xMm:0,yMm:0}]);
  assert.equal(invalid.kind,'refused');
  assert.equal(stamp(source.sketch),source.nextSourceSignature);
  assert.equal(inspectClosedContour(source.sketch,{
    ...source.selection,sourceSignature:'obsolete'},'custom').reason,'stale_source');
});

test('retrospective authored dimensions remain explicit and revision-replayable',()=>{
  const source=create();ok(source);
  const updated=editConstraint(source.sketch,'custom:offsetX:2',{value:95});
  assert.equal(solveSketch(updated).status,'solved');
  const selection={candidateId:source.selection.candidateId,
    sourceSignature:stamp(updated)};
  const inspection=inspectClosedContour(updated,selection,'custom');
  assert.equal(inspection.kind,'closed_contour',JSON.stringify(inspection));
  assert.equal(inspection.vertices[2].x,95);
  assert.equal(inspection.handles[2].handleId,'custom:handle:2');
});
