import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {editSelectedLinearHolePattern}
  from '../selected-linear-hole-pattern.mjs';
import {SELECTED_LINEAR_PATTERN_HANDLES_VERSION,
  inspectSelectedLinearPatternHandles,dragSelectedLinearPatternHandle}
  from '../selected-linear-pattern-handles.mjs';

const initial=()=>{
  const sketch=createDimensionedLPlateSketch();
  return {sketch,selection:{
    candidateId:discoverPlateProfiles(sketch).candidates[0].id,
    sourceSignature:serializeSketch(sketch)}};
};
function authored(){
  const {sketch,selection}=initial();
  const result=editSelectedLinearHolePattern(sketch,selection,{
    kind:'create-pattern',sourceSignature:serializeSketch(sketch),
    patternId:'L:array',anchorPointId:'L:b',firstXmm:52,firstYmm:15,
    pitchXmm:14,pitchYmm:0,radiusMm:3,count:2
  });
  assert.equal(result.kind,'accepted',result.reason);
  return {sketch:result.sketch,selection:result.selection};
}
const inspect=({sketch,selection})=>
  inspectSelectedLinearPatternHandles(sketch,selection,'L:array');
function drag(src,kind,xMm,yMm){
  const view=inspect(src);
  assert.equal(view.kind,'selected_linear_pattern_handles',view.reason);
  return dragSelectedLinearPatternHandle(src.sketch,src.selection,{
    kind:'drag-pattern-handle',sourceSignature:view.sourceSignature,
    patternId:'L:array',
    handleId:view.handles.find(h=>h.kind===kind).id,xMm,yMm
  });
}
const positions=out=>out.pattern.members.map(m=>m.position.x);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,String(a)+' != '+String(b));

test('solved pattern exposes semantic origin, pitch and radius controls',()=>{
  const src=authored(),view=inspect(src);
  assert.equal(SELECTED_LINEAR_PATTERN_HANDLES_VERSION,1);
  assert.equal(view.kind,'selected_linear_pattern_handles',view.reason);
  assert.deepEqual(view.handles.map(h=>h.kind),['origin','pitch','radius']);
  assert.deepEqual(view.handles.map(h=>h.position),
    [{x:52,y:15},{x:66,y:15},{x:55,y:15}]);
  assert.deepEqual(view.handles[1].constraintIds,
    ['L:array:hole:1:offsetX','L:array:hole:1:offsetY']);
  assert.equal(view.semanticProfileId,src.selection.candidateId);
  assert.equal(view.previewOnly,true);
  assert.equal(view.nativeExact,false);
});

test('dragging pitch edits X and Y of every linked member in one revision',()=>{
  const src=authored(),before=serializeSketch(src.sketch);
  const changed=drag(src,'pitch',64,17);
  assert.equal(changed.kind,'accepted',changed.reason);
  assert.equal(serializeSketch(src.sketch),before);
  assert.deepEqual(positions(changed),[52,64]);
  assert.deepEqual(changed.pattern.members.map(m=>m.position.y),[15,17]);
  assert.equal(changed.pattern.pitchXmm,12);
  assert.equal(changed.pattern.pitchYmm,2);
  assert.deepEqual(changed.changedConstraintIds,
    ['L:array:hole:1:offsetX','L:array:hole:1:offsetY']);
  near(changed.gesture.deviationMm,0);
  const longer=editSelectedLinearHolePattern(changed.sketch,changed.selection,{
    kind:'set-pattern',sourceSignature:serializeSketch(changed.sketch),
    patternId:'L:array',pitchXmm:12,pitchYmm:2,radiusMm:3,count:3
  });
  assert.equal(longer.kind,'accepted',longer.reason);
  assert.deepEqual(longer.pattern.members.map(m=>m.position),[
    {x:52,y:15},{x:64,y:17},{x:76,y:19}]);
  assert.equal(solveSketch(longer.sketch).status,'solved');
  const widened=editConstraint(longer.sketch,'L:length',{value:150});
  const reopened=parseSketch(serializeSketch(widened));
  const view=inspect({sketch:reopened,selection:{
    candidateId:src.selection.candidateId,sourceSignature:serializeSketch(reopened)}});
  assert.equal(view.kind,'selected_linear_pattern_handles',view.reason);
  assert.deepEqual(view.pattern.members.map(m=>m.position),[
    {x:82,y:15},{x:94,y:17},{x:106,y:19}]);
  assert.deepEqual(view.pattern.members.map(m=>m.holeId),
    ['L:array:hole:0','L:array:hole:1','L:array:hole:2']);
});

test('radius and first-origin drags preserve common radii and dependent hole IDs',()=>{
  const src=authored();
  const radiused=drag(src,'radius',56,15);
  assert.equal(radiused.kind,'accepted',radiused.reason);
  assert.equal(radiused.pattern.radiusMm,4);
  assert.deepEqual(radiused.changedConstraintIds,
    ['L:array:hole:0:radius','L:array:hole:1:radius']);
  const moved=drag({sketch:radiused.sketch,selection:radiused.selection},
    'origin',54,16);
  assert.equal(moved.kind,'accepted',moved.reason);
  assert.deepEqual(moved.pattern.members.map(m=>m.position),[
    {x:54,y:16},{x:68,y:16}]);
  assert.deepEqual(moved.pattern.members.map(m=>m.holeId),
    ['L:array:hole:0','L:array:hole:1']);
  assert.deepEqual(moved.changedConstraintIds,
    ['L:array:hole:0:offsetX','L:array:hole:0:offsetY']);
  const reopened=parseSketch(serializeSketch(moved.sketch));
  assert.equal(inspect({sketch:reopened,selection:{
    ...moved.selection,sourceSignature:serializeSketch(reopened)}}).pattern.radiusMm,4);
});

test('invalid, stale, colliding and zero-vector drags refuse atomically',()=>{
  const src=authored(),before=serializeSketch(src.sketch),view=inspect(src);
  const first=view.handles[0].id,pitch=view.handles[1].id;
  for(const [command,reason] of [
    [{kind:'drag-pattern-handle',sourceSignature:'stale',
      patternId:'L:array',handleId:pitch,xMm:64,yMm:15},'stale_source'],
    [{kind:'drag-pattern-handle',sourceSignature:before,
      patternId:'L:array',handleId:'unknown',xMm:64,yMm:15},'unknown_handle'],
    [{kind:'drag-pattern-handle',sourceSignature:before,
      patternId:'L:array',handleId:pitch,xMm:Infinity,yMm:15},'invalid_pointer'],
    [{kind:'drag-pattern-handle',sourceSignature:before,
      patternId:'L:array',handleId:pitch,xMm:52,yMm:15},'invalid_pattern_dimensions'],
    [{kind:'drag-pattern-handle',sourceSignature:before,
      patternId:'L:array',handleId:pitch,xMm:90,yMm:15},'profile_rejected_after_edit'],
    [{kind:'drag-pattern-handle',sourceSignature:before,
      patternId:'L:array',handleId:first,xMm:90,yMm:15},'profile_rejected_after_edit']
  ]){
    const r=dragSelectedLinearPatternHandle(src.sketch,src.selection,command);
    assert.equal(r.kind,'refused',JSON.stringify(command));
    assert.equal(r.reason,reason,JSON.stringify(command));
    assert.equal(Object.hasOwn(r,'sketch'),false);
    assert.equal(serializeSketch(src.sketch),before);
  }
});

test('unresolved or contradictory source is never exposed as draggable geometry',()=>{
  const src=authored();
  const variants=[
    createSketch({...src.sketch,constraints:src.sketch.constraints.filter(c=>c.id!=='L:length')}),
    createSketch({...src.sketch,constraints:[...src.sketch.constraints,
      {id:'L:conflict',kind:'distanceX',a:'L:a',b:'L:b',value:121}]})
  ];
  for(const bad of variants){
    const signature=serializeSketch(bad),selection={
      ...src.selection,sourceSignature:signature};
    const view=inspect({sketch:bad,selection});
    assert.equal(view.kind,'refused');
    const result=dragSelectedLinearPatternHandle(bad,selection,{
      kind:'drag-pattern-handle',sourceSignature:signature,
      patternId:'L:array',handleId:'pattern:L:array:pitch',xMm:64,yMm:17
    });
    assert.equal(result.kind,'refused');
    assert.equal(Object.hasOwn(result,'sketch'),false);
  }
});

test('consumer example performs real pattern gestures and source replay',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const path=fileURLToPath(new URL('../examples/selected-linear-pattern-handles.mjs',import.meta.url));
  assert.match(execFileSync(process.execPath,[path],{encoding:'utf8'}),
    /selected_linear_pattern_handles_pass/);
});
