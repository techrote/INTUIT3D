import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {roundedPlateArcFixture,editArcConstraint,serializeArcSketch,
  parseArcSketch} from '../arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection} from '../arc-hole-authoring.mjs';
import {proposeArcBoltCircle,inspectArcBoltCircleControls,
  serializeArcBoltCircle,parseArcBoltCircle} from '../arc-bolt-circle.mjs';
const selection=()=>createArcHoleSelection({
  format:'intuit3d.arc-hole-selection',version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const stamp=(s,a,p)=>({
  sourceSignature:serializeArcSketch(s),selectionSignature:serializeArcHoleSelection(a),
  patternSignature:p?serializeArcBoltCircle(p):null});
const apply=(s,a,p,cmd)=>proposeArcBoltCircle(s,a,p,cmd,stamp(s,a,p));
const accept=result=>{assert.equal(result.kind,'accepted',result.reason);
  assert.equal(result.solution.status,'solved');
  assert.equal(result.profile.providerSubmissionReady,true);
  assert.equal(result.profile.exactBrepAvailable,false);
  return result;};
const create=()=>accept(apply(roundedPlateArcFixture(),selection(),null,{
  kind:'create',id:'boltCircle',sourceCircleId:'holeA',
  centerXMm:35,centerYMm:25,count:3}));
const numeric={kind:'edit-layout',count:4,centerXMm:35,centerYMm:25,
  pitchDiameterMm:32,phaseDeg:45,holeDiameterMm:8};
test('numeric layout changes count/pitch/phase/hole dimension with stable profile IDs',()=>{
  const initial=create();
  const initialControls=inspectArcBoltCircleControls(initial.sketch,initial.selection,initial.pattern);
  assert.equal(initialControls.canEdit,true);
  assert.equal(initialControls.dimensions.pitchDiameterMm,30);
  assert.equal(initialControls.dimensions.phaseDeg,90);
  assert.deepEqual(initialControls.handles.map(h=>h.id),['boltCircle:center','boltCircle:pitch']);
  const next=accept(apply(initial.sketch,initial.selection,initial.pattern,numeric));
  const controls=inspectArcBoltCircleControls(next.sketch,next.selection,next.pattern);
  assert.deepEqual(next.createdIds,['boltCircle:i3']);
  assert.deepEqual(next.preservedIds,['boltCircle:i1','boltCircle:i2']);
  assert.equal(next.profile.id,initial.profile.id);
  assert.equal(next.profile.holes.length,5);
  assert.ok(Math.abs(controls.dimensions.pitchDiameterMm-32)<1e-10);
  assert.ok(Math.abs(controls.dimensions.phaseDeg-45)<1e-10);
  assert.equal(controls.dimensions.holeDiameterMm,8);
  const reopened=parseArcSketch(serializeArcSketch(next.sketch));
  const record=parseArcBoltCircle(serializeArcBoltCircle(next.pattern));
  const selected=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(next.selection)));
  assert.equal(inspectArcBoltCircleControls(reopened,selected,record).canEdit,true);
  const widened=editArcConstraint(reopened,'plate:width',{value:150});
  const refreshed=accept(apply(widened,selected,record,{kind:'refresh'}));
  assert.equal(refreshed.profile.id,next.profile.id);
  assert.equal(refreshed.profile.holes.length,5);
});
test('pointer pitch/centre drags preserve member identity and reject overlap atomically',()=>{
  let x=create();
  x=accept(apply(x.sketch,x.selection,x.pattern,numeric));
  const before=serializeArcSketch(x.sketch);
  const pitch=accept(apply(x.sketch,x.selection,x.pattern,{
    kind:'drag-handle',handleId:'boltCircle:pitch',xMm:45,yMm:40}));
  assert.equal(serializeArcSketch(x.sketch),before);
  const moved=accept(apply(pitch.sketch,pitch.selection,pitch.pattern,{
    kind:'drag-handle',handleId:'boltCircle:center',xMm:38,yMm:27}));
  const state=inspectArcBoltCircleControls(moved.sketch,moved.selection,moved.pattern);
  assert.deepEqual(state.dimensions.centerXMm,38);
  assert.deepEqual(state.dimensions.centerYMm,27);
  assert.ok(Math.abs(state.handles[1].xMm-48)<1e-10);
  assert.ok(Math.abs(state.handles[1].yMm-42)<1e-10);
  assert.deepEqual(moved.preservedIds,['boltCircle:i1','boltCircle:i2','boltCircle:i3']);
  const original=serializeArcSketch(moved.sketch);
  for(const cmd of [
    {...numeric,pitchDiameterMm:8,holeDiameterMm:10},
    {kind:'drag-handle',handleId:'boltCircle:missing',xMm:1,yMm:2},
    {kind:'drag-handle',handleId:'boltCircle:pitch',xMm:38,yMm:27}
  ]){
    const refused=apply(moved.sketch,moved.selection,moved.pattern,cmd);
    assert.equal(refused.kind,'refused',JSON.stringify(cmd));
    assert.equal(serializeArcSketch(moved.sketch),original);
  }
  const stale=proposeArcBoltCircle(moved.sketch,moved.selection,moved.pattern,{
    kind:'drag-handle',handleId:'boltCircle:pitch',xMm:43,yMm:38},
    stamp(roundedPlateArcFixture(),selection(),null));
  assert.equal(stale.kind,'refused');
  assert.match(stale.reason,/stale/);
});
test('layout command is a real runnable package-level consumer, not native evidence',()=>{
  const file=fileURLToPath(new URL('../examples/bolt-circle-direct-layout.mjs',import.meta.url));
  const steps=execFileSync(process.execPath,[file],{encoding:'utf8',timeout:30000})
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(steps.map(x=>x.step),['create','numeric','pitch','center',
    'widen','reopen','refuse']);
  assert.equal(steps[5].nativeExact,false);
  assert.equal(steps[5].stepQualified,false);
  assert.equal(steps[6].kind,'refused');
});
