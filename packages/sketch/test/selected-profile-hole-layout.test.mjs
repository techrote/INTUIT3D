import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {editSelectedProfileHole} from '../selected-profile-hole-authoring.mjs';
import {SELECTED_PROFILE_HOLE_LAYOUT_VERSION,
  inspectSelectedProfileHoleLayout,editSelectedProfileHoleLayout}
  from '../selected-profile-hole-layout.mjs';

const start=()=>{
  const sketch=createDimensionedLPlateSketch();
  const selected=discoverPlateProfiles(sketch).candidates[0];
  return {sketch,selection:{candidateId:selected.id,
    sourceSignature:serializeSketch(sketch)}};
};
const control=(view,id)=>view.holes.find(h=>h.holeId===id);
const inspect=(sketch,selection)=>{
  const view=inspectSelectedProfileHoleLayout(sketch,selection);
  assert.equal(view.kind,'selected_profile_hole_layout',view.reason);
  return view;
};
const change=(sketch,selection,edits)=>{
  const result=editSelectedProfileHoleLayout(sketch,selection,{
    kind:'set-hole-layout',sourceSignature:serializeSketch(sketch),edits});
  assert.equal(result.kind,'accepted',result.reason+': '+result.detail);
  return result;
};
const near=(a,b)=>assert.ok(Math.abs(a-b)<=1e-8,`${a} != ${b}`);

test('v1 inspect exposes authentic hole XY/radius constraint ownership and dependencies',()=>{
  const {sketch,selection}=start(),view=inspect(sketch,selection);
  assert.equal(SELECTED_PROFILE_HOLE_LAYOUT_VERSION,1);
  assert.equal(view.holes.length,2);
  assert.equal(view.semanticProfileId,selection.candidateId);
  const lower=control(view,'L:holeLower');
  assert.equal(lower.canEdit,true);
  assert.deepEqual([lower.xConstraintId,lower.yConstraintId,
    lower.radiusConstraintId],['L:holeLowerOffsetX','L:holeLowerOffsetY',
    'L:holeLowerRadius']);
  assert.deepEqual(lower.position,{x:90,y:15});
  assert.equal(lower.radiusMm,5);
  assert.equal(lower.xReferencePointId,'L:b');
  assert.equal(view.nativeExact,false);
});

test('atomic swap + independent diameters cannot pass through sequential collision',()=>{
  const {sketch,selection}=start(),source=serializeSketch(sketch);
  const requested=[
    {holeId:'L:holeLower',xMm:20,yMm:60,radiusMm:4},
    {holeId:'L:holeUpper',xMm:90,yMm:15,radiusMm:6}
  ];
  const intermediate=editSelectedProfileHoleLayout(sketch,selection,{
    kind:'set-hole-layout',sourceSignature:source,edits:[requested[0]]});
  assert.equal(intermediate.kind,'refused');
  assert.equal(intermediate.reason,'profile_rejected_after_edit');
  assert.equal(Object.hasOwn(intermediate,'sketch'),false);
  const swap=change(sketch,selection,requested);
  assert.equal(serializeSketch(sketch),source);
  assert.equal(swap.semanticProfileId,selection.candidateId);
  assert.deepEqual(swap.affectedHoleIds,['L:holeLower','L:holeUpper']);
  assert.deepEqual(swap.changedConstraintIds,[
    'L:holeLowerOffsetX','L:holeLowerOffsetY','L:holeLowerRadius',
    'L:holeUpperOffsetX','L:holeUpperOffsetY','L:holeUpperRadius'
  ]);
  assert.deepEqual(swap.edits.map(e=>e.holeId),requested.map(e=>e.holeId));
  const updated=inspect(swap.sketch,swap.selection);
  assert.deepEqual(control(updated,'L:holeLower').position,{x:20,y:60});
  assert.deepEqual(control(updated,'L:holeUpper').position,{x:90,y:15});
  assert.equal(control(updated,'L:holeLower').radiusMm,4);
  assert.equal(control(updated,'L:holeUpper').radiusMm,6);
  const ids=doc=>[...doc.points,...doc.lines,...doc.circles,
    ...doc.constraints].map(x=>x.id);
  assert.deepEqual(ids(swap.sketch),ids(sketch));
  const restored=parseSketch(serializeSketch(swap.sketch));
  assert.equal(solveSketch(restored).status,'solved');
  assert.deepEqual(inspect(restored,swap.selection).holes,updated.holes);
  assert.deepEqual(parseSketch(source),sketch); // immutable source snapshot supports undo
  near(swap.profile.profile.areaMm2,5600-(16+36)*Math.PI);
  assert.equal(swap.profile.nativeExact,false);
  assert.equal(swap.independentStepQualified,false);
});

test('a dependent hole moves with parent; explicitly targeting both uses future anchors',()=>{
  let {sketch,selection}=start();
  const stamp=serializeSketch(sketch);
  const added=editSelectedProfileHole(sketch,selection,{
    kind:'add-hole',sourceSignature:stamp,holeId:'demo:child',
    anchorPointId:'L:holeLowerCenter',xMm:65,yMm:15,radiusMm:4});
  assert.equal(added.kind,'accepted',added.reason);
  sketch=added.sketch;selection=added.selection;
  const first=change(sketch,selection,[
    {holeId:'L:holeLower',xMm:100,yMm:18,radiusMm:5}
  ]);
  const inherited=inspect(first.sketch,first.selection);
  assert.deepEqual(control(inherited,'demo:child').position,{x:75,y:18});
  assert.deepEqual(first.affectedHoleIds,['L:holeLower','demo:child'].sort());
  const simultaneous=change(sketch,selection,[
    {holeId:'L:holeLower',xMm:100,yMm:18,radiusMm:5},
    {holeId:'demo:child',xMm:78,yMm:18,radiusMm:4}
  ]);
  assert.deepEqual(control(inspect(simultaneous.sketch,simultaneous.selection),
    'demo:child').position,{x:78,y:18});
  const child=simultaneous.edits.find(e=>e.holeId==='demo:child');
  assert.equal(child.xOffsetMm,-22);
  assert.equal(child.yOffsetMm,0);
  assert.equal(simultaneous.semanticProfileId,selection.candidateId);
  sketch=editConstraint(simultaneous.sketch,'L:length',{value:150});
  selection={candidateId:selection.candidateId,sourceSignature:serializeSketch(sketch)};
  const replay=inspect(parseSketch(serializeSketch(sketch)),selection);
  assert.deepEqual(control(replay,'L:holeLower').position,{x:130,y:18});
  assert.deepEqual(control(replay,'demo:child').position,{x:108,y:18});
});

test('retrospective width exposes a no-longer-selected hole until intent is explicitly reanchored',()=>{
  const {sketch,selection}=start();
  const edits=[
    {holeId:'L:holeLower',xMm:20,yMm:60,radiusMm:4},
    {holeId:'L:holeUpper',xMm:90,yMm:15,radiusMm:6}
  ];
  const swapped=change(sketch,selection,edits);
  const invalidWidth=editConstraint(swapped.sketch,'L:length',{value:150});
  const invalidSelection={candidateId:selection.candidateId,
    sourceSignature:serializeSketch(invalidWidth)};
  const view=inspect(invalidWidth,invalidSelection);
  // The lower hole's existing dimension references the right-hand length
  // endpoint; length+30 moves it from x=20 to x=50 outside the 40-mm web.
  assert.deepEqual(view.holes.map(h=>h.holeId),['L:holeUpper']);
  assert.equal(invalidWidth.circles.length,2); // intent remains intact
  const reanchored=editSelectedProfileHole(swapped.sketch,swapped.selection,{
    kind:'reanchor-hole',sourceSignature:swapped.nextSourceSignature,
    holeId:'L:holeLower',anchorPointId:'L:a'
  });
  assert.equal(reanchored.kind,'accepted',reanchored.reason);
  assert.deepEqual(reanchored.beforePosition,{x:20,y:60});
  assert.deepEqual(reanchored.afterPosition,{x:20,y:60});
  const fixedWidth=editConstraint(reanchored.sketch,'L:length',{value:150});
  const fixedSelection={candidateId:selection.candidateId,
    sourceSignature:serializeSketch(fixedWidth)};
  const restored=inspect(fixedWidth,fixedSelection);
  assert.equal(restored.holes.length,2);
  assert.deepEqual(control(restored,'L:holeLower').position,{x:20,y:60});
  assert.deepEqual(control(restored,'L:holeUpper').position,{x:90,y:15});
  assert.deepEqual(restored.holes.map(h=>h.holeId),[
    'L:holeLower','L:holeUpper']);
});

test('atomic XY/radius edit can explicitly reanchor a selected hole for a later width change',()=>{
  const {sketch,selection}=start(),stamp=serializeSketch(sketch);
  const result=editSelectedProfileHoleLayout(sketch,selection,{
    kind:'set-hole-layout',sourceSignature:stamp,edits:[
      {holeId:'L:holeLower',xMm:20,yMm:60,radiusMm:4,anchorPointId:'L:a'},
      {holeId:'L:holeUpper',xMm:90,yMm:15,radiusMm:6}
    ]});
  assert.equal(result.kind,'accepted',result.reason);
  assert.deepEqual(result.reanchoredHoleIds,['L:holeLower']);
  assert.deepEqual(result.edits.map(e=>e.xReferencePointId),['L:a','L:e']);
  assert.deepEqual(result.edits.map(e=>e.yReferencePointId),['L:a','L:e']);
  assert.equal(serializeSketch(sketch),stamp);
  const ids=d=>[...d.points,...d.lines,...d.circles,...d.constraints].map(e=>e.id);
  assert.deepEqual(ids(sketch),ids(result.sketch));
  const widened=editConstraint(result.sketch,'L:length',{value:150});
  const reopened=parseSketch(serializeSketch(widened));
  const view=inspect(reopened,{candidateId:selection.candidateId,
    sourceSignature:serializeSketch(reopened)});
  assert.deepEqual(view.holes.map(h=>h.holeId),['L:holeLower','L:holeUpper']);
  assert.deepEqual(control(view,'L:holeLower').position,{x:20,y:60});
  assert.deepEqual(control(view,'L:holeUpper').position,{x:90,y:15});
  assert.equal(control(view,'L:holeLower').xReferencePointId,'L:a');
});

test('invalid anchor edits refuse without changing original intent',()=>{
  const {sketch,selection}=start(),stamp=serializeSketch(sketch);
  for(const [anchor,reason] of [
    ['L:holeLowerCenter','self_reference'],['outside:point','unknown_selected_anchor']
  ]){
    const result=editSelectedProfileHoleLayout(sketch,selection,{
      kind:'set-hole-layout',sourceSignature:stamp,edits:[
        {holeId:'L:holeLower',xMm:85,yMm:15,radiusMm:5,anchorPointId:anchor}
      ]});
    assert.equal(result.kind,'refused');
    assert.equal(result.reason,reason);
    assert.equal(Object.hasOwn(result,'sketch'),false);
    assert.equal(serializeSketch(sketch),stamp);
  }
});

test('implicitly moved intermediary cannot silently change an explicit target',()=>{
  let {sketch,selection}=start();
  for(const [id,anchor,x,r] of [
    ['demo:child','L:holeLowerCenter',65,4],
    ['demo:grand','demo:child:center',40,3]]){
    const added=editSelectedProfileHole(sketch,selection,{
      kind:'add-hole',sourceSignature:serializeSketch(sketch),holeId:id,
      anchorPointId:anchor,xMm:x,yMm:15,radiusMm:r});
    assert.equal(added.kind,'accepted',added.reason);
    sketch=added.sketch;selection=added.selection;
  }
  const source=serializeSketch(sketch);
  const refused=editSelectedProfileHoleLayout(sketch,selection,{
    kind:'set-hole-layout',sourceSignature:source,edits:[
      {holeId:'L:holeLower',xMm:100,yMm:15,radiusMm:5},
      {holeId:'demo:grand',xMm:45,yMm:15,radiusMm:3}
    ]});
  assert.equal(refused.kind,'refused');
  assert.equal(refused.reason,'explicit_target_not_satisfied');
  assert.equal(refused.detail,'demo:grand');
  assert.equal(Object.hasOwn(refused,'sketch'),false);
  assert.equal(serializeSketch(sketch),source);
});

test('stale, duplicate, foreign, invalid and no-op layout edits are non-mutating',()=>{
  const {sketch,selection}=start(),stamp=serializeSketch(sketch);
  const lower={holeId:'L:holeLower',xMm:100,yMm:18,radiusMm:5};
  const cases=[
    [{kind:'set-hole-layout',sourceSignature:'stale',edits:[lower]},'stale_source'],
    [{kind:'set-hole-layout',sourceSignature:stamp,edits:[]},'invalid_command'],
    [{kind:'set-hole-layout',sourceSignature:stamp,edits:[lower,lower]},'duplicate_hole_id'],
    [{kind:'set-hole-layout',sourceSignature:stamp,
      edits:[{...lower,holeId:'L:missing'}]},'hole_not_in_selected_profile'],
    [{kind:'set-hole-layout',sourceSignature:stamp,edits:[{...lower,xMm:NaN}]},'invalid_command'],
    [{kind:'set-hole-layout',sourceSignature:stamp,edits:[{...lower,radiusMm:0}]},'invalid_command'],
    [{kind:'set-hole-layout',sourceSignature:stamp,edits:[{...lower,extra:true}]},'invalid_command'],
    [{kind:'set-hole-layout',sourceSignature:stamp,
      edits:[{holeId:'L:holeLower',xMm:90,yMm:15,radiusMm:5}]},'no_change'],
    [{kind:'set-hole-layout',sourceSignature:stamp,
      edits:[{...lower,xMm:118}]},'profile_rejected_after_edit'],
    [{kind:'set-hole-layout',sourceSignature:stamp,
      edits:[{...lower,radiusMm:20}]},'profile_rejected_after_edit']
  ];
  for(const [cmd,reason] of cases){
    const outcome=editSelectedProfileHoleLayout(sketch,selection,cmd);
    assert.equal(outcome.kind,'refused',reason);
    assert.equal(outcome.reason,reason);
    assert.equal(Object.hasOwn(outcome,'sketch'),false);
    assert.equal(serializeSketch(sketch),stamp);
  }
  const contradictory=createSketch({...sketch,constraints:[...sketch.constraints,
    {id:'L:conflict',kind:'distanceX',a:'L:a',b:'L:b',value:121}]});
  const under=editConstraint(sketch,'L:length',{value:120});
  under.constraints=under.constraints.filter(c=>c.id!=='L:length');
  for(const [invalid,status] of [
    [contradictory,'conflicted'],[under,'underconstrained']
  ]){
    const s={candidateId:selection.candidateId,sourceSignature:serializeSketch(invalid)};
    const inspection=inspectSelectedProfileHoleLayout(invalid,s);
    assert.equal(inspection.kind,'refused');
    assert.equal(inspection.sourceStatus,status);
    assert.equal(inspection.reason,'source_not_profile_ready');
    const proposed=editSelectedProfileHoleLayout(invalid,s,{
      kind:'set-hole-layout',sourceSignature:s.sourceSignature,edits:[lower]
    });
    assert.equal(proposed.kind,'refused');
    assert.equal(proposed.sourceStatus,status);
    assert.equal(Object.hasOwn(proposed,'sketch'),false);
  }
});

test('real selected-hole layout example exercises archive and undo',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const example=fileURLToPath(new URL('../examples/selected-profile-hole-layout.mjs',
    import.meta.url));
  const rows=execFileSync(process.execPath,[example],
    {encoding:'utf8',timeout:30000}).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row=>row.step),[
    'original','swap_holes','resize_outline','reopen','source_restore'
  ]);
  assert.equal(rows[1].lower.x,20);
  assert.equal(rows[1].upper.radiusMm,6);
  assert.equal(rows[2].lengthMm,150);
  assert.equal(rows[3].profileId,rows[0].profileId);
  assert.equal(rows[4].lower.x,90);
  assert.equal(rows[4].nativeExact,false);
});
