import test from 'node:test';
import assert from 'node:assert/strict';
import {roundedPlateArcFixture,serializeArcSketch,parseArcSketch}
  from '../arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection,
  inspectArcHoleControls} from '../arc-hole-authoring.mjs';
import {inspectArcProfileTools,editArcProfileWithTool}
  from '../arc-profile-tools.mjs';

const selection=()=>createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const current=(doc,selected)=>inspectArcProfileTools(doc,selected);
const commit=(doc,selected,command)=>{
  const before=current(doc,selected);
  return editArcProfileWithTool(doc,selected,command,{
    sourceSignature:before.sourceSignature,selectionSignature:before.selectionSignature});
};
const mustAccept=x=>{assert.equal(x.kind,'accepted',x.reason);return x;};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,a+' != '+b);

test('dragging actual hole centre and diameter commits solver-backed analytic profile once',()=>{
  const source=roundedPlateArcFixture(),selected=selection(),before=serializeArcSketch(source);
  const center=mustAccept(commit(source,selected,{kind:'drag-handle',
    handleId:'hole-center:holeA',xMm:30,yMm:48}));
  assert.equal(center.profile.id,'plate:main');
  assert.equal(center.gesture.handleId,'hole-center:holeA');
  assert.deepEqual(center.gesture.appliedPoint,{x:30,y:48});
  assert.equal(center.sketch.constraints.find(c=>c.id==='holeA:fixed').x,30);
  const diameter=mustAccept(commit(center.sketch,center.selection,{
    kind:'drag-handle',handleId:'hole-diameter:holeB',xMm:91,yMm:40}));
  close(diameter.profile.holes.find(h=>h.id==='holeB').radiusMm,6);
  assert.equal(diameter.profile.stepQualified,false);
  assert.equal(diameter.profile.exactBrepAvailable,false);
  assert.equal(serializeArcSketch(source),before);
});
test('radial diameter gesture works at a non-horizontal pointer position',()=>{
  const doc=roundedPlateArcFixture(),selected=selection();
  const result=mustAccept(commit(doc,selected,{kind:'drag-handle',
    handleId:'hole-diameter:holeA',xMm:35,yMm:50}));
  close(result.profile.holes.find(h=>h.id==='holeA').radiusMm,10);
  close(result.gesture.deviationMm,Math.hypot(10,-10));
});
test('selected holes translate simultaneously as one immutable journal candidate',()=>{
  const doc=roundedPlateArcFixture(),selected=selection();
  const before=current(doc,selected);
  const moved=mustAccept(commit(doc,selected,{kind:'translate-holes',
    circleIds:['holeA','holeB'],deltaXMm:5,deltaYMm:3}));
  assert.deepEqual(moved.movedHoleIds,['holeA','holeB']);
  assert.deepEqual(moved.profile.holes.map(h=>[h.id,h.x,h.y]),
    [['holeA',40,43],['holeB',90,43]]);
  assert.equal(moved.profile.id,before.profile.id);
  assert.deepEqual(moved.profile.boundary.map(c=>c.id),
    before.profile.boundary.map(c=>c.id));
  assert.equal(serializeArcSketch(doc),before.sourceSignature);
  const reopened=parseArcSketch(serializeArcSketch(moved.sketch));
  assert.deepEqual(current(reopened,selected).profile,moved.profile);
});
test('group move and resize refuse boundary contact, overlap and stale revision without mutations',()=>{
  const doc=roundedPlateArcFixture(),selected=selection(),original=serializeArcSketch(doc);
  const stamp=current(doc,selected);
  for(const command of [
    {kind:'translate-holes',circleIds:['holeA','holeB'],deltaXMm:-40,deltaYMm:0},
    {kind:'translate-holes',circleIds:['holeA','holeA'],deltaXMm:1,deltaYMm:0},
    {kind:'translate-holes',circleIds:['holeA','ghost'],deltaXMm:1,deltaYMm:0},
    {kind:'drag-handle',handleId:'hole-center:holeB',xMm:35,yMm:40},
    {kind:'drag-handle',handleId:'hole-diameter:holeA',xMm:35,yMm:40},
    {kind:'drag-handle',handleId:'hole-diameter:holeA',xMm:240,yMm:40},
    {kind:'drag-handle',handleId:'unknown:handle',xMm:35,yMm:40}
  ]){
    assert.equal(commit(doc,selected,command).kind,'refused',JSON.stringify(command));
    assert.equal(serializeArcSketch(doc),original);
  }
  const changed=mustAccept(commit(doc,selected,{kind:'translate-holes',
    circleIds:['holeA'],deltaXMm:2,deltaYMm:0}));
  const stale=editArcProfileWithTool(changed.sketch,selected,{
    kind:'drag-handle',handleId:'hole-center:holeB',xMm:88,yMm:42
  },{sourceSignature:stamp.sourceSignature,selectionSignature:stamp.selectionSignature});
  assert.equal(stale.kind,'refused');
  assert.match(stale.reason,/stale/);
});
test('shared authored references disable direct drag or group movement',()=>{
  const doc=roundedPlateArcFixture(),selected=selection();
  doc.constraints.push({id:'shared:distance',kind:'distanceX',
    a:'holeA:center',b:'holeB:center',value:50});
  assert.equal(inspectArcHoleControls(doc,selected).controls[0].canMove,false);
  const original=serializeArcSketch(doc);
  assert.equal(commit(doc,selected,{kind:'drag-handle',
    handleId:'hole-center:holeA',xMm:32,yMm:40}).kind,'refused');
  assert.equal(commit(doc,selected,{kind:'translate-holes',
    circleIds:['holeA','holeB'],deltaXMm:3,deltaYMm:0}).kind,'refused');
  assert.equal(serializeArcSketch(doc),original);
});
test('real package-imported direct manipulation example replays and rejects invalid intent',async()=>{
  const {execFileSync}=await import('node:child_process');
  const demo=new URL('../examples/arc-profile-direct-manipulation.mjs',import.meta.url);
  const stdout=execFileSync(process.execPath,
    [await import('node:url').then(m=>m.fileURLToPath(demo))],
    {encoding:'utf8',timeout:30000});
  const steps=stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.deepEqual(steps.map(x=>x.step),
    ['original','drag-hole-a','resize-hole-b','move-both',
      'retrospective-width','reopened','invalid-translation']);
  assert.equal(steps[5].profileId,'plate:main');
  assert.equal(steps[5].exactBrepAvailable,false);
  assert.equal(steps[6].kind,'refused');
});
