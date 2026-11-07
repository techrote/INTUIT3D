import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {editSelectedProfileHole} from '../selected-profile-hole-authoring.mjs';
import {editSelectedProfileHandle,inspectSelectedProfileHandles}
  from '../selected-profile-handles.mjs';
import {SELECTED_LINEAR_HOLE_PATTERN_VERSION,inspectSelectedLinearHolePattern,
  editSelectedLinearHolePattern} from '../selected-linear-hole-pattern.mjs';

const initial=()=>{
  const sketch=createDimensionedLPlateSketch();
  const found=discoverPlateProfiles(sketch);
  return {sketch,selection:{candidateId:found.candidates[0].id,
    sourceSignature:found.inputSignature}};
};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,String(a)+' != '+String(b));
function accepted(sketch,selection,command){
  const result=editSelectedLinearHolePattern(sketch,selection,{
    ...command,sourceSignature:serializeSketch(sketch)});
  assert.equal(result.kind,'accepted',String(result.reason)+': '+String(result.detail));
  return result;
}
const create={kind:'create-pattern',patternId:'L:array',anchorPointId:'L:b',
  firstXmm:52,firstYmm:15,pitchXmm:14,pitchYmm:0,radiusMm:3,count:2};
const set={kind:'set-pattern',patternId:'L:array',pitchXmm:12,
  pitchYmm:0,radiusMm:4,count:3};
const positions=r=>r.pattern.members.map(m=>m.position.x);

test('one transaction creates a selected, solved linked hole array with durable identities',()=>{
  const {sketch,selection}=initial();
  const base=serializeSketch(sketch);
  const result=accepted(sketch,selection,create);
  assert.equal(SELECTED_LINEAR_HOLE_PATTERN_VERSION,1);
  assert.equal(serializeSketch(sketch),base,'source mutated');
  assert.deepEqual(positions(result),[52,66]);
  assert.equal(result.pattern.anchorPointId,'L:b');
  assert.deepEqual(result.profile.holeIds.slice().sort(),
    ['L:array:hole:0','L:array:hole:1','L:holeLower','L:holeUpper'].sort());
  near(result.profile.profile.areaMm2,5600-68*Math.PI);
  const second=result.sketch.constraints.find(c=>c.id==='L:array:hole:1:offsetX');
  assert.equal(second.a,'L:array:hole:0:center');
  assert.equal(second.value,14);
  assert.equal(solveSketch(result.sketch).status,'solved');
  const replay=parseSketch(serializeSketch(result.sketch));
  const next=inspectSelectedLinearHolePattern(replay,{
    ...result.selection,sourceSignature:serializeSketch(replay)},'L:array');
  assert.equal(next.kind,'selected_linear_hole_pattern',next.reason);
  assert.deepEqual(next.members.map(m=>m.position.x),[52,66]);
  assert.equal(next.semanticProfileId,result.semanticProfileId);
});

test('retrospective pattern spacing, radius and count edit follows a moved parent corner',()=>{
  const {sketch,selection}=initial();
  let result=accepted(sketch,selection,create);
  result=accepted(result.sketch,result.selection,set);
  assert.deepEqual(positions(result),[52,64,76]);
  assert.equal(result.changedConstraintIds.includes('L:array:hole:0:radius'),true);
  near(result.profile.profile.areaMm2,5600-98*Math.PI);
  const ids=result.pattern.members.map(m=>m.holeId);
  const handles=inspectSelectedProfileHandles(result.sketch,result.selection);
  assert.equal(handles.kind,'selected_profile_handles');
  const wider=editSelectedProfileHandle(result.sketch,result.selection,{
    kind:'set-dimension',sourceSignature:handles.sourceSignature,
    handleId:'dimension:L:length',valueMm:150});
  assert.equal(wider.kind,'accepted',wider.reason);
  const widened=inspectSelectedLinearHolePattern(wider.sketch,wider.selection,'L:array');
  assert.equal(widened.kind,'selected_linear_hole_pattern',widened.reason);
  assert.deepEqual(widened.members.map(m=>m.holeId),ids);
  assert.deepEqual(widened.members.map(m=>m.position.x),[82,94,106]);
  assert.equal(solveSketch(wider.sketch).status,'solved');
  const save=parseSketch(serializeSketch(wider.sketch));
  const reopened=inspectSelectedLinearHolePattern(save,
    {...wider.selection,sourceSignature:serializeSketch(save)},'L:array');
  assert.deepEqual(reopened.members.map(m=>m.position.x),[82,94,106]);
  assert.equal(serializeSketch(initial().sketch),serializeSketch(sketch));
});

test('shrinking or removing an array never deletes independently authored downstream hole constraints',()=>{
  const {sketch,selection}=initial();
  let r=accepted(sketch,selection,create);
  r=accepted(r.sketch,r.selection,set);
  const handles=inspectSelectedProfileHandles(r.sketch,r.selection);
  const widen=editSelectedProfileHandle(r.sketch,r.selection,{
    kind:'set-dimension',sourceSignature:handles.sourceSignature,
    handleId:'dimension:L:length',valueMm:150});
  assert.equal(widen.kind,'accepted',widen.reason);
  const withChild=editSelectedProfileHole(widen.sketch,widen.selection,{
    kind:'add-hole',sourceSignature:serializeSketch(widen.sketch),
    holeId:'L:dependent',anchorPointId:'L:array:hole:2:center',
    xMm:135,yMm:15,radiusMm:3
  });
  assert.equal(withChild.kind,'accepted',withChild.reason);
  const source=serializeSketch(withChild.sketch);
  const refused=editSelectedLinearHolePattern(withChild.sketch,withChild.selection,{
    ...set,count:2,sourceSignature:source});
  assert.equal(refused.kind,'refused');
  assert.equal(refused.reason,'pattern_has_dependents');
  assert.match(refused.detail,/L:dependent:offsetX/);
  assert.equal(Object.hasOwn(refused,'sketch'),false);
  assert.equal(serializeSketch(withChild.sketch),source);
  const removedChild=editSelectedProfileHole(withChild.sketch,withChild.selection,{
    kind:'remove-hole',sourceSignature:source,holeId:'L:dependent'});
  assert.equal(removedChild.kind,'accepted');
  const shorter=accepted(removedChild.sketch,removedChild.selection,{...set,count:2});
  assert.deepEqual(positions(shorter),[82,94]);
  const removed=accepted(shorter.sketch,shorter.selection,{
    kind:'remove-pattern',patternId:'L:array'});
  assert.equal(removed.pattern,null);
  assert.deepEqual(removed.profile.holeIds,['L:holeLower','L:holeUpper']);
  assert.equal(removed.sketch.circles.some(c=>c.id.startsWith('L:array:')),false);
  assert.equal(solveSketch(parseSketch(serializeSketch(removed.sketch))).status,'solved');
});

test('stale, invalid, colliding, off-profile and conflicting proposals are failure-atomic',()=>{
  const {sketch,selection}=initial(),stamp=serializeSketch(sketch);
  for(const [input,reason] of [
    [{...create,sourceSignature:'stale'},'stale_source'],
    [{...create,sourceSignature:stamp,anchorPointId:'invalid'},'unknown_selected_anchor'],
    [{...create,sourceSignature:stamp,patternId:'7bad'},'invalid_command'],
    [{...create,sourceSignature:stamp,count:1},'invalid_pattern_dimensions'],
    [{...create,sourceSignature:stamp,pitchXmm:0},'invalid_pattern_dimensions'],
    [{...create,sourceSignature:stamp,pitchXmm:35,count:3},'profile_rejected_after_edit'],
    [{...create,sourceSignature:stamp,radiusMm:8},'profile_rejected_after_edit'],
    [{...create,sourceSignature:stamp,extra:true},'invalid_command']
  ]){
    const result=editSelectedLinearHolePattern(sketch,selection,input);
    assert.equal(result.kind,'refused',JSON.stringify(input));
    assert.equal(result.reason,reason,JSON.stringify(input));
    assert.equal(Object.hasOwn(result,'sketch'),false);
    assert.equal(serializeSketch(sketch),stamp);
  }
  const added=accepted(sketch,selection,create);
  const duplicate=editSelectedLinearHolePattern(added.sketch,added.selection,{
    ...create,sourceSignature:serializeSketch(added.sketch)});
  assert.equal(duplicate.kind,'refused');
  assert.equal(duplicate.reason,'pattern_id_collision');
  const noChange=editSelectedLinearHolePattern(added.sketch,added.selection,{
    kind:'set-pattern',sourceSignature:serializeSketch(added.sketch),
    patternId:'L:array',pitchXmm:14,pitchYmm:0,radiusMm:3,count:2});
  assert.equal(noChange.reason,'no_change');
});

test('underconstrained/contradictory source is never promoted to array authoring',()=>{
  const {sketch,selection}=initial();
  for(const bad of [
    createSketch({...sketch,constraints:sketch.constraints.filter(c=>c.id!=='L:length')}),
    createSketch({...sketch,constraints:[...sketch.constraints,
      {id:'L:contradiction',kind:'distanceX',a:'L:a',b:'L:b',value:121}]})
  ]){
    const s={...selection,sourceSignature:serializeSketch(bad)};
    const result=editSelectedLinearHolePattern(bad,s,{
      ...create,sourceSignature:serializeSketch(bad)});
    assert.equal(result.kind,'refused');
    assert.equal(Object.hasOwn(result,'sketch'),false);
  }
});

test('runnable linear-hole-pattern example demonstrates real authored replay',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const path=fileURLToPath(new URL('../examples/selected-linear-hole-pattern.mjs',import.meta.url));
  assert.match(execFileSync(process.execPath,[path],{encoding:'utf8'}),
    /selected_linear_hole_pattern_pass/);
});
