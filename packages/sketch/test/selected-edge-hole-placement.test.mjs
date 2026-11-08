import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {inspectSelectedEdgeHolePlacement,setSelectedEdgeHoles,
  SELECTED_EDGE_HOLE_PLACEMENT_VERSION}
  from '../selected-edge-hole-placement.mjs';

const baseline=()=>{
  const sketch=createDimensionedLPlateSketch();
  const discovery=discoverPlateProfiles(sketch);
  return {sketch,selection:{candidateId:discovery.candidates[0].id,
    sourceSignature:serializeSketch(sketch)}};
};
const inspect=(sketch,selection)=>{
  const r=inspectSelectedEdgeHolePlacement(sketch,selection);
  assert.equal(r.kind,'selected_edge_hole_placement',r.reason);
  return r;
};
const set=(sketch,selection,edits)=>{
  const r=setSelectedEdgeHoles(sketch,selection,{
    kind:'set-edge-holes',sourceSignature:serializeSketch(sketch),edits});
  assert.equal(r.kind,'accepted',r.reason+': '+r.detail);
  return r;
};
const ids=doc=>[...doc.points,...doc.lines,...doc.circles,
  ...doc.constraints].map(x=>x.id);
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-8,`${x} != ${y}`);

test('inspector reads authored constraint references and inward edge-local coordinates',()=>{
  const {sketch,selection}=baseline();
  const view=inspect(sketch,selection);
  assert.equal(SELECTED_EDGE_HOLE_PLACEMENT_VERSION,1);
  assert.equal(view.edges.length,6);
  const lower=view.holes.find(h=>h.holeId==='L:holeLower');
  const upper=view.holes.find(h=>h.holeId==='L:holeUpper');
  const bottom=view.edges.find(e=>e.edgeId==='L:edge0');
  assert.equal(bottom.axis,'horizontal');
  assert.equal(bottom.editable,true);
  assert.deepEqual(bottom.tangent,{x:1,y:0});
  assert.deepEqual(bottom.inward,{x:0,y:1});
  assert.deepEqual(lower.edgeBinding,{
    edgeId:'L:edge1',anchorPointId:'L:b',alongMm:15,insetMm:30
  });
  assert.deepEqual(upper.edgeBinding,{
    edgeId:'L:edge4',anchorPointId:'L:e',alongMm:20,insetMm:20
  });
  assert.equal(view.nativeExact,false);
});

test('atomic reassignment and addition preserves semantic entities and survives width replay',()=>{
  const {sketch,selection}=baseline(),source=serializeSketch(sketch);
  const edited=set(sketch,selection,[
    {holeId:'L:holeLower',edgeId:'L:edge0',
      alongMm:90,insetMm:15,radiusMm:5},
    {holeId:'mount:a',edgeId:'L:edge0',
      alongMm:55,insetMm:15,radiusMm:4},
    {holeId:'mount:b',edgeId:'L:edge0',
      alongMm:70,insetMm:15,radiusMm:4}
  ]);
  assert.equal(serializeSketch(sketch),source);
  assert.deepEqual(edited.createdHoleIds,['mount:a','mount:b']);
  assert.deepEqual(edited.reanchoredHoleIds,['L:holeLower']);
  assert.deepEqual(edited.changedConstraintIds,[
    'L:holeLowerOffsetX','L:holeLowerOffsetY',
    'mount:a:edgeX','mount:a:edgeY','mount:a:radius',
    'mount:b:edgeX','mount:b:edgeY','mount:b:radius'
  ]);
  assert.deepEqual(ids(edited.sketch).slice(0,ids(sketch).length),
    // Existing IDs within each entity group stay stable even though new
    // entities are appended to the corresponding groups.
    [...sketch.points.map(x=>x.id),
      'mount:a:center','mount:b:center',...sketch.lines.map(x=>x.id),
      ...sketch.circles.map(x=>x.id),'mount:a','mount:b',
      ...sketch.constraints.map(x=>x.id)].slice(0,ids(sketch).length));
  assert.deepEqual(edited.profile.holeIds.sort(),[
    'L:holeLower','L:holeUpper','mount:a','mount:b']);
  const reopened=parseSketch(serializeSketch(edited.sketch));
  const view=inspect(reopened,edited.selection);
  assert.deepEqual(view.holes.find(h=>h.holeId==='mount:a').edgeBinding,{
    edgeId:'L:edge0',anchorPointId:'L:a',alongMm:55,insetMm:15
  });
  const widened=editConstraint(reopened,'L:length',{value:150});
  const replay=inspect(parseSketch(serializeSketch(widened)),{
    candidateId:selection.candidateId,
    sourceSignature:serializeSketch(widened)
  });
  const at=id=>replay.holes.find(h=>h.holeId===id).position;
  assert.deepEqual(at('mount:a'),{x:55,y:15});
  assert.deepEqual(at('mount:b'),{x:70,y:15});
  assert.deepEqual(at('L:holeLower'),{x:90,y:15});
  assert.equal(solveSketch(widened).status,'solved');
  assert.deepEqual(parseSketch(source),sketch);
  assert.equal(edited.independentStepQualified,false);
});

test('simultaneous edge-based target swaps are checked only in final profile',()=>{
  const {sketch,selection}=baseline();
  const swapped=set(sketch,selection,[
    {holeId:'L:holeLower',edgeId:'L:edge4',
      alongMm:20,insetMm:20,radiusMm:5},
    {holeId:'L:holeUpper',edgeId:'L:edge0',
      alongMm:90,insetMm:15,radiusMm:5}
  ]);
  assert.deepEqual(swapped.reanchoredHoleIds,['L:holeLower','L:holeUpper']);
  const view=inspect(swapped.sketch,swapped.selection);
  assert.deepEqual(view.holes.find(h=>h.holeId==='L:holeLower').position,
    {x:20,y:60});
  assert.deepEqual(view.holes.find(h=>h.holeId==='L:holeUpper').position,
    {x:90,y:15});
  assert.deepEqual(ids(swapped.sketch),ids(sketch));
  assert.equal(swapped.semanticProfileId,selection.candidateId);
});

test('unselected separate contour remains intact after explicit L-contour editing',()=>{
  const {sketch}=baseline();
  const detached=createSketch({...sketch,
    points:[...sketch.points,
      {id:'B:a',x:220,y:100},{id:'B:b',x:250,y:100},
      {id:'B:c',x:250,y:130},{id:'B:d',x:220,y:130}],
    lines:[...sketch.lines,
      {id:'B:0',start:'B:a',end:'B:b'},
      {id:'B:1',start:'B:b',end:'B:c'},
      {id:'B:2',start:'B:c',end:'B:d'},
      {id:'B:3',start:'B:d',end:'B:a'}],
    constraints:[...sketch.constraints,
      ...[['B:a',220,100],['B:b',250,100],
        ['B:c',250,130],['B:d',220,130]].map(([point,x,y])=>({
        id:'B:fix:'+point,kind:'fixed',point,x,y
      }))]});
  const discovered=discoverPlateProfiles(detached);
  assert.equal(discovered.status,'ambiguous');
  assert.equal(discovered.candidates.length,2);
  const selection={candidateId:discovered.candidates.find(c=>
    c.id.includes('L:edge0')).id,sourceSignature:serializeSketch(detached)};
  const result=set(detached,selection,[
    {holeId:'mount:c',edgeId:'L:edge0',
      alongMm:55,insetMm:15,radiusMm:4}
  ]);
  assert.deepEqual(result.profile.holeIds.sort(),[
    'L:holeLower','L:holeUpper','mount:c']);
  assert.deepEqual(result.sketch.lines.filter(e=>e.id.startsWith('B:')),
    detached.lines.filter(e=>e.id.startsWith('B:')));
  assert.deepEqual(result.sketch.points.filter(p=>p.id.startsWith('B:')),
    detached.points.filter(p=>p.id.startsWith('B:')));
});

test('invalid, stale, duplicate, boundary-colliding and hole-overlap edits refuse atomically',()=>{
  const {sketch,selection}=baseline(),source=serializeSketch(sketch);
  const good={holeId:'mount:a',edgeId:'L:edge0',
    alongMm:55,insetMm:15,radiusMm:4};
  const cases=[
    [{kind:'set-edge-holes',sourceSignature:'old',edits:[good]},
      'stale_source'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[]},
      'invalid_command'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[good,good]},
      'duplicate_hole_id'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{...good,
      edgeId:'not:edge'}]},'edge_not_in_selected_contour'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{...good,
      alongMm:130}]},'invalid_edge_local_dimensions'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{...good,
      insetMm:-1}]},'invalid_edge_local_dimensions'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{...good,
      radiusMm:0}]},'invalid_command'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{...good,
      alongMm:118}]},'profile_rejected_after_edit'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{...good,
      alongMm:90}]},'profile_rejected_after_edit'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{...good,
      unexpected:true}]},'invalid_command'],
    [{kind:'set-edge-holes',sourceSignature:source,edits:[{
      holeId:'L:edge0',edgeId:'L:edge0',
      alongMm:55,insetMm:15,radiusMm:4}]},'entity_id_collision']
  ];
  for(const [command,reason] of cases){
    const r=setSelectedEdgeHoles(sketch,selection,command);
    assert.equal(r.kind,'refused',reason);
    assert.equal(r.reason,reason);
    assert.equal(Object.hasOwn(r,'sketch'),false);
    assert.equal(serializeSketch(sketch),source);
  }
});

test('unsolved conflicting and underconstrained sketches disclose status, not replacement geometry',()=>{
  const {sketch,selection}=baseline();
  const conflicted=createSketch({...sketch,constraints:[
    ...sketch.constraints,{id:'x:contradiction',kind:'distanceX',
      a:'L:a',b:'L:b',value:121}
  ]});
  const under=createSketch({...sketch,
    constraints:sketch.constraints.filter(c=>c.id!=='L:length')});
  for(const [doc,status] of [[conflicted,'conflicted'],
    [under,'underconstrained']]){
    const sel={candidateId:selection.candidateId,
      sourceSignature:serializeSketch(doc)};
    const inspected=inspectSelectedEdgeHolePlacement(doc,sel);
    assert.equal(inspected.kind,'refused');
    assert.equal(inspected.sourceStatus,status);
    const refused=setSelectedEdgeHoles(doc,sel,{
      kind:'set-edge-holes',sourceSignature:sel.sourceSignature,
      edits:[{holeId:'mount:a',edgeId:'L:edge0',
        alongMm:55,insetMm:15,radiusMm:4}]});
    assert.equal(refused.kind,'refused');
    assert.equal(Object.hasOwn(refused,'sketch'),false);
  }
});

test('a genuinely sloped selected contour without orthogonal constraints is inspectable but not projected',()=>{
  const sketch=createSketch({version:1,units:'mm',
    points:[{id:'T:a',x:0,y:0},{id:'T:b',x:100,y:0},
      {id:'T:c',x:50,y:60}],lines:[
      {id:'T:0',start:'T:a',end:'T:b'},
      {id:'T:1',start:'T:b',end:'T:c'},
      {id:'T:2',start:'T:c',end:'T:a'}],
    circles:[],constraints:[
      {id:'T:fa',kind:'fixed',point:'T:a',x:0,y:0},
      {id:'T:fb',kind:'fixed',point:'T:b',x:100,y:0},
      {id:'T:fc',kind:'fixed',point:'T:c',x:50,y:60}
    ]});
  const candidate=discoverPlateProfiles(sketch).candidates[0];
  const selection={candidateId:candidate.id,sourceSignature:serializeSketch(sketch)};
  const view=inspect(sketch,selection);
  assert.equal(view.edges.every(e=>!e.editable),true);
  const outcome=setSelectedEdgeHoles(sketch,selection,{
    kind:'set-edge-holes',sourceSignature:selection.sourceSignature,
    edits:[{holeId:'T:hole',edgeId:'T:0',
      alongMm:50,insetMm:12,radiusMm:4}]
  });
  assert.equal(outcome.kind,'refused');
  assert.equal(outcome.reason,'edge_not_axis_constrained');
});
