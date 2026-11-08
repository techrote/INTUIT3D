import test from 'node:test';
import assert from 'node:assert/strict';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch,editConstraint} from '../index.mjs';
import {solveArcSketch} from '../arc-constraints.mjs';
import {createSelectedEdgeRoundSlotLayout,inspectSelectedEdgeRoundSlotLayout,
  addSelectedEdgeRoundSlotLayout,editSelectedEdgeRoundSlotLayout,
  relocateSelectedEdgeRoundSlotLayout,removeSelectedEdgeRoundSlotLayout,
  dragSelectedEdgeRoundSlotLayoutHandle,rebaseSelectedEdgeRoundSlotLayout,
  serializeSelectedEdgeRoundSlotLayout,parseSelectedEdgeRoundSlotLayout}
  from '../selected-edge-round-slot-layout.mjs';

const doc=()=>createDimensionedLPlateSketch();
const selected=source=>{
  const c=discoverPlateProfiles(source).candidates.find(x=>x.lineIds.includes('L:edge0'));
  assert.ok(c);
  return {candidateId:c.id,sourceSignature:serializeSketch(source)};
};
const slots=[
  {id:'slotA',edgeId:'L:edge0',fromMm:35,toMm:55,straightDepthMm:5},
  {id:'slotB',edgeId:'L:edge0',fromMm:65,toMm:80,straightDepthMm:4}
];
const make=()=>{
  const source=doc(),sel=selected(source);
  const out=createSelectedEdgeRoundSlotLayout(source,sel,{
    kind:'create-selected-edge-round-slot-layout',version:1,
    sourceSignature:serializeSketch(source),slots
  });
  assert.equal(out.kind,'accepted',JSON.stringify(out.kind==='refused'?out:{status:out.solution.status}));
  return {source,sel,out};
};
const areasClose=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,a+' != '+b);
test('two independent true tangent caps on same selected edge form one solved analytic wire',()=>{
  const {source,out}=make();
  assert.equal(solveArcSketch(out.arcSketch).status,'solved');
  assert.equal(out.solution.degreesOfFreedom,0);
  assert.equal(out.arcSketch.arcs.length,2);
  assert.equal(out.arcSketch.constraints.filter(c=>c.kind==='tangent').length,4);
  assert.equal(out.arcSketch.constraints.filter(c=>c.kind==='arcRadius').length,2);
  assert.equal(out.profile.boundary.filter(e=>e.kind==='arc').length,2);
  assert.equal(out.profile.boundary.length,14);
  assert.equal(out.profile.globalSelfIntersectionChecked,true);
  assert.deepEqual(out.holeIds,['L:holeLower','L:holeUpper']);
  assert.equal(out.arcSketch.lines.find(l=>l.id==='slotA:tail').end,'slotB:p1');
  assert.equal(out.arcSketch.lines.find(l=>l.id==='slotB:tail').end,'L:b');
  const removed=20*5+Math.PI*10*10/2+15*4+Math.PI*7.5*7.5/2;
  areasClose(out.profile.materialAreaMm2,5600-50*Math.PI-removed);
  assert.deepEqual(out.authoring.source.constraints,source.constraints);
  assert.equal(serializeSketch(out.authoring.source),serializeSketch(source));
  assert.equal(out.nativeExact,false);
  assert.equal(out.handles.length,8);
});
test('serialized layout reopens with stable handles and analytic geometry',()=>{
  const {out}=make();
  const text=serializeSelectedEdgeRoundSlotLayout(out.authoring);
  const again=inspectSelectedEdgeRoundSlotLayout(parseSelectedEdgeRoundSlotLayout(text));
  assert.equal(again.kind,'selected_edge_round_slot_layout',JSON.stringify(again));
  assert.equal(again.arcSourceSignature,out.arcSourceSignature);
  assert.deepEqual(again.handles,out.handles);
  assert.deepEqual(again.profile.boundary,out.profile.boundary);
  assert.equal(again.authoringSignature,text);
});
test('atomic second-slot dimension and semantic pointer edits retain first slot',()=>{
  const {out}=make(),before=serializeSelectedEdgeRoundSlotLayout(out.authoring);
  const changed=editSelectedEdgeRoundSlotLayout(out.authoring,{
    kind:'edit-selected-edge-round-slot-layout',version:1,
    sourceSignature:before,slotId:'slotB',
    fromMm:64,toMm:79,straightDepthMm:5
  });
  assert.equal(changed.kind,'accepted',JSON.stringify(changed));
  assert.deepEqual(changed.slots[0],out.slots[0]);
  assert.equal(changed.slots[1].straightDepthMm,5);
  const grip=changed.handles.find(h=>h.id==='slotB:handle-slide');
  const moved=dragSelectedEdgeRoundSlotLayoutHandle(changed.authoring,{
    version:1,sourceSignature:changed.authoringSignature,
    handleId:grip.id,target:{x:grip.position.x+2,y:grip.position.y+3}
  });
  assert.equal(moved.kind,'accepted',JSON.stringify(moved));
  assert.equal(moved.slots[1].fromMm,66);
  assert.equal(moved.slots[1].toMm,81);
  areasClose(moved.gesture.projectionDeviationMm,3);
  assert.deepEqual(moved.slots[0],out.slots[0]);
  assert.equal(serializeSelectedEdgeRoundSlotLayout(out.authoring),before);
});
test('third slot on orthogonal edge uses same stable selected contour and survives removal',()=>{
  const {out}=make();
  const add=addSelectedEdgeRoundSlotLayout(out.authoring,{
    kind:'add-selected-edge-round-slot-layout',version:1,
    sourceSignature:out.authoringSignature,
    slot:{id:'slotC',edgeId:'L:edge1',fromMm:5,toMm:13,straightDepthMm:3}
  });
  assert.equal(add.kind,'accepted',JSON.stringify(add));
  assert.equal(add.arcSketch.arcs.length,3);
  assert.equal(add.profile.boundary.length,18);
  assert.deepEqual(add.slots.slice(0,2),out.slots);
  const removed=removeSelectedEdgeRoundSlotLayout(add.authoring,{
    kind:'remove-selected-edge-round-slot-layout',version:1,
    sourceSignature:add.authoringSignature,slotId:'slotB'
  });
  assert.equal(removed.kind,'accepted',JSON.stringify(removed));
  assert.deepEqual(removed.slots.map(s=>s.id),['slotA','slotC']);
  assert.equal(removed.arcSketch.arcs.length,2);
  assert.equal(removed.handles.filter(h=>h.slotId==='slotC').length,4);
});
test('overlap, touching mouths, stale tokens, duplicate IDs and holes refuse without mutation',()=>{
  const {out}=make(),original=serializeSelectedEdgeRoundSlotLayout(out.authoring);
  const call=slot=>addSelectedEdgeRoundSlotLayout(out.authoring,{
    kind:'add-selected-edge-round-slot-layout',version:1,
    sourceSignature:original,slot
  });
  const overlapping=call({id:'slotD',edgeId:'L:edge0',
    fromMm:53,toMm:70,straightDepthMm:3});
  assert.equal(overlapping.kind,'refused');
  assert.equal(overlapping.reason,'overlapping_slot_mouths');
  const touching=call({id:'slotD',edgeId:'L:edge0',
    fromMm:55,toMm:64,straightDepthMm:3});
  assert.equal(touching.kind,'refused');
  assert.equal(touching.reason,'overlapping_slot_mouths');
  assert.equal(call({...slots[1]}).reason,'duplicate_slot_id');
  const stale=editSelectedEdgeRoundSlotLayout(out.authoring,{
    kind:'edit-selected-edge-round-slot-layout',version:1,
    sourceSignature:'stale',slotId:'slotA',
    fromMm:35,toMm:55,straightDepthMm:8
  });
  assert.equal(stale.reason,'stale_source');
  const unsafe=call({id:'slotD',edgeId:'L:edge0',
    fromMm:85,toMm:105,straightDepthMm:12});
  assert.equal(unsafe.kind,'refused');
  const malformed=call({id:'slotD',edgeId:'L:edge0',
    fromMm:50,toMm:51,straightDepthMm:NaN});
  assert.equal(malformed.kind,'refused');
  assert.equal(serializeSelectedEdgeRoundSlotLayout(out.authoring),original);
});
test('explicit edge relocation and retrospective rebase preserve references; invalid edit rejects',()=>{
  const {source,out}=make(),sig=out.authoringSignature;
  const bad=relocateSelectedEdgeRoundSlotLayout(out.authoring,{
    kind:'relocate-selected-edge-round-slot-layout',version:1,
    sourceSignature:sig,slotId:'slotA',
    edgeId:'absent',fromMm:4,toMm:10,straightDepthMm:2
  });
  assert.equal(bad.kind,'refused');
  const moved=relocateSelectedEdgeRoundSlotLayout(out.authoring,{
    kind:'relocate-selected-edge-round-slot-layout',version:1,
    sourceSignature:sig,slotId:'slotA',
    edgeId:'L:edge1',fromMm:4,toMm:12,straightDepthMm:2
  });
  assert.equal(moved.kind,'accepted',JSON.stringify(moved));
  assert.equal(moved.slots[0].id,'slotA');
  assert.equal(moved.bindings[0].edgeId,'L:edge1');
  const wider=editConstraint(source,'L:length',{value:140});
  const rebased=rebaseSelectedEdgeRoundSlotLayout(out.authoring,wider,
    selected(wider),{
      kind:'rebase-selected-edge-round-slot-layout',version:1,
      sourceSignature:sig
    });
  assert.equal(rebased.kind,'accepted',JSON.stringify(rebased));
  assert.deepEqual(rebased.slots,out.slots);
  assert.deepEqual(rebased.bindings.map(x=>x.edgeId),out.bindings.map(x=>x.edgeId));
  assert.notEqual(rebased.sourceSignature,sig);
  assert.equal(serializeSketch(rebased.authoring.source),serializeSketch(wider));
});
