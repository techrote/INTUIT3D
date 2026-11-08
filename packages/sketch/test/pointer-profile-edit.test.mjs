import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {selectContourAtPointer} from '../pointer-contour-selection.mjs';
import {inspectPointerEditableHandles,pickProfileHandleAtPointer,
  dragProfileHandleAtPointer,POINTER_PROFILE_EDIT_VERSION}
  from '../pointer-profile-edit.mjs';

const base=()=>createDimensionedLPlateSketch();
const stamp=d=>serializeSketch(d);
function select(doc,at={x:10,y:40}){
  const out=selectContourAtPointer(doc,{kind:'select-contour-at-pointer',
    version:1,sourceSignature:stamp(doc),point:at,boundaryClearanceMm:0.1});
  assert.equal(out.kind,'selected',JSON.stringify(out));
  return out.selection;
}
function pick(doc,s,point,filter='all',maxDistanceMm=0.15){
  return pickProfileHandleAtPointer(doc,s,{kind:'pick-profile-handle',
    version:1,sourceSignature:stamp(doc),point,maxDistanceMm,filter});
}
function drag(doc,s,id,target,sourceSignature=stamp(doc)){
  return dragProfileHandleAtPointer(doc,s,{kind:'drag-profile-handle',
    version:1,sourceSignature,handleId:id,target});
}
test('published pointer -> selected contour -> real semantic drag -> archive example',async()=>{
  assert.equal(POINTER_PROFILE_EDIT_VERSION,1);
  await import('../examples/pointer-profile-edit.mjs');
});
test('one actual dimension is selected by mm pointer and solver edited atomically',()=>{
  const doc=base(),s=select(doc),before=stamp(doc);
  const h=pick(doc,s,{x:120,y:0},'dimension');
  assert.equal(h.kind,'picked',JSON.stringify(h));
  assert.equal(h.handle.handleId,'dimension:L:length');
  const out=drag(doc,s,h.handle.handleId,{x:145,y:3});
  assert.equal(out.kind,'accepted',JSON.stringify(out));
  assert.equal(out.sketch.constraints.find(c=>c.id==='L:length').value,145);
  assert.equal(out.gesture.deviationMm,3);
  assert.equal(solveSketch(out.sketch).degreesOfFreedom,0);
  assert.equal(stamp(doc),before);
  assert.equal(out.selection.candidateId,s.candidateId);
  const reopen=parseSketch(stamp(out.sketch));
  assert.equal(pick(reopen,out.selection,{x:145,y:0},'dimension').kind,'picked');
});
test('hole center overlap returns explicit ambiguity, filtered pick edits XY together',()=>{
  const doc=base(),s=select(doc);
  const hits=pick(doc,s,{x:90,y:15});
  assert.equal(hits.kind,'ambiguous');
  assert.deepEqual(hits.choices.map(x=>x.handleId).sort(),[
    'dimension:L:holeLowerOffsetX','dimension:L:holeLowerOffsetY',
    'hole-center:L:holeLower'].sort());
  const h=pick(doc,s,{x:90,y:15},'hole_center');
  assert.equal(h.kind,'picked');
  const out=drag(doc,s,h.handle.handleId,{x:85,y:17});
  assert.equal(out.kind,'accepted',JSON.stringify(out));
  assert.deepEqual(out.changedConstraintIds,
    ['L:holeLowerOffsetX','L:holeLowerOffsetY']);
  assert.equal(out.sketch.constraints.find(c=>c.id==='L:holeLowerOffsetX').value,-35);
  assert.equal(out.sketch.constraints.find(c=>c.id==='L:holeLowerOffsetY').value,17);
  assert.equal(solveSketch(out.sketch).status,'solved');
});
test('edge/circle interference refuses whole drag without altering original',()=>{
  const doc=base(),s=select(doc),before=stamp(doc);
  const h=pick(doc,s,{x:90,y:15},'hole_center');
  const bad=drag(doc,s,h.handle.handleId,{x:119,y:15});
  assert.equal(bad.kind,'refused',JSON.stringify(bad));
  assert.equal(stamp(doc),before);
  assert.equal(solveSketch(doc).status,'solved');
});
test('explicit radius handles retain semantic ID and reject nonpositive radius',()=>{
  const doc=base(),s=select(doc);
  const h=pick(doc,s,{x:95,y:15},'dimension');
  assert.equal(h.kind,'picked',JSON.stringify(h));
  assert.equal(h.handle.handleId,'dimension:L:holeLowerRadius');
  const bad=drag(doc,s,h.handle.handleId,{x:89,y:15});
  assert.equal(bad.kind,'refused');
  const valid=drag(doc,s,h.handle.handleId,{x:96,y:15});
  assert.equal(valid.kind,'accepted',JSON.stringify(valid));
  assert.equal(valid.sketch.constraints.find(c=>c.id==='L:holeLowerRadius').value,6);
  assert.ok(valid.handles.some(x=>x.handleId===h.handle.handleId));
});
test('pointer/radius budgets, missing IDs, stale and malformed commands refuse',()=>{
  const doc=base(),s=select(doc),signature=stamp(doc);
  for(const invalid of [
    {x:NaN,y:5},{x:Infinity,y:5}
  ]){
    assert.equal(pickProfileHandleAtPointer(doc,s,{
      kind:'pick-profile-handle',version:1,sourceSignature:signature,
      point:invalid,maxDistanceMm:1,filter:'all'
    }).reason,'invalid_pointer_command');
  }
  assert.equal(pick(doc,s,{x:1000,y:1000}).reason,'no_handle_in_range');
  assert.equal(pick(doc,s,{x:120,y:0},'all',21).reason,'invalid_pointer_command');
  assert.equal(pickProfileHandleAtPointer(doc,s,{
    kind:'pick-profile-handle',version:1,sourceSignature:'old',
    point:{x:120,y:0},maxDistanceMm:1,filter:'all'
  }).reason,'stale_source');
  assert.equal(drag(doc,s,'not-a-handle',{x:120,y:0}).reason,
    'handle_not_in_selected_contour');
  assert.equal(drag(doc,s,'dimension:L:length',{x:120,y:0},'old').reason,
    'stale_source');
  assert.equal(drag(doc,s,'dimension:L:length',{x:NaN,y:0}).reason,
    'invalid_drag_command');
});
test('real solver conflict and incomplete contour never expose actionable handles',()=>{
  const doc=base();
  const under=createSketch({...doc,
    constraints:doc.constraints.filter(c=>c.id!=='L:length')});
  const conflict=createSketch({...doc,constraints:[
    ...doc.constraints,{id:'L:contradiction',kind:'distanceX',
      a:'L:a',b:'L:b',value:121}
  ]});
  for(const bad of [under,conflict]){
    const out=inspectPointerEditableHandles(bad,{
      candidateId:select(doc).candidateId,sourceSignature:stamp(bad)
    });
    assert.equal(out.kind,'refused');
    assert.ok(out.diagnostics.length>0);
  }
});
test('handles belong only to truly selected profile even when second loop exists',()=>{
  const doc=base(),other=structuredClone(doc),points=[
    {id:'island:0',x:300,y:100},{id:'island:1',x:330,y:100},
    {id:'island:2',x:330,y:130},{id:'island:3',x:300,y:130}
  ];
  other.points.push(...points);
  other.lines.push(...points.map((p,i)=>({
    id:'island:e'+i,start:p.id,end:points[(i+1)%4].id
  })));
  other.constraints.push(...points.map(p=>({
    id:'island:lock:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
  })));
  const material=createSketch(other),first=select(material),second=select(material,{x:310,y:110});
  assert.equal(inspectPointerEditableHandles(material,second).handles.length,0);
  assert.equal(pick(material,second,{x:120,y:0},'all').kind,'miss');
  const edited=drag(material,first,'dimension:L:length',{x:150,y:0});
  assert.equal(edited.kind,'accepted',JSON.stringify(edited));
  assert.equal(select(edited.sketch,{x:310,y:110}).candidateId,second.candidateId);
  assert.ok(edited.sketch.points.some(x=>x.id==='island:0'&&x.x===300));
});
