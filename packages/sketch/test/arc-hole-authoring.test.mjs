import test from 'node:test';
import assert from 'node:assert/strict';
import {roundedPlateArcFixture,editArcConstraint,solveArcSketch,
  serializeArcSketch,parseArcSketch} from '../arc-constraints.mjs';
import {prepareArcProfileForProvider} from '../arc-profile.mjs';
import {createArcHoleSelection,serializeArcHoleSelection,
  inspectArcHoleControls,editArcProfileHole} from '../arc-hole-authoring.mjs';

const boundaryIds=['bottom','arc1','right','arc2','top','arc3','left','arc0'];
const selection=()=>createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',boundaryIds,holeIds:['holeA','holeB']});
const revisions=(doc,selected)=>({
  sourceSignature:serializeArcSketch(doc),
  selectionSignature:serializeArcHoleSelection(selected)
});
const edit=(doc,selected,change)=>editArcProfileHole(doc,selected,change,revisions(doc,selected));
const add={kind:'add',circleId:'holeC',xMm:60,yMm:63,diameterMm:10};
const mustAccept=result=>{
  assert.equal(result.kind,'accepted',result.reason);
  assert.equal(result.solution.status,'solved');
  assert.equal(result.solution.degreesOfFreedom,0);
  assert.equal(result.profile.providerSubmissionReady,true);
  assert.equal(result.profile.nativeProfileAdmissible,false);
  assert.equal(result.profile.stepQualified,false);
  return result;
};

test('authored add → move → resize → retrospective width edit → save/reopen → remove retains profile identity',()=>{
  const original=roundedPlateArcFixture(),selected=selection();
  const initial=prepareArcProfileForProvider(original,solveArcSketch(original),
    {profileId:selected.profileId,boundaryIds,holeIds:selected.holeIds});
  const before=serializeArcSketch(original);
  let result=mustAccept(edit(original,selected,add));
  assert.equal(result.profile.holes.length,3);
  assert.equal(result.selection.profileId,initial.id);
  assert.deepEqual(result.profile.holes.map(h=>h.id),['holeA','holeB','holeC']);
  assert.equal(serializeArcSketch(original),before);
  assert.equal(result.sketch.points.at(-1).id,'hole.holeC.center');
  assert.equal(result.sketch.constraints.at(-1).id,'hole.holeC.fixed');
  let moved=mustAccept(edit(result.sketch,result.selection,
    {kind:'move',circleId:'holeC',xMm:60,yMm:20}));
  let resized=mustAccept(edit(moved.sketch,moved.selection,
    {kind:'resize',circleId:'holeC',diameterMm:14}));
  assert.deepEqual(inspectArcHoleControls(resized.sketch,resized.selection).controls.at(-1),
    {id:'holeC',centerPointId:'hole.holeC.center',
      centerConstraintId:'hole.holeC.fixed',xMm:60,yMm:20,diameterMm:14,
      canMove:true,canResize:true});
  const widened=editArcConstraint(resized.sketch,'plate:width',{value:150});
  const p=prepareArcProfileForProvider(widened,solveArcSketch(widened),
    {profileId:resized.selection.profileId,boundaryIds,
      holeIds:resized.selection.holeIds});
  assert.equal(p.id,initial.id);
  assert.deepEqual(p.boundary.map(c=>c.id),initial.boundary.map(c=>c.id));
  assert.notEqual(p.materialAreaMm2,initial.materialAreaMm2);
  const reopened=parseArcSketch(serializeArcSketch(widened));
  const replay=mustAccept(edit(reopened,resized.selection,
    {kind:'remove',circleId:'holeC'}));
  assert.deepEqual(replay.selection.holeIds,['holeA','holeB']);
  assert.deepEqual(replay.profile.holes.map(h=>h.id),['holeA','holeB']);
  assert.equal(replay.sketch.points.some(p=>p.id==='hole.holeC.center'),false);
  assert.equal(replay.sketch.constraints.some(c=>c.id==='hole.holeC.fixed'),false);
  assert.deepEqual(replay.sketch.circles.map(c=>c.id),['holeA','holeB']);
  assert.deepEqual(edit(original,selected,add).profile,
    edit(parseArcSketch(before),selected,add).profile);
});

test('real invalid overlapping or boundary-piercing circles never become committed profile geometry',()=>{
  const doc=roundedPlateArcFixture(),selected=selection(),before=serializeArcSketch(doc);
  for(const bad of [
    {kind:'add',circleId:'holeC',xMm:35,yMm:40,diameterMm:12},
    {kind:'add',circleId:'holeC',xMm:3,yMm:40,diameterMm:12},
    {kind:'add',circleId:'holeC',xMm:60,yMm:60,diameterMm:0}
  ]){
    const outcome=edit(doc,selected,bad);
    assert.equal(outcome.kind,'refused',JSON.stringify(outcome));
    assert.equal(serializeArcSketch(doc),before);
    assert.deepEqual(selected.holeIds,['holeA','holeB']);
  }
  const accepted=mustAccept(edit(doc,selected,add));
  assert.equal(edit(accepted.sketch,accepted.selection,
    {kind:'move',circleId:'holeC',xMm:35,yMm:40}).kind,'refused');
  assert.equal(edit(accepted.sketch,accepted.selection,
    {kind:'resize',circleId:'holeC',diameterMm:120}).kind,'refused');
});

test('stale revision, duplicate ID and altered selection are explicit refusals',()=>{
  const doc=roundedPlateArcFixture(),selected=selection(),expected=revisions(doc,selected);
  const updated=editArcConstraint(doc,'plate:width',{value:150});
  assert.match(editArcProfileHole(updated,selected,add,expected).reason,/stale/);
  assert.match(editArcProfileHole(doc,{...selected,holeIds:['holeA']},add,expected).reason,/stale/);
  assert.match(edit(doc,selected,{...add,circleId:'holeA'}).reason,/already authored/);
  assert.match(edit(doc,selected,{...add,notAuthoritative:true}).reason,/invalid authored/);
  const edited=mustAccept(edit(doc,selected,add));
  assert.match(editArcProfileHole(edited.sketch,edited.selection,{kind:'remove',circleId:'holeC'},expected).reason,/stale/);
});

test('underconstrained sketch refuses addition; remove can recover a previously invalid hole',()=>{
  const doc=roundedPlateArcFixture(),selected=selection();
  doc.constraints=doc.constraints.filter(c=>c.id!=='corner1:radius');
  const outcome=edit(doc,selected,add);
  assert.equal(outcome.kind,'refused');
  assert.match(outcome.reason,/underconstrained/);
  const valid=mustAccept(edit(roundedPlateArcFixture(),selected,add));
  const conflicted=structuredClone(valid.sketch);
  conflicted.circles.find(c=>c.id==='holeC').radiusMm=75;
  const repaired=mustAccept(edit(conflicted,valid.selection,{kind:'remove',circleId:'holeC'}));
  assert.equal(repaired.profile.holes.length,2);
});

test('shared centre dependency is refused rather than deleting or relocating authored entities',()=>{
  const doc=roundedPlateArcFixture(),selected=selection();
  const shared=structuredClone(doc);
  shared.constraints.push({id:'extra:fixed',kind:'fixed',point:'holeA:center',x:35,y:40});
  const movable=inspectArcHoleControls(shared,selected);
  assert.equal(movable.controls[0].canMove,false);
  assert.match(edit(shared,selected,{kind:'move',circleId:'holeA',xMm:34,yMm:40}).reason,/not independently editable/);
  const linked=structuredClone(doc);
  linked.constraints.push({id:'shared:distance',kind:'distanceX',a:'holeA:center',b:'holeB:center',value:50});
  assert.match(edit(linked,selected,{kind:'remove',circleId:'holeA'}).reason,/referenced/);
  assert.equal(linked.circles.length,2);
});

test('selection schema rejects malformed or duplicated semantic identity',()=>{
  const selected=selection();
  assert.throws(()=>createArcHoleSelection({...selected,holeIds:['holeA','holeA']}),/selection/);
  assert.throws(()=>createArcHoleSelection({...selected,extra:'foo'}),/selection/);
  assert.throws(()=>createArcHoleSelection({...selected,profileId:'bad id'}),/selection/);
});
