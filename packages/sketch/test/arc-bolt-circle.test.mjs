import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {roundedPlateArcFixture,editArcConstraint,serializeArcSketch,
  parseArcSketch} from '../arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection} from '../arc-hole-authoring.mjs';
import {createArcBoltCircle,serializeArcBoltCircle,parseArcBoltCircle,
  inspectArcBoltCircle,proposeArcBoltCircle} from '../arc-bolt-circle.mjs';
const selection=()=>createArcHoleSelection({
  format:'intuit3d.arc-hole-selection',version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const stamps=(sketch,selected,pattern=null)=>({
  sourceSignature:serializeArcSketch(sketch),
  selectionSignature:serializeArcHoleSelection(selected),
  patternSignature:pattern?serializeArcBoltCircle(pattern):null});
const request={kind:'create',id:'boltCircle',sourceCircleId:'holeA',
  centerXMm:35,centerYMm:25,count:3};
const apply=(s,a,p,c)=>proposeArcBoltCircle(s,a,p,c,stamps(s,a,p));
const accepted=x=>{
  assert.equal(x.kind,'accepted',x.reason);
  assert.equal(x.solution.status,'solved');
  assert.equal(x.solution.degreesOfFreedom,0);
  assert.equal(x.profile.providerSubmissionReady,true);
  assert.equal(x.profile.exactBrepAvailable,false);
  assert.equal(x.profile.stepQualified,false);
  assert.equal(x.nativeExact,false);
  return x;
};
test('real 3-position bolt circle preserves selected analytic plate and IDs',()=>{
  const original=roundedPlateArcFixture(),sel=selection(),copy=serializeArcSketch(original);
  const x=accepted(apply(original,sel,null,request));
  assert.deepEqual(x.createdIds,['boltCircle:i1','boltCircle:i2']);
  assert.equal(x.profile.holes.length,4);
  assert.equal(x.profile.holes[2].radiusMm,6);
  assert.ok(Math.abs(x.profile.holes[2].x-(35-15*Math.sqrt(3)/2))<1e-10);
  assert.ok(Math.abs(x.profile.holes[2].y-17.5)<1e-10);
  assert.equal(inspectArcBoltCircle(x.sketch,x.selection,x.pattern).status,'synchronized');
  assert.equal(serializeArcSketch(original),copy);
  assert.deepEqual(sel.holeIds,['holeA','holeB']);
});
test('polar count/centre reconfigure preserves member identity and changes real solved holes',()=>{
  let x=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  x=accepted(apply(x.sketch,x.selection,x.pattern,{
    kind:'reconfigure',count:4,centerXMm:35,centerYMm:28}));
  assert.deepEqual(x.createdIds,['boltCircle:i3']);
  assert.deepEqual(x.preservedIds,['boltCircle:i1','boltCircle:i2']);
  const far=x.profile.holes.find(h=>h.id==='boltCircle:i2');
  assert.equal(far.id,'boltCircle:i2');
  assert.equal(far.centerId,'hole.boltCircle:i2.center');
  assert.ok(Math.abs(far.x-35)<1e-10);
  assert.ok(Math.abs(far.y-16)<1e-10);
  assert.equal(far.radiusMm,6);
  const smaller=accepted(apply(x.sketch,x.selection,x.pattern,{
    kind:'reconfigure',count:2,centerXMm:35,centerYMm:28}));
  assert.deepEqual(smaller.removedIds,['boltCircle:i2','boltCircle:i3']);
  assert.deepEqual(smaller.preservedIds,['boltCircle:i1']);
});
test('atomic seed move + diameter edit; archive replay and retrospective plate width',()=>{
  let x=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  x=accepted(apply(x.sketch,x.selection,x.pattern,{
    kind:'edit-seed',xMm:35,yMm:42,diameterMm:10}));
  assert.equal(x.profile.holes.find(h=>h.id==='boltCircle:i1').radiusMm,5);
  assert.deepEqual(x.createdIds,[]);
  const sketch=parseArcSketch(serializeArcSketch(x.sketch));
  const selected=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(x.selection)));
  const record=parseArcBoltCircle(serializeArcBoltCircle(x.pattern));
  assert.equal(inspectArcBoltCircle(sketch,selected,record).status,'synchronized');
  const widened=editArcConstraint(sketch,'plate:width',{value:150});
  const replay=accepted(apply(widened,selected,record,{kind:'refresh'}));
  assert.equal(replay.profile.boundary.length,x.profile.boundary.length);
  assert.notEqual(replay.profile.materialAreaMm2,x.profile.materialAreaMm2);
  assert.equal(replay.profile.id,x.profile.id);
});
test('material overlap, boundary crossing, stale revisions, and foreign constraints refuse',()=>{
  const x=accepted(apply(roundedPlateArcFixture(),selection(),null,request));
  const before=serializeArcSketch(x.sketch);
  for(const command of [
    {kind:'reconfigure',count:8,centerXMm:35,centerYMm:25},
    {kind:'reconfigure',count:4,centerXMm:35,centerYMm:5},
    {kind:'reconfigure',count:13,centerXMm:35,centerYMm:25},
    {kind:'edit-seed',xMm:35,yMm:42,diameterMm:50}
  ]){
    const refused=apply(x.sketch,x.selection,x.pattern,command);
    assert.equal(refused.kind,'refused',JSON.stringify(command));
    assert.equal(serializeArcSketch(x.sketch),before);
  }
  const stale=proposeArcBoltCircle(x.sketch,x.selection,x.pattern,{kind:'refresh'},
    stamps(roundedPlateArcFixture(),selection()));
  assert.match(stale.reason,/stale/);
  const dependent=structuredClone(x.sketch);
  dependent.constraints.push({id:'foreign',kind:'distanceX',
    a:'hole.boltCircle:i1.center',b:'holeB:center',value:20});
  assert.match(apply(dependent,x.selection,x.pattern,{kind:'refresh'}).reason,
    /other authored dependencies/);
  const manual=structuredClone(x.sketch);
  manual.circles.find(c=>c.id==='boltCircle:i1').radiusMm=5;
  assert.equal(inspectArcBoltCircle(manual,x.selection,x.pattern).status,'unresolved');
  assert.match(apply(manual,x.selection,x.pattern,{kind:'refresh'}).reason,/modified/);
  assert.throws(()=>createArcBoltCircle({...x.pattern,version:2}),/versioned/);
});
test('runnable public bolt circle API preserves exactness provenance',()=>{
  const file=fileURLToPath(new URL('../examples/associative-bolt-circle.mjs',import.meta.url));
  const rows=execFileSync(process.execPath,[file],{encoding:'utf8',timeout:30000})
    .trim().split('\n').map(x=>JSON.parse(x));
  assert.deepEqual(rows.map(x=>x.step),['create','reconfigure','move-seed',
    'widen-plate','reopen','refuse-overlap']);
  assert.equal(rows[4].nativeExact,false);
  assert.equal(rows[4].stepQualified,false);
  assert.equal(rows[5].kind,'refused');
});
