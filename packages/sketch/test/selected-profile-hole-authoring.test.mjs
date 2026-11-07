import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle,
  moveSelectedProfileHoleCenter} from '../selected-profile-handles.mjs';
import {SELECTED_PROFILE_HOLE_AUTHORING_VERSION,
  inspectSelectedProfileHoleAuthoring,editSelectedProfileHole
} from '../selected-profile-hole-authoring.mjs';

const initial=()=>{
  const sketch=createDimensionedLPlateSketch();
  const discovered=discoverPlateProfiles(sketch);
  return {sketch,selection:{candidateId:discovered.candidates[0].id,
    sourceSignature:discovered.inputSignature}};
};
const view=(s,p)=>{
  const v=inspectSelectedProfileHoleAuthoring(s,p);
  assert.equal(v.kind,'selected_profile_hole_authoring',v.reason);
  return v;
};
const apply=(s,p,command)=>{
  const v=view(s,p);
  const result=editSelectedProfileHole(s,p,{...command,sourceSignature:v.sourceSignature});
  assert.equal(result.kind,'accepted',result.reason+': '+result.detail);
  return result;
};
const near=(a,b)=>assert.ok(Math.abs(a-b)<=1e-8,String(a)+' != '+String(b));
const hole=(result,id)=>result.profile.profile.holes.find(h=>h.id===id);

test('selected L-profile publishes dimensioned hole authoring anchors and reference diagnostics',()=>{
  const {sketch,selection}=initial();
  const inspection=view(sketch,selection);
  assert.equal(SELECTED_PROFILE_HOLE_AUTHORING_VERSION,1);
  assert.equal(inspection.anchors.length,8);
  assert.deepEqual(inspection.anchors.filter(a=>a.kind==='boundary_vertex').map(a=>a.pointId),
    ['L:a','L:b','L:c','L:d','L:e','L:f']);
  assert.equal(inspection.holes.length,2);
  const lower=inspection.holes.find(h=>h.holeId==='L:holeLower');
  assert.equal(lower.canRemove,true);
  assert.equal(lower.canReanchor,true);
  assert.equal(lower.xReferencePointId,'L:b');
  assert.equal(lower.yReferencePointId,'L:b');
  assert.deepEqual(lower.position,{x:90,y:15});
  assert.equal(inspection.profile.nativeExact,false);
});

test('add selected third hole anchored to authored corner; edit width, drag, reanchor, replay, remove',()=>{
  let {sketch,selection}=initial();
  const original=serializeSketch(sketch);
  let r=apply(sketch,selection,{kind:'add-hole',holeId:'L:holeThird',
    anchorPointId:'L:b',xMm:60,yMm:15,radiusMm:4});
  assert.equal(serializeSketch(sketch),original);
  assert.deepEqual(r.changedConstraintIds,
    ['L:holeThird:offsetX','L:holeThird:offsetY','L:holeThird:radius']);
  assert.deepEqual(r.offsetsMm,{x:-60,y:15});
  assert.equal(r.semanticProfileId,selection.candidateId);
  near(r.profile.profile.areaMm2,5600-66*Math.PI);
  sketch=r.sketch;selection=r.selection;
  let handles=inspectSelectedProfileHandles(sketch,selection);
  assert.equal(handles.kind,'selected_profile_handles');
  assert.equal(handles.holeCenters.length,3);
  assert.ok(handles.controls.some(h=>h.constraintId==='L:holeThird:radius'));
  const length=handles.controls.find(h=>h.constraintId==='L:length');
  const widened=editSelectedProfileHandle(sketch,selection,{
    kind:'set-dimension',sourceSignature:handles.sourceSignature,
    handleId:length.id,valueMm:150});
  assert.equal(widened.kind,'accepted',widened.reason);
  sketch=widened.sketch;selection=widened.selection;
  near(view(sketch,selection).holes.find(h=>h.holeId==='L:holeThird').position.x,90);
  near(view(sketch,selection).holes.find(h=>h.holeId==='L:holeLower').position.x,120);
  handles=inspectSelectedProfileHandles(sketch,selection);
  const drag=moveSelectedProfileHoleCenter(sketch,selection,{
    kind:'move-hole-center',sourceSignature:handles.sourceSignature,
    handleId:'hole-center:L:holeThird',xMm:95,yMm:15
  });
  assert.equal(drag.kind,'accepted',drag.reason);
  sketch=drag.sketch;selection=drag.selection;
  r=apply(sketch,selection,{kind:'reanchor-hole',holeId:'L:holeThird',
    anchorPointId:'L:a'});
  near(r.beforePosition.x,95);
  near(r.afterPosition.x,95);
  assert.deepEqual(r.offsetsMm,{x:95,y:15});
  sketch=parseSketch(serializeSketch(r.sketch));
  selection={...r.selection,sourceSignature:serializeSketch(sketch)};
  const reanchored=view(sketch,selection).holes.find(h=>h.holeId==='L:holeThird');
  assert.equal(reanchored.xReferencePointId,'L:a');
  assert.equal(reanchored.yReferencePointId,'L:a');
  const revision=editConstraint(sketch,'L:length',{value:160});
  const nextSelection={...selection,sourceSignature:serializeSketch(revision)};
  near(view(revision,nextSelection).holes.find(h=>h.holeId==='L:holeThird').position.x,95);
  near(view(revision,nextSelection).holes.find(h=>h.holeId==='L:holeLower').position.x,130);
  assert.equal(solveSketch(revision).status,'solved');
  r=apply(revision,nextSelection,{kind:'remove-hole',holeId:'L:holeThird'});
  assert.equal(r.afterPosition,null);
  assert.equal(r.profile.holeIds.length,2);
  near(r.profile.profile.areaMm2,6800-50*Math.PI);
  assert.equal(r.sketch.points.some(p=>p.id==='L:holeThird:center'),false);
  assert.equal(r.sketch.circles.some(c=>c.id==='L:holeThird'),false);
  assert.equal(r.sketch.constraints.some(c=>c.id.startsWith('L:holeThird:')),false);
  assert.equal(r.semanticProfileId,selection.candidateId);
  assert.equal(solveSketch(parseSketch(serializeSketch(r.sketch))).status,'solved');
  assert.equal(serializeSketch(initial().sketch),original); // original remains undoable
});

test('hole dependencies follow parent edits; removing parent is refused until child removed',()=>{
  let {sketch,selection}=initial();
  let result=apply(sketch,selection,{kind:'add-hole',holeId:'fixture:child',
    anchorPointId:'L:holeLowerCenter',xMm:65,yMm:15,radiusMm:4});
  sketch=result.sketch;selection=result.selection;
  const v=view(sketch,selection);
  const lower=v.holes.find(h=>h.holeId==='L:holeLower');
  assert.equal(lower.canRemove,false);
  assert.deepEqual(lower.dependentEntityIds,
    ['fixture:child:offsetX','fixture:child:offsetY']);
  const saved=serializeSketch(sketch);
  const blocked=editSelectedProfileHole(sketch,selection,{
    kind:'remove-hole',holeId:'L:holeLower',sourceSignature:saved});
  assert.equal(blocked.kind,'refused');
  assert.equal(blocked.reason,'hole_has_dependents');
  assert.equal(Object.hasOwn(blocked,'sketch'),false);
  assert.equal(serializeSketch(sketch),saved);
  const resized=editConstraint(sketch,'L:length',{value:150});
  const nextSelection={...selection,sourceSignature:serializeSketch(resized)};
  const after=view(resized,nextSelection);
  assert.deepEqual(after.holes.find(h=>h.holeId==='fixture:child').position,{x:95,y:15});
  result=apply(sketch,selection,{kind:'remove-hole',holeId:'fixture:child'});
  result=apply(result.sketch,result.selection,{kind:'remove-hole',holeId:'L:holeLower'});
  assert.deepEqual(result.profile.holeIds,['L:holeUpper']);
  assert.equal(solveSketch(result.sketch).status,'solved');
});

test('invalid, stale, colliding, off-profile and no-op edits fail atomically',()=>{
  const {sketch,selection}=initial(),stamp=serializeSketch(sketch);
  const base={kind:'add-hole',sourceSignature:stamp,holeId:'newHole',
    anchorPointId:'L:a',xMm:65,yMm:15,radiusMm:4};
  for(const [command,reason] of [
    [{...base,sourceSignature:'stale'},'stale_source'],
    [{...base,holeId:'L:holeLower'},'hole_id_collision'],
    [{...base,holeId:'L:a'},'hole_id_collision'],
    [{...base,holeId:'7bad'},'invalid_command'],
    [{...base,anchorPointId:'outside'},'unknown_selected_anchor'],
    [{...base,xMm:150},'profile_rejected_after_edit'],
    [{...base,xMm:90},'profile_rejected_after_edit'],
    [{...base,radiusMm:0},'invalid_hole_dimensions'],
    [{...base,xMm:Infinity},'invalid_hole_dimensions'],
    [{...base,extra:true},'invalid_command'],
    [{kind:'remove-hole',sourceSignature:stamp,holeId:'missing'},'hole_not_in_selected_profile'],
    [{kind:'reanchor-hole',sourceSignature:stamp,holeId:'L:holeLower',
      anchorPointId:'L:b'},'no_change'],
    [{kind:'reanchor-hole',sourceSignature:stamp,holeId:'L:holeLower',
      anchorPointId:'L:holeLowerCenter'},'self_reference']
  ]){
    const outcome=editSelectedProfileHole(sketch,selection,command);
    assert.equal(outcome.kind,'refused',JSON.stringify(command));
    assert.equal(outcome.reason,reason,JSON.stringify(command));
    assert.equal(Object.hasOwn(outcome,'sketch'),false);
  }
  assert.equal(serializeSketch(sketch),stamp);
});

test('unsolved and overconstrained selected source never enters hole authoring',()=>{
  const {sketch,selection}=initial();
  const bad=[
    createSketch({...sketch,constraints:sketch.constraints.filter(c=>c.id!=='L:length')}),
    createSketch({...sketch,constraints:[...sketch.constraints,
      {id:'opposite:length',kind:'distanceX',a:'L:a',b:'L:b',value:121}]})
  ];
  for(const doc of bad){
    const current={...selection,sourceSignature:serializeSketch(doc)};
    const inspection=inspectSelectedProfileHoleAuthoring(doc,current);
    assert.equal(inspection.kind,'refused');
    assert.equal(inspection.reason,'source_not_profile_ready');
    assert.equal(editSelectedProfileHole(doc,current,{
      kind:'add-hole',sourceSignature:serializeSketch(doc),holeId:'invalidNew',
      anchorPointId:'L:a',xMm:65,yMm:15,radiusMm:4
    }).kind,'refused');
  }
});

test('runnable selected-profile hole authoring example demonstrates replay',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const sample=fileURLToPath(new URL('../examples/selected-profile-hole-authoring.mjs',import.meta.url));
  const output=execFileSync(process.execPath,[sample],{encoding:'utf8'});
  assert.match(output,/selected_profile_hole_authoring_pass/);
});
