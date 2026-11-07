import test from 'node:test';
import assert from 'node:assert/strict';
import {createObroundSlot,inspectObroundSlot} from '../obround-slot.mjs';
import {inspectObroundSlotHandles,dragObroundSlotHandle}
  from '../obround-slot-handles.mjs';
import {parseArcSketch,serializeArcSketch} from '../arc-constraints.mjs';

const initial=()=>createObroundSlot({
  id:'mount',overallLengthMm:60,diameterMm:12,originXmm:10,originYmm:20
});
const ids=doc=>({
  points:doc.points.map(p=>p.id),lines:doc.lines.map(l=>l.id),
  arcs:doc.arcs.map(a=>a.id),constraints:doc.constraints.map(c=>c.id)
});
function drag(doc,kind,x,y){
  const view=inspectObroundSlotHandles(doc,'mount');
  return dragObroundSlotHandle(doc,'mount',{
    version:1,handleId:'mount:'+kind,
    expectedSignature:view.sourceSignature,target:{x,y}
  });
}
const required=(response)=>{
  assert.equal(response.kind,'accepted',response.reason);
  assert.equal(response.solution.status,'solved');
  assert.equal(response.profile.providerSubmissionReady,true);
  assert.equal(response.profile.nativeProfileAdmissible,false);
  assert.equal(response.previewOnly,true);
  return response.sketch;
};

test('five stable, typed pointer controls are derived from the solved obround',()=>{
  const view=inspectObroundSlotHandles(initial(),'mount');
  assert.equal(view.status,'solved');
  assert.deepEqual(view.handles.map(h=>h.kind),[
    'length-left','length-right','diameter-bottom','diameter-top','position']);
  assert.deepEqual(view.handles.map(h=>h.axis),['x','x','y','y','xy']);
  assert.deepEqual(view.handles.find(h=>h.kind==='position').position,{x:40,y:26});
});
test('opposite cap remains fixed during left/right length edits',()=>{
  const original=initial();
  const right=drag(original,'length-right',90,999);
  let doc=required(right);
  assert.equal(right.dimensions.overallLengthMm,80);
  assert.equal(right.dimensions.originXmm,10);
  assert.deepEqual(right.gesture.appliedPoint,{x:90,y:26});
  assert.equal(right.gesture.deviationMm,973);
  const left=drag(doc,'length-left',5,-999);
  doc=required(left);
  assert.equal(left.dimensions.originXmm,5);
  assert.equal(left.dimensions.overallLengthMm,85);
  assert.equal(left.dimensions.originXmm+left.dimensions.overallLengthMm,90);
  assert.deepEqual(ids(doc),ids(original));
  assert.notEqual(serializeArcSketch(doc),serializeArcSketch(original));
});
test('diameter edits preserve the opposite edge and stable curved profile identity',()=>{
  const original=initial();
  let edit=drag(original,'diameter-top',500,40);
  let doc=required(edit);
  assert.equal(edit.dimensions.diameterMm,20);
  assert.equal(edit.dimensions.originYmm,20);
  edit=drag(doc,'diameter-bottom',-50,16);
  doc=required(edit);
  assert.equal(edit.dimensions.originYmm,16);
  assert.equal(edit.dimensions.diameterMm,24);
  assert.equal(edit.dimensions.originYmm+edit.dimensions.diameterMm,40);
  assert.deepEqual(ids(doc),ids(original));
  assert.deepEqual(inspectObroundSlot(doc,'mount').profile.boundary.map(c=>c.id),
    inspectObroundSlot(original,'mount').profile.boundary.map(c=>c.id));
});
test('center translation is one undoable revision and replayable via archive',()=>{
  const original=initial();
  const moved=drag(original,'position',105,-25);
  const doc=required(moved);
  assert.equal(moved.dimensions.originXmm,75);
  assert.equal(moved.dimensions.originYmm,-31);
  assert.equal(moved.gesture.deviationMm,0);
  assert.equal(moved.priorSourceSignature,serializeArcSketch(original));
  const restored=parseArcSketch(serializeArcSketch(doc));
  assert.deepEqual(inspectObroundSlotHandles(restored,'mount').handles,moved.handles);
  assert.deepEqual(ids(restored),ids(original));
});
test('stale, malformed and collapsing gestures refuse without mutating intent',()=>{
  const doc=initial(),before=serializeArcSketch(doc);
  const view=inspectObroundSlotHandles(doc,'mount');
  const base={version:1,handleId:'mount:length-right',
    expectedSignature:view.sourceSignature,target:{x:70,y:26}};
  for(const change of [
    {...base,expectedSignature:'stale'},
    {...base,handleId:'mount:nonexistent'},
    {...base,target:{x:22,y:26}},
    {...base,target:{x:Number.NaN,y:26}},
    {...base,target:{x:70,y:26,unsafe:true}},
    {...base,version:2}
  ]){
    const res=dragObroundSlotHandle(doc,'mount',change);
    assert.equal(res.kind,'refused');
    assert.equal(serializeArcSketch(doc),before);
  }
});
test('public example replays five gestures with analytic, not native, evidence',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const script=fileURLToPath(new URL('../examples/obround-slot-handles.mjs',import.meta.url));
  const rows=execFileSync(process.execPath,[script],
    {encoding:'utf8',timeout:30000}).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row=>row.step),[
    'initial','length','diameter','position','reopen','rejected']);
  assert.equal(rows[4].curveIds.join(','),rows[0].curveIds.join(','));
  assert.equal(rows[4].nativeExact,false);
  assert.equal(rows[5].kind,'refused');
});
