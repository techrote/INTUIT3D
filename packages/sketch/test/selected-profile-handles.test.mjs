import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle,
  SELECTED_PROFILE_HANDLES_VERSION} from '../selected-profile-handles.mjs';

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
