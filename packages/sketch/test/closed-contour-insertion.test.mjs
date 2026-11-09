import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,serializeSketch,parseSketch,solveSketch} from '../index.mjs';
import {createClosedContour,editClosedContourVertices}
  from '../closed-contour-authoring.mjs';
import {editSelectedProfileHole} from '../selected-profile-hole-authoring.mjs';
import {insertClosedContourTab,inspectTabbedClosedContour,
  editTabbedContourVertex,CLOSED_CONTOUR_INSERTION_VERSION}
  from '../closed-contour-insertion.mjs';
const blank=()=>createSketch({version:1,units:'mm',points:[],lines:[],
  circles:[],constraints:[]});
const stamp=serializeSketch;
const created=()=>{
  const doc=blank(),c=createClosedContour(doc,{
    kind:'create-closed-contour',version:1,sourceSignature:stamp(doc),
    contourId:'panel',vertices:[
      {x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}
    ]});
  assert.equal(c.kind,'accepted',JSON.stringify(c));return c;
};
const tab=(a,over={})=>insertClosedContourTab(a.sketch,a.selection,{
  kind:'insert-closed-contour-tab',version:1,
  sourceSignature:stamp(a.sketch),contourId:'panel',
  edgeId:'panel:edge:1',tabId:'panelTab',
  vertices:[{x:140,y:20},{x:140,y:60}],...over
});
const edit=(a,handleId,target)=>editTabbedContourVertex(a.sketch,a.selection,{
  kind:'edit-tabbed-contour-vertex',version:1,sourceSignature:stamp(a.sketch),
  contourId:'panel',tabId:'panelTab',handleId,target
});
const ok=a=>assert.equal(a.kind,'accepted',JSON.stringify(a));

test('selected right-edge replacement keeps original vertex semantics; retires edge rather than rebinding it',()=>{
  assert.equal(CLOSED_CONTOUR_INSERTION_VERSION,1);
  const a=created(),source=stamp(a.sketch),inserted=tab(a);ok(inserted);
  assert.equal(stamp(a.sketch),source);
  assert.equal(solveSketch(inserted.sketch).status,'solved');
  assert.equal(solveSketch(inserted.sketch).degreesOfFreedom,0);
  assert.deepEqual(inserted.retiredEntityIds,['panel:edge:1']);
  assert.deepEqual(inserted.preservedPointIds,[
    'panel:vertex:0','panel:vertex:1','panel:vertex:2','panel:vertex:3']);
  assert.deepEqual(inserted.sketch.lines.map(l=>l.id),[
    'panel:edge:0','panelTab:edge:0','panelTab:edge:1',
    'panelTab:edge:2','panel:edge:2','panel:edge:3']);
  assert.equal(inserted.sketch.lines.some(l=>l.id==='panel:edge:1'),false);
  assert.equal(inserted.profile.profile.areaMm2,10800);
  const inspected=inspectTabbedClosedContour(
    parseSketch(stamp(inserted.sketch)),inserted.selection,'panel','panelTab');
  assert.equal(inspected.kind,'tabbed_closed_contour',JSON.stringify(inspected));
  assert.deepEqual(inspected.handles.map(h=>h.handleId),[
    'panel:handle:0','panel:handle:1','panelTab:handle:0',
    'panelTab:handle:1','panel:handle:2','panel:handle:3']);
  assert.equal(inspected.retiredEdgeId,'panel:edge:1');
  assert.equal(inspected.degreesOfFreedom,0);
  const replay=tab(a);
  assert.deepEqual(replay,inserted,'SKETCH operation replays from immutable source');
});

test('retrospective inserted-vertex and original-vertex changes survive archive replay and retain hole references',()=>{
  const base=created(),bored=editSelectedProfileHole(base.sketch,base.selection,{
    kind:'add-hole',sourceSignature:stamp(base.sketch),
    holeId:'panel:hole',anchorPointId:'panel:vertex:2',
    xMm:85,yMm:45,radiusMm:5
  });ok(bored);
  const inserted=tab(bored);ok(inserted);
  assert.deepEqual(inserted.profile.holeIds,['panel:hole']);
  const shape=edit(inserted,'panelTab:handle:0',{x:145,y:20});ok(shape);
  assert.equal(shape.changedConstraintIds.includes('panelTab:offsetX:0'),true);
  assert.equal(shape.movedDependentHoles.length,0);
  assert.equal(shape.profile.holeIds[0],'panel:hole');
  const moved=edit(shape,'panel:handle:2',{x:125,y:85});ok(moved);
  assert.equal(moved.movedDependentHoles.length,1);
  assert.equal(moved.movedDependentHoles[0].holeId,'panel:hole');
  assert.deepEqual(moved.movedDependentHoles[0].to,{x:90,y:50});
  assert.equal(solveSketch(moved.sketch).status,'solved');
  const reopened=parseSketch(stamp(moved.sketch));
  const inspected=inspectTabbedClosedContour(reopened,moved.selection,
    'panel','panelTab');
  assert.equal(inspected.kind,'tabbed_closed_contour',JSON.stringify(inspected));
  assert.equal(inspected.handles.find(h=>h.handleId==='panelTab:handle:0').position.x,145);
  assert.deepEqual(inspected.handles.find(h=>h.handleId==='panel:handle:2').position,
    {x:125,y:85});
  assert.deepEqual(edit(shape,'panel:handle:2',{x:125,y:85}),moved,
    'edited dimensions replay exactly');
});

test('stale signatures, existing edge constraints, collisions and unadmitted source refuse without mutation',()=>{
  const a=created(),source=stamp(a.sketch);
  assert.equal(tab(a,{sourceSignature:'obsolete'}).reason,'stale_source');
  assert.equal(tab(a,{edgeId:'unselected'}).reason,'edge_not_in_selected_contour');
  assert.equal(tab(a,{tabId:'panel'}).reason,'invalid_insert_command');
  const reversed=tab(a,{vertices:[{x:140,y:70},{x:140,y:10}]});
  assert.equal(reversed.kind,'refused',JSON.stringify(reversed));
  const constrained=structuredClone(a.sketch);
  constrained.constraints.push({id:'panel:edge:1:vertical',
    kind:'vertical',line:'panel:edge:1'});
  const signed=stamp(createSketch(constrained));
  const reject=insertClosedContourTab(createSketch(constrained),
    {candidateId:a.selection.candidateId,sourceSignature:signed},{
      kind:'insert-closed-contour-tab',version:1,
      sourceSignature:signed,contourId:'panel',edgeId:'panel:edge:1',
      tabId:'panelTab',vertices:[{x:140,y:20},{x:140,y:60}]
    });
  assert.equal(reject.reason,'selected_edge_has_external_constraints');
  const updated=editClosedContourVertices(a.sketch,a.selection,{
    kind:'edit-closed-contour-vertices',version:1,
    sourceSignature:source,contourId:'panel',
    changes:[{index:2,xMm:125,yMm:80}]});ok(updated);
  const stale=insertClosedContourTab(updated.sketch,updated.selection,{
    kind:'insert-closed-contour-tab',version:1,
    sourceSignature:source,contourId:'panel',
    edgeId:'panel:edge:1',tabId:'panelTab',
    vertices:[{x:140,y:20},{x:140,y:60}]
  });
  assert.equal(stale.reason,'stale_source');
  assert.equal(stamp(a.sketch),source);
  const u=blank();
  u.points.push({id:'undimensioned',x:5,y:7});
  const under=createSketch(u);
  assert.equal(insertClosedContourTab(under,a.selection,{
    kind:'insert-closed-contour-tab',version:1,
    sourceSignature:stamp(under),contourId:'panel',
    edgeId:'panel:edge:1',tabId:'panelTab',
    vertices:[{x:140,y:20},{x:140,y:60}]
  }).sourceStatus,'underconstrained');
});

test('existing tab edit refuses stale handle, invalid target, missing datum and self-intersecting successor',()=>{
  const inserted=tab(created());ok(inserted);
  const original=stamp(inserted.sketch);
  const stale=editTabbedContourVertex(inserted.sketch,inserted.selection,{
    kind:'edit-tabbed-contour-vertex',version:1,
    sourceSignature:'obsolete',contourId:'panel',tabId:'panelTab',
    handleId:'panelTab:handle:0',target:{x:145,y:20}});
  assert.equal(stale.reason,'stale_source');
  assert.equal(edit(inserted,'missing',{x:145,y:20}).reason,
    'handle_not_in_selected_contour');
  assert.equal(edit(inserted,'panel:handle:0',{x:5,y:5}).reason,
    'datum_translation_requires_batch_edit');
  assert.equal(edit(inserted,'panelTab:handle:0',{x:Infinity,y:20}).reason,
    'invalid_edit_command');
  assert.equal(edit(inserted,'panelTab:handle:0',{x:140,y:20}).reason,'no_change');
  const invalid=edit(inserted,'panelTab:handle:0',{x:-20,y:60});
  assert.equal(invalid.kind,'refused',JSON.stringify(invalid));
  assert.equal(stamp(inserted.sketch),original);
});


test('tab insertion and later dimension edits refuse other contour crossings, contacts and nesting',()=>{
  const base=created();
  const withPeer=vertices=>{
    const added=createClosedContour(base.sketch,{
      kind:'create-closed-contour',version:1,
      sourceSignature:stamp(base.sketch),contourId:'neighbor',vertices
    });ok(added);
    return {sketch:added.sketch,selection:{
      candidateId:base.selection.candidateId,
      sourceSignature:stamp(added.sketch)
    }};
  };
  const rectangle=(left,right,bottom,top)=>[
    {x:left,y:bottom},{x:right,y:bottom},
    {x:right,y:top},{x:left,y:top}
  ];
  // Both independently solved cycles remain simple and their hole sets
  // unchanged. The SKETCH transaction must still reject intersecting regions.
  const crossing=withPeer(rectangle(150,210,0,80));
  const signature=stamp(crossing.sketch);
  const crossed=tab(crossing,{vertices:[{x:160,y:20},{x:160,y:60}]});
  assert.equal(crossed.reason,'contour_conflicts_with_other_profile',
    JSON.stringify(crossed));
  assert.match(crossed.detail,/boundary_contact/);
  assert.equal(stamp(crossing.sketch),signature,'refusal must be atomic');

  const nested=withPeer(rectangle(130,170,25,55));
  const surrounded=tab(nested,{vertices:[{x:180,y:20},{x:180,y:60}]});
  assert.equal(surrounded.reason,'contour_conflicts_with_other_profile',
    JSON.stringify(surrounded));
  assert.match(surrounded.detail,/nested_contour/);
  const touching=withPeer(rectangle(150,210,30,70));
  const contacted=tab(touching,{vertices:[{x:150,y:20},{x:150,y:60}]});
  assert.equal(contacted.reason,'contour_conflicts_with_other_profile',
    JSON.stringify(contacted));

  const disjoint=withPeer(rectangle(200,250,0,80));
  const inserted=tab(disjoint);ok(inserted);
  const beforeEdit=stamp(inserted.sketch);
  const editing=edit(inserted,'panelTab:handle:0',{x:210,y:20});
  assert.equal(editing.reason,'contour_conflicts_with_other_profile',
    JSON.stringify(editing));
  assert.equal(stamp(inserted.sketch),beforeEdit);
  // A genuine edit away from the other contour remains valid.
  const safe=edit(inserted,'panelTab:handle:0',{x:145,y:20});
  ok(safe);
});

test('runnable consumer example replays a SKETCH-only tab, not a native STEP result',async()=>{
  await import('../examples/closed-contour-insertion.mjs');
});
