import test from 'node:test';
import assert from 'node:assert/strict';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch,editConstraint} from '../index.mjs';
import {createSelectedEdgeRoundSlotPattern,inspectSelectedEdgeRoundSlotPattern,
  editSelectedEdgeRoundSlotPattern,relocateSelectedEdgeRoundSlotPattern,
  dragSelectedEdgeRoundSlotPatternHandle,rebaseSelectedEdgeRoundSlotPattern,
  serializeSelectedEdgeRoundSlotPattern,parseSelectedEdgeRoundSlotPattern}
  from '../selected-edge-round-slot-pattern.mjs';

const source=()=>createDimensionedLPlateSketch();
const select=doc=>{
  const c=discoverPlateProfiles(doc).candidates.find(x=>x.lineIds.includes('L:edge0'));
  assert.ok(c);
  return {candidateId:c.id,sourceSignature:serializeSketch(doc)};
};
const base={id:'mount',edgeId:'L:edge0',count:3,
  firstCenterMm:20,pitchMm:23,widthMm:8,straightDepthMm:3};
const make=(p=base)=>{
  const doc=source(),choice=select(doc);
  const v=createSelectedEdgeRoundSlotPattern(doc,choice,{
    kind:'create-selected-edge-round-slot-pattern',version:1,
    sourceSignature:serializeSketch(doc),pattern:p
  });
  assert.equal(v.kind,'accepted',JSON.stringify(v.kind==='refused'?v:{status:v.solution.status}));
  return {doc,choice,v};
};
const edit=(v,dims)=>editSelectedEdgeRoundSlotPattern(v.authoring,{
  kind:'edit-selected-edge-round-slot-pattern',version:1,
  sourceSignature:v.authoringSignature,
  count:dims.count??v.pattern.count,
  firstCenterMm:dims.firstCenterMm??v.pattern.firstCenterMm,
  pitchMm:dims.pitchMm??v.pattern.pitchMm,
  widthMm:dims.widthMm??v.pattern.widthMm,
  straightDepthMm:dims.straightDepthMm??v.pattern.straightDepthMm
});
test('equal-pitch true tangent arc array is one fully solved selected contour',()=>{
  const {doc,v}=make();
  assert.equal(v.solution.status,'solved');
  assert.equal(v.solution.degreesOfFreedom,0);
  assert.equal(v.arcSketch.arcs.length,3);
  assert.equal(v.arcSketch.constraints.filter(c=>c.kind==='tangent').length,6);
  assert.equal(v.profile.boundary.filter(b=>b.kind==='arc').length,3);
  assert.deepEqual(v.slots.map(s=>s.id),
    ['mount:repeat:0','mount:repeat:1','mount:repeat:2']);
  assert.deepEqual(v.slots.map(s=>s.fromMm),[16,39,62]);
  assert.deepEqual(v.slots.map(s=>s.toMm),[24,47,70]);
  assert.deepEqual(v.holeIds,['L:holeLower','L:holeUpper']);
  assert.deepEqual(v.authoring.source.constraints,doc.constraints);
  assert.equal(serializeSketch(v.authoring.source),serializeSketch(doc));
  assert.equal(v.nativeExact,false);
  assert.deepEqual(v.handles.map(h=>h.kind),['origin','pitch','width','depth']);
});
test('editing origin, pitch, count and width is atomic with stable instance IDs',()=>{
  const {v}=make(),original=serializeSelectedEdgeRoundSlotPattern(v.authoring);
  const changed=edit(v,{firstCenterMm:21,pitchMm:24,widthMm:9});
  assert.equal(changed.kind,'accepted',JSON.stringify(changed));
  assert.deepEqual(changed.slots.map(s=>s.id),v.slots.map(s=>s.id));
  assert.deepEqual(changed.slots.map(s=>(s.fromMm+s.toMm)/2),[21,45,69]);
  const reduced=edit(changed,{count:2});
  assert.equal(reduced.kind,'accepted',JSON.stringify(reduced));
  assert.deepEqual(reduced.slots.map(s=>s.id),
    ['mount:repeat:0','mount:repeat:1']);
  assert.equal(serializeSelectedEdgeRoundSlotPattern(v.authoring),original);
});
test('semantic handle drags project movement while maintaining equal pitch',()=>{
  const {v}=make();
  const origin=v.handles.find(h=>h.kind==='origin');
  const moved=dragSelectedEdgeRoundSlotPatternHandle(v.authoring,{
    version:1,sourceSignature:v.authoringSignature,handleId:origin.id,
    target:{x:origin.position.x+2,y:origin.position.y+3}
  });
  assert.equal(moved.kind,'accepted',JSON.stringify(moved));
  assert.equal(moved.pattern.firstCenterMm,22);
  assert.equal(moved.pattern.pitchMm,23);
  assert.ok(Math.abs(moved.gesture.projectionDeviationMm-3)<1e-5);
  const pitch=moved.handles.find(h=>h.kind==='pitch');
  const spaced=dragSelectedEdgeRoundSlotPatternHandle(moved.authoring,{
    version:1,sourceSignature:moved.authoringSignature,handleId:pitch.id,
    target:{x:pitch.position.x+1,y:pitch.position.y}
  });
  assert.equal(spaced.kind,'accepted',JSON.stringify(spaced));
  assert.equal(spaced.pattern.pitchMm,24);
  assert.deepEqual(spaced.slots.map(s=>(s.fromMm+s.toMm)/2),[22,46,70]);
});
test('persist/reopen and retrospective rebase maintain semantic reference identity',()=>{
  const {doc,v}=make();
  const archived=serializeSelectedEdgeRoundSlotPattern(v.authoring);
  const read=inspectSelectedEdgeRoundSlotPattern(
    parseSelectedEdgeRoundSlotPattern(archived));
  assert.equal(read.kind,'selected_edge_round_slot_pattern');
  assert.equal(read.authoringSignature,v.authoringSignature);
  assert.deepEqual(read.profile.boundary,v.profile.boundary);
  const resized=editConstraint(doc,'L:length',{value:140});
  const replay=rebaseSelectedEdgeRoundSlotPattern(v.authoring,resized,select(resized),{
    kind:'rebase-selected-edge-round-slot-pattern',version:1,
    sourceSignature:v.authoringSignature
  });
  assert.equal(replay.kind,'accepted',JSON.stringify(replay));
  assert.deepEqual(replay.slots,v.slots);
  assert.deepEqual(replay.bindings.map(b=>b.edgeId),v.bindings.map(b=>b.edgeId));
  assert.equal(serializeSketch(replay.authoring.source),serializeSketch(resized));
});
test('stale, overlapping, invalid count and mismatched edge refuse without mutation',()=>{
  const {v,doc}=make(),before=serializeSelectedEdgeRoundSlotPattern(v.authoring);
  assert.equal(edit(v,{pitchMm:8}).reason,'invalid_pattern_dimensions');
  assert.equal(edit(v,{count:9}).reason,'invalid_pattern_dimensions');
  assert.equal(edit(v,{count:1}).reason,'invalid_pattern_dimensions');
  const stale=editSelectedEdgeRoundSlotPattern(v.authoring,{
    kind:'edit-selected-edge-round-slot-pattern',version:1,
    sourceSignature:'stale',count:3,firstCenterMm:20,pitchMm:23,
    widthMm:8,straightDepthMm:3
  });
  assert.equal(stale.reason,'stale_source');
  const missing=relocateSelectedEdgeRoundSlotPattern(v.authoring,{
    kind:'relocate-selected-edge-round-slot-pattern',version:1,
    sourceSignature:v.authoringSignature,edgeId:'not-present',
    firstCenterMm:20,pitchMm:23,widthMm:8,straightDepthMm:3
  });
  assert.equal(missing.kind,'refused');
  const unsafe=edit(v,{firstCenterMm:75});
  assert.equal(unsafe.kind,'refused');
  assert.equal(serializeSelectedEdgeRoundSlotPattern(v.authoring),before);
  assert.equal(serializeSketch(doc),serializeSketch(v.authoring.source));
});
test('bad pointer, unknown handle, bad array envelope and attempted implicit rebinding refuse',()=>{
  const {v}=make();
  const drag=target=>dragSelectedEdgeRoundSlotPatternHandle(v.authoring,{
    version:1,sourceSignature:v.authoringSignature,
    handleId:v.handles[0].id,target
  });
  assert.equal(drag({x:NaN,y:0}).reason,'invalid_pointer_gesture');
  assert.equal(dragSelectedEdgeRoundSlotPatternHandle(v.authoring,{
    version:1,sourceSignature:v.authoringSignature,
    handleId:'missing',target:{x:10,y:0}
  }).reason,'unknown_handle');
  assert.equal(inspectSelectedEdgeRoundSlotPattern({...v.authoring,
    pattern:{...base,count:0}}).reason,'invalid_authoring');
  assert.equal(inspectSelectedEdgeRoundSlotPattern({...v.authoring,
    pattern:{...base,id:'invalid pattern id'}}).kind,'refused');
});

test('width and depth handles edit symmetric pattern dimensions, not only one slot',()=>{
  const {v}=make();
  const width=v.handles.find(h=>h.kind==='width');
  const widened=dragSelectedEdgeRoundSlotPatternHandle(v.authoring,{
    version:1,sourceSignature:v.authoringSignature,handleId:width.id,
    target:{x:width.position.x+1,y:width.position.y}
  });
  assert.equal(widened.kind,'accepted',JSON.stringify(widened));
  assert.equal(widened.pattern.widthMm,10);
  assert.deepEqual(widened.slots.map(s=>s.toMm-s.fromMm),[10,10,10]);
  const cap=widened.handles.find(h=>h.kind==='depth');
  const deeper=dragSelectedEdgeRoundSlotPatternHandle(widened.authoring,{
    version:1,sourceSignature:widened.authoringSignature,handleId:cap.id,
    target:{x:cap.position.x,y:cap.position.y+1}
  });
  assert.equal(deeper.kind,'accepted',JSON.stringify(deeper));
  assert.equal(deeper.pattern.straightDepthMm,4);
  assert.deepEqual(deeper.slots.map(s=>s.straightDepthMm),[4,4,4]);
});
test('deliberate edge relocation rebinds the whole array without changing instance identities',()=>{
  const {v}=make();
  const moved=relocateSelectedEdgeRoundSlotPattern(v.authoring,{
    kind:'relocate-selected-edge-round-slot-pattern',version:1,
    sourceSignature:v.authoringSignature,edgeId:'L:edge1',
    firstCenterMm:5,pitchMm:7,widthMm:4,straightDepthMm:2
  });
  assert.equal(moved.kind,'accepted',JSON.stringify(moved));
  assert.deepEqual(moved.slots.map(s=>s.id),v.slots.map(s=>s.id));
  assert.ok(moved.slots.every(s=>s.edgeId==='L:edge1'));
  assert.equal(moved.solution.degreesOfFreedom,0);
});
