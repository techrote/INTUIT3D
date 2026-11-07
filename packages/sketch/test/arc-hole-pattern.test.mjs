import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {roundedPlateArcFixture,editArcConstraint,serializeArcSketch,
  parseArcSketch} from '../arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection,
  editArcProfileHole} from '../arc-hole-authoring.mjs';
import {editArcProfileWithTool} from '../arc-profile-tools.mjs';
import {createArcHolePattern,serializeArcHolePattern,parseArcHolePattern,
  inspectArcHolePattern,proposeArcHolePattern,adoptArcHolePattern}
  from '../arc-hole-pattern.mjs';

const selection=()=>createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const request={kind:'create',id:'boltGrid',sourceCircleId:'holeA',
  rows:2,columns:2,spacingXmm:20,spacingYmm:20};
const stamp=(doc,sel,pattern=null)=>({
  sourceSignature:serializeArcSketch(doc),
  selectionSignature:serializeArcHoleSelection(sel),
  patternSignature:pattern?serializeArcHolePattern(pattern):null
});
const apply=(doc,sel,pattern,change)=>proposeArcHolePattern(
  doc,sel,pattern,change,stamp(doc,sel,pattern));
const accepted=result=>{
  assert.equal(result.kind,'accepted',result.reason);
  assert.equal(result.solution.status,'solved');
  assert.equal(result.solution.degreesOfFreedom,0);
  assert.equal(result.profile.providerSubmissionReady,true);
  assert.equal(result.profile.exactBrepAvailable,false);
  assert.equal(result.profile.stepQualified,false);
  assert.equal(result.nativeExact,false);
  return result;
};

test('associative 2x2 pattern solves in one proposal with stable source and derived IDs',()=>{
  const doc=roundedPlateArcFixture(),sel=selection();
  const original=serializeArcSketch(doc);
  const result=accepted(apply(doc,sel,null,request));
  assert.deepEqual(result.createdIds,
    ['boltGrid:r0c1','boltGrid:r1c0','boltGrid:r1c1']);
  assert.deepEqual(result.selection.holeIds,
    ['holeA','holeB','boltGrid:r0c1','boltGrid:r1c0','boltGrid:r1c1']);
  assert.equal(inspectArcHolePattern(result.sketch,result.selection,result.pattern).status,
    'synchronized');
  assert.equal(result.pattern.seedSnapshot.radiusMm,6);
  assert.equal(result.profile.id,'plate:main');
  assert.equal(serializeArcSketch(doc),original);
  assert.deepEqual(sel.holeIds,['holeA','holeB']);
});

test('move+resize source and pattern are one atomic nonlinear solve; stable child IDs',()=>{
  const initial=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  const changed=accepted(apply(initial.sketch,initial.selection,initial.pattern,
    {kind:'edit-seed',xMm:40,yMm:35,diameterMm:10}));
  assert.deepEqual(changed.createdIds,[]);
  assert.deepEqual(changed.removedIds,[]);
  assert.equal(changed.preservedIds.length,3);
  assert.equal(changed.profile.holes.find(h=>h.id==='boltGrid:r1c1').radiusMm,5);
  assert.deepEqual(changed.profile.holes.find(h=>h.id==='boltGrid:r1c1'),
    {id:'boltGrid:r1c1',centerId:'hole.boltGrid:r1c1.center',
      x:60,y:55,radiusMm:5});
  assert.equal(changed.profile.id,initial.profile.id);
  assert.deepEqual(changed.profile.boundary.map(c=>c.id),
    initial.profile.boundary.map(c=>c.id));
  assert.equal(inspectArcHolePattern(changed.sketch,changed.selection,changed.pattern).status,
    'synchronized');
});

test('reconfigure expands, shrinks, and replays across archive and old width edits',()=>{
  let state=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  state=accepted(apply(state.sketch,state.selection,state.pattern,
    {kind:'edit-seed',xMm:40,yMm:35,diameterMm:10}));
  const expanded=accepted(apply(state.sketch,state.selection,state.pattern,
    {kind:'reconfigure',rows:2,columns:3,spacingXmm:16,spacingYmm:20}));
  assert.deepEqual(expanded.createdIds,['boltGrid:r0c2','boltGrid:r1c2']);
  assert.deepEqual(expanded.preservedIds,
    ['boltGrid:r0c1','boltGrid:r1c0','boltGrid:r1c1']);
  assert.equal(expanded.profile.holes.length,7);
  const shrink=accepted(apply(expanded.sketch,expanded.selection,expanded.pattern,
    {kind:'reconfigure',rows:1,columns:2,spacingXmm:16,spacingYmm:20}));
  assert.deepEqual(shrink.createdIds,[]);
  assert.deepEqual(new Set(shrink.removedIds),
    new Set(['boltGrid:r0c2','boltGrid:r1c0','boltGrid:r1c1','boltGrid:r1c2']));
  assert.deepEqual(shrink.preservedIds,['boltGrid:r0c1']);
  assert.deepEqual(shrink.profile.holes.map(h=>h.id),
    ['holeA','holeB','boltGrid:r0c1']);
  const reopened=parseArcSketch(serializeArcSketch(shrink.sketch));
  const reopenSel=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(shrink.selection)));
  const reopenPattern=parseArcHolePattern(serializeArcHolePattern(shrink.pattern));
  assert.equal(inspectArcHolePattern(reopened,reopenSel,reopenPattern).status,
    'synchronized');
  const widened=editArcConstraint(reopened,'plate:width',{value:150});
  const replay=accepted(apply(widened,reopenSel,reopenPattern,{kind:'refresh'}));
  assert.equal(replay.profile.id,shrink.profile.id);
  assert.equal(replay.profile.holes.length,3);
  assert.notEqual(replay.profile.materialAreaMm2,shrink.profile.materialAreaMm2);
  assert.equal(replay.profile.boundary.length,shrink.profile.boundary.length);
});

test('refresh catches externally edited seed and propagates radius without overriding child edits',()=>{
  const initial=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  const edited=editArcProfileHole(initial.sketch,initial.selection,
    {kind:'resize',circleId:'holeA',diameterMm:10},{
      sourceSignature:serializeArcSketch(initial.sketch),
      selectionSignature:serializeArcHoleSelection(initial.selection)});
  assert.equal(edited.kind,'accepted',edited.reason);
  assert.equal(inspectArcHolePattern(edited.sketch,edited.selection,initial.pattern).status,
    'seed_changed');
  const repaired=accepted(apply(edited.sketch,edited.selection,
    initial.pattern,{kind:'refresh'}));
  assert.equal(repaired.profile.holes.find(h=>h.id==='boltGrid:r1c1').radiusMm,5);
  assert.equal(inspectArcHolePattern(repaired.sketch,repaired.selection,repaired.pattern).status,
    'synchronized');
});

test('manual modification of derived instance fails closed rather than erasing authored intent',()=>{
  const initial=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  const edited=editArcProfileHole(initial.sketch,initial.selection,
    {kind:'move',circleId:'boltGrid:r1c1',xMm:60,yMm:65},{
      sourceSignature:serializeArcSketch(initial.sketch),
      selectionSignature:serializeArcHoleSelection(initial.selection)});
  assert.equal(edited.kind,'accepted',edited.reason);
  const view=inspectArcHolePattern(edited.sketch,edited.selection,initial.pattern);
  assert.equal(view.status,'unresolved');
  assert.match(view.reason,/changed or missing/);
  const result=apply(edited.sketch,edited.selection,initial.pattern,{kind:'refresh'});
  assert.equal(result.kind,'refused');
  assert.match(result.reason,/changed or missing/);
});

test('real overlap, boundary piercing, and foreign references refuse without mutation',()=>{
  const initial=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  const before=serializeArcSketch(initial.sketch);
  const bad=[
    {kind:'reconfigure',rows:2,columns:2,spacingXmm:0,spacingYmm:0},
    {kind:'reconfigure',rows:2,columns:2,spacingXmm:80,spacingYmm:20},
    {kind:'edit-seed',xMm:85,yMm:40,diameterMm:12},
    {kind:'reconfigure',rows:8,columns:8,spacingXmm:20,spacingYmm:20},
    {kind:'reconfigure',rows:2,columns:2,spacingXmm:NaN,spacingYmm:20}
  ];
  for(const command of bad){
    const refused=apply(initial.sketch,initial.selection,initial.pattern,command);
    assert.equal(refused.kind,'refused',JSON.stringify(command));
    assert.equal(serializeArcSketch(initial.sketch),before);
  }
  const foreign=structuredClone(initial.sketch);
  foreign.constraints.push({id:'other:ref',kind:'distanceX',
    a:'hole.boltGrid:r1c1.center',b:'holeB:center',value:25});
  assert.match(apply(foreign,initial.selection,initial.pattern,{
    kind:'reconfigure',rows:1,columns:2,spacingXmm:20,spacingYmm:20}).reason,
    /other authored dependencies/);
});

test('revision fencing rejects stale/skewed pattern records and identity collision',()=>{
  const doc=roundedPlateArcFixture(),sel=selection();
  const old=stamp(doc,sel,null);
  const initial=accepted(apply(doc,sel,null,request));
  assert.match(proposeArcHolePattern(initial.sketch,initial.selection,
    initial.pattern,{kind:'refresh'},old).reason,/stale/);
  assert.match(proposeArcHolePattern(doc,sel,null,request,{
    ...old,selectionSignature:'other'}).reason,/stale/);
  assert.match(proposeArcHolePattern(doc,sel,null,{...request,extra:true},old).reason,
    /create command/);
  assert.throws(()=>createArcHolePattern({...initial.pattern,version:2}),/versioned/);
  const colliding=structuredClone(doc);
  colliding.points.push({id:'hole.boltGrid:r0c1.center',x:4,y:4});
  assert.match(apply(colliding,sel,null,request).reason,/collision/);
});

test('existing one-shot arc-profile-tools array can be adopted without new geometry',()=>{
  const doc=roundedPlateArcFixture(),sel=selection();
  const old=editArcProfileWithTool(doc,sel,{
    kind:'array',sourceCircleId:'holeA',patternId:'boltGrid',rows:2,columns:2,
    spacingXmm:20,spacingYmm:20},{
      sourceSignature:serializeArcSketch(doc),
      selectionSignature:serializeArcHoleSelection(sel)});
  assert.equal(old.kind,'accepted',old.reason);
  const before=serializeArcSketch(old.sketch);
  const adopted=accepted(adoptArcHolePattern(old.sketch,old.selection,{
    id:'boltGrid',sourceCircleId:'holeA',rows:2,columns:2,
    spacingXmm:20,spacingYmm:20},stamp(old.sketch,old.selection)));
  assert.equal(serializeArcSketch(adopted.sketch),before);
  assert.equal(inspectArcHolePattern(adopted.sketch,adopted.selection,adopted.pattern).status,
    'synchronized');
  const reconfigured=accepted(apply(adopted.sketch,adopted.selection,
    adopted.pattern,{kind:'reconfigure',rows:1,columns:2,
      spacingXmm:20,spacingYmm:20}));
  assert.equal(reconfigured.profile.holes.length,3);
});

test('runnable public package ESM example produces edited/reopened pattern with honest provenance',()=>{
  const file=fileURLToPath(new URL('../examples/associative-hole-pattern.mjs',import.meta.url));
  const stdout=execFileSync(process.execPath,[file],{encoding:'utf8',timeout:30000});
  const rows=stdout.trim().split('\n').map(s=>JSON.parse(s));
  assert.deepEqual(rows.map(s=>s.step),['create-pattern','drag-seed-and-resize',
    'expand-pattern','reduce-pattern','replay-retrospective-width',
    'reopened','overlap-refused']);
  assert.equal(rows[2].memberCount,5);
  assert.equal(rows[5].memberCount,1);
  assert.equal(rows[5].nativeExact,false);
  assert.equal(rows[5].stepQualified,false);
  assert.equal(rows[6].kind,'refused');
});
