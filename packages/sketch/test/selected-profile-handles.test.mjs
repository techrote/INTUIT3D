import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle,
  moveSelectedProfileHoleCenter,SELECTED_PROFILE_HANDLES_VERSION
} from '../selected-profile-handles.mjs';

const start=()=>{
  const sketch=createDimensionedLPlateSketch();
  const discovery=discoverPlateProfiles(sketch);
  return {sketch,selection:{candidateId:discovery.candidates[0].id,
    sourceSignature:discovery.inputSignature}};
};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} differs from ${b}`);
const dimension=(inspected,id)=>inspected.controls.find(c=>c.constraintId===id);
const set=(sketch,selection,id,valueMm)=>{
  const controls=inspectSelectedProfileHandles(sketch,selection);
  assert.equal(controls.kind,'selected_profile_handles');
  return editSelectedProfileHandle(sketch,selection,{kind:'set-dimension',
    sourceSignature:controls.sourceSignature,
    handleId:dimension(controls,id).id,valueMm});
};

test('L-profile provides dimension and hole handles with solver-derived anchors',()=>{
  const {sketch,selection}=start();
  const handles=inspectSelectedProfileHandles(sketch,selection);
  assert.equal(SELECTED_PROFILE_HANDLES_VERSION,1);
  assert.equal(handles.kind,'selected_profile_handles');
  assert.equal(handles.controls.length,10);
  assert.equal(handles.semanticProfileId,selection.candidateId);
  const length=dimension(handles,'L:length');
  assert.equal(length.kind,'distanceX');
  near(length.anchor.x,0);near(length.position.x,120);
  const radius=dimension(handles,'L:holeLowerRadius');
  near(radius.valueMm,5);near(radius.anchor.x,90);near(radius.position.x,95);
  assert.equal(handles.nativeExact,false);
});

test('one retrospective outer dimension edit moves bound holes and preserves profile identity after replay',()=>{
  const {sketch,selection}=start(),original=serializeSketch(sketch);
  const edited=set(sketch,selection,'L:length',150);
  assert.equal(edited.kind,'accepted');
  assert.equal(serializeSketch(sketch),original);
  assert.equal(edited.profile.semanticProfileId,selection.candidateId);
  near(edited.profile.profile.areaMm2,6500-50*Math.PI);
  const solved=solveSketch(edited.sketch);
  const hole=solved.geometry.points.find(p=>p.id==='L:holeLowerCenter');
  near(hole.x,120);
  const reopened=parseSketch(serializeSketch(edited.sketch));
  const current=inspectSelectedProfileHandles(reopened,edited.selection);
  assert.equal(current.kind,'selected_profile_handles');
  near(dimension(current,'L:length').valueMm,150);
  assert.equal(editSelectedProfileHandle(sketch,selection,{
    kind:'set-dimension',sourceSignature:edited.nextSourceSignature,
    handleId:'dimension:L:length',valueMm:155}).reason,'stale_source');
});

test('drag dimension and hole radius edit use one solved revision each',()=>{
  let {sketch,selection}=start();
  let controls=inspectSelectedProfileHandles(sketch,selection);
  const web=dimension(controls,'L:webWidth');
  let edited=editSelectedProfileHandle(sketch,selection,{
    kind:'drag-handle',sourceSignature:controls.sourceSignature,
    handleId:web.id,xMm:50,yMm:30});
  assert.equal(edited.kind,'accepted');
  near(edited.appliedValueMm,50);
  sketch=edited.sketch;selection=edited.selection;
  controls=inspectSelectedProfileHandles(sketch,selection);
  const radius=dimension(controls,'L:holeLowerRadius');
  edited=editSelectedProfileHandle(sketch,selection,{
    kind:'drag-handle',sourceSignature:controls.sourceSignature,
    handleId:radius.id,xMm:radius.anchor.x+7,yMm:radius.anchor.y});
  assert.equal(edited.kind,'accepted');
  near(edited.appliedValueMm,7);
  const holes=edited.profile.profile.holes;
  near(holes.find(h=>h.id==='L:holeLower').radius,7);
  near(holes.find(h=>h.id==='L:holeUpper').radius,5);
  assert.equal(edited.selection.candidateId,selection.candidateId);
});

test('invalid geometry and contradiction refuse atomically without a partial sketch',()=>{
  const {sketch,selection}=start(),original=serializeSketch(sketch);
  const rejected=set(sketch,selection,'L:holeLowerRadius',20);
  assert.equal(rejected.kind,'refused');
  assert.equal(rejected.reason,'profile_rejected_after_edit');
  assert.equal(serializeSketch(sketch),original);
  const inconsistent=createSketch({...sketch,constraints:[...sketch.constraints,
    {id:'conflict',kind:'distanceX',a:'L:a',b:'L:b',value:121}]});
  const controls=inspectSelectedProfileHandles(inconsistent,{
    candidateId:selection.candidateId,
    sourceSignature:serializeSketch(inconsistent)});
  assert.equal(controls.kind,'refused');
  assert.equal(controls.reason,'source_not_profile_ready');
  const under=createSketch({...sketch,constraints:sketch.constraints.filter(c=>c.id!=='L:length')});
  assert.equal(inspectSelectedProfileHandles(under,{
    candidateId:selection.candidateId,
    sourceSignature:serializeSketch(under)}).kind,'refused');
});

test('stale or forged user events never commit a replacement sketch',()=>{
  const {sketch,selection}=start(),stamp=serializeSketch(sketch);
  for(const command of [
    {kind:'set-dimension',sourceSignature:'stale',handleId:'dimension:L:length',valueMm:150},
    {kind:'set-dimension',sourceSignature:stamp,handleId:'dimension:unknown',valueMm:150},
    {kind:'set-dimension',sourceSignature:stamp,handleId:'dimension:L:length',valueMm:120},
    {kind:'set-dimension',sourceSignature:stamp,handleId:'dimension:L:length',valueMm:NaN},
    {kind:'drag-handle',sourceSignature:stamp,handleId:'dimension:L:length',xMm:Infinity,yMm:30},
    {kind:'set-dimension',sourceSignature:stamp,handleId:'dimension:L:length',valueMm:150,extra:true}
  ]){
    const outcome=editSelectedProfileHandle(sketch,selection,command);
    assert.equal(outcome.kind,'refused');
    assert.equal(Object.hasOwn(outcome,'sketch'),false);
  }
  const edited=set(sketch,selection,'L:length',150);
  assert.equal(editSelectedProfileHandle(edited.sketch,selection,{
    kind:'set-dimension',sourceSignature:edited.nextSourceSignature,
    handleId:'dimension:L:length',valueMm:160}).kind,'refused');
  assert.equal(serializeSketch(sketch),stamp);
});


// Hole centre drag is an authored two-axis operation, not a mesh transform.
test('selected L-profile exposes two solved hole-centre controls and atomic XY drag',()=>{
  const {sketch,selection}=start(),before=serializeSketch(sketch);
  const view=inspectSelectedProfileHandles(sketch,selection);
  assert.equal(view.holeCenters.length,2);
  const lower=view.holeCenters.find(h=>h.holeId==='L:holeLower');
  assert.deepEqual(lower.position,{x:90,y:15});
  assert.deepEqual([lower.xConstraintId,lower.yConstraintId],
    ['L:holeLowerOffsetX','L:holeLowerOffsetY']);
  const moved=moveSelectedProfileHoleCenter(sketch,selection,{
    kind:'move-hole-center',sourceSignature:before,handleId:lower.id,
    xMm:100,yMm:18
  });
  assert.equal(moved.kind,'accepted');
  assert.deepEqual(moved.editedConstraintIds,
    ['L:holeLowerOffsetX','L:holeLowerOffsetY']);
  assert.deepEqual(moved.appliedOffsetsMm,{x:-20,y:18});
  assert.deepEqual(moved.gesture.appliedPoint,{x:100,y:18});
  near(moved.gesture.deviationMm,0);
  assert.deepEqual(solveSketch(moved.sketch).geometry.points
    .filter(p=>p.id==='L:holeLowerCenter'||p.id==='L:holeUpperCenter')
    .map(p=>[p.id,p.x,p.y]),
    [['L:holeLowerCenter',100,18],['L:holeUpperCenter',20,60]]);
  assert.deepEqual(moved.profile.holeIds,view.profile.holeIds);
  assert.equal(moved.profile.semanticProfileId,view.semanticProfileId);
  assert.deepEqual(
    [...moved.sketch.points,...moved.sketch.lines,...moved.sketch.circles,...moved.sketch.constraints].map(c=>c.id),
    [...sketch.points,...sketch.lines,...sketch.circles,...sketch.constraints].map(c=>c.id)
  );
  assert.equal(serializeSketch(sketch),before);
  const reopened=parseSketch(serializeSketch(moved.sketch));
  const replay=inspectSelectedProfileHandles(reopened,moved.selection);
  assert.equal(replay.kind,'selected_profile_handles');
  assert.deepEqual(replay.holeCenters.find(h=>h.id===lower.id).position,{x:100,y:18});
  assert.deepEqual(parseSketch(before),sketch); // single undo restores both axes
});

test('selected hole dragging uses current solved references after retrospective width edits',()=>{
  const {sketch,selection}=start();
  const changed=set(sketch,selection,'L:length',150);
  assert.equal(changed.kind,'accepted');
  const view=inspectSelectedProfileHandles(changed.sketch,changed.selection);
  const lower=view.holeCenters.find(h=>h.holeId==='L:holeLower');
  assert.deepEqual(lower.position,{x:120,y:15});
  const moved=moveSelectedProfileHoleCenter(changed.sketch,changed.selection,{
    kind:'move-hole-center',sourceSignature:view.sourceSignature,
    handleId:lower.id,xMm:128,yMm:20
  });
  assert.equal(moved.kind,'accepted');
  assert.deepEqual(moved.appliedOffsetsMm,{x:-22,y:20});
  assert.equal(moved.selection.candidateId,selection.candidateId);
  assert.equal(moved.profile.profile.outer.length,6);
});

test('invalid or stale hole centre edits refuse without partial mutation',()=>{
  const {sketch,selection}=start(),stamp=serializeSketch(sketch);
  const lower=inspectSelectedProfileHandles(sketch,selection).holeCenters
    .find(h=>h.holeId==='L:holeLower');
  const call=(command)=>moveSelectedProfileHoleCenter(sketch,selection,command);
  for(const command of [
    {kind:'move-hole-center',sourceSignature:'stale',handleId:lower.id,xMm:100,yMm:18},
    {kind:'move-hole-center',sourceSignature:stamp,handleId:'forged',xMm:100,yMm:18},
    {kind:'move-hole-center',sourceSignature:stamp,handleId:lower.id,xMm:NaN,yMm:18},
    {kind:'move-hole-center',sourceSignature:stamp,handleId:lower.id,xMm:Infinity,yMm:18},
    {kind:'move-hole-center',sourceSignature:stamp,handleId:lower.id,xMm:90,yMm:15},
    {kind:'move-hole-center',sourceSignature:stamp,handleId:lower.id,xMm:100,yMm:18,override:true}
  ]){
    const result=call(command);
    assert.equal(result.kind,'refused');
    assert.equal(Object.hasOwn(result,'sketch'),false);
  }
  const boundary=call({kind:'move-hole-center',sourceSignature:stamp,
    handleId:lower.id,xMm:118,yMm:15});
  assert.equal(boundary.kind,'refused');
  assert.equal(boundary.reason,'profile_rejected_after_edit');
  assert.equal(serializeSketch(sketch),stamp);
  const conflicting=createSketch({...sketch,constraints:[...sketch.constraints,
    {id:'conflict',kind:'distanceX',a:'L:a',b:'L:b',value:121}]});
  const invalidSelection={candidateId:selection.candidateId,
    sourceSignature:serializeSketch(conflicting)};
  assert.equal(moveSelectedProfileHoleCenter(conflicting,invalidSelection,{
    kind:'move-hole-center',sourceSignature:invalidSelection.sourceSignature,
    handleId:lower.id,xMm:100,yMm:18
  }).kind,'refused');
});

test('selected hole centre example runs with solved replay and immutable original',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const example=fileURLToPath(new URL('../examples/selected-profile-hole-drag.mjs',import.meta.url));
  const rows=execFileSync(process.execPath,[example],
    {encoding:'utf8',timeout:30000}).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.step),[
    'original','move_lower_hole','resize_length','move_upper_hole','reopen','undo'
  ]);
  assert.equal(rows[2].lengthMm,150);
  assert.equal(rows[3].upper.x,18);
  assert.equal(rows[3].upper.y,65);
  assert.equal(rows[4].profileId,rows[0].profileId);
  assert.equal(rows[5].lower.x,90);
  assert.equal(rows[4].nativeExact,false);
});
