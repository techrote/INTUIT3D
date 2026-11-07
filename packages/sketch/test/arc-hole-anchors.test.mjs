import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {roundedPlateArcFixture,serializeArcSketch,parseArcSketch,editArcConstraint,
  solveArcSketch} from '../arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection} from '../arc-hole-authoring.mjs';
import {inspectArcHoleAnchor,proposeArcHoleAnchor} from '../arc-hole-anchors.mjs';
import {inspectArcProfileTools,editArcProfileWithTool} from '../arc-profile-tools.mjs';

// Compare solved world coordinates at consumer display precision without changing
// the solver's own stricter residual or acceptance policy.
const near=(actual,expected)=>assert.ok(Number.isFinite(actual)&&
  Math.abs(actual-expected)<1e-6,`${actual} differs from ${expected}`);
const select=()=>createArcHoleSelection({
  format:'intuit3d.arc-hole-selection',version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const stamp=(s,a)=>({
  sourceSignature:serializeArcSketch(s),selectionSignature:serializeArcHoleSelection(a)});
const apply=(s,a,command)=>proposeArcHoleAnchor(s,a,command,stamp(s,a));
function accept(r){assert.equal(r.kind,'accepted',r.reason);
  assert.equal(r.solution.status,'solved');assert.equal(r.solution.degreesOfFreedom,0);
  assert.equal(r.profile.providerSubmissionReady,true);
  assert.equal(r.nativeExact,false);assert.equal(r.previewOnly,true);return r;}
const point=(sketch,id)=>{
  const solved=solveArcSketch(sketch);assert.equal(solved.status,'solved');
  return solved.geometry.points.find(p=>p.id===id);
};
test('binding right-edge hole preserves solved location, follows retrospective width, replays and detaches',()=>{
  const sketch=roundedPlateArcFixture(),selection=select();
  const original=serializeArcSketch(sketch);
  const r=accept(apply(sketch,selection,{kind:'bind',circleId:'holeB',anchorPointId:'p1'}));
  assert.equal(serializeArcSketch(sketch),original);
  assert.equal(r.binding.mode,'anchored');
  assert.equal(r.binding.binding.anchorPointId,'p1');
  near(r.binding.binding.offsetXMm,-35);
  near(r.binding.binding.offsetYMm,40);
  near(point(r.sketch,'holeB:center').x,85);
  assert.equal(r.profile.id,'plate:main');
  assert.equal(r.sketch.constraints.some(c=>c.id==='holeB:fixed'&&c.kind==='distanceX'),true);
  const widened=editArcConstraint(r.sketch,'plate:width',{value:150});
  const current=inspectArcHoleAnchor(widened,selection,'holeB');
  assert.equal(current.mode,'anchored');
  near(current.position.xMm,115);
  const ui=inspectArcProfileTools(widened,selection);
  assert.equal(ui.status,'solved');
  near(ui.controls.find(h=>h.id==='hole-center:holeB').position.x,115);
  assert.equal(ui.controls.find(h=>h.id==='hole-center:holeB').canMove,true);
  const reopened=parseArcSketch(serializeArcSketch(widened));
  near(inspectArcHoleAnchor(reopened,selection,'holeB').position.xMm,115);
  const d=accept(apply(reopened,selection,{kind:'detach',circleId:'holeB'}));
  assert.equal(d.binding.mode,'fixed');
  near(point(d.sketch,'holeB:center').x,115);
  assert.equal(d.sketch.constraints.some(c=>c.id==='holeB:fixed'&&c.kind==='fixed'),true);
  assert.equal(d.sketch.constraints.some(c=>c.id==='holeB:anchorY'),false);
  const wider=editArcConstraint(d.sketch,'plate:width',{value:160});
  near(point(wider,'holeB:center').x,115);
  assert.equal(d.profile.id,r.profile.id);
});
test('real profile tool binds a hole and drags its semantic handle by editing its offsets',()=>{
  const sketch=roundedPlateArcFixture(),sel=select();
  const bound=editArcProfileWithTool(sketch,sel,{kind:'bind-hole',circleId:'holeB',anchorPointId:'p1'},stamp(sketch,sel));
  assert.equal(bound.kind,'accepted',bound.reason);
  const resized=editArcConstraint(bound.sketch,'plate:width',{value:150});
  const ui=inspectArcProfileTools(resized,sel);
  const drag=editArcProfileWithTool(resized,sel,
    {kind:'drag-handle',handleId:'hole-center:holeB',xMm:119,yMm:45},stamp(resized,sel));
  assert.equal(drag.kind,'accepted',drag.reason);
  near(point(drag.sketch,'holeB:center').x,119);
  near(point(drag.sketch,'holeB:center').y,45);
  near(inspectArcHoleAnchor(drag.sketch,sel,'holeB').binding.offsetXMm,-31);
  assert.equal(drag.gesture.handleId,'hole-center:holeB');
  assert.equal(ui.profile.id,drag.profile.id);
  const updated=editArcProfileWithTool(drag.sketch,sel,
    {kind:'hole-offset',circleId:'holeB',offsetXMm:-32,offsetYMm:38},
    stamp(drag.sketch,sel));
  assert.equal(updated.kind,'accepted',updated.reason);
  near(point(updated.sketch,'holeB:center').x,118);
  const unbound=editArcProfileWithTool(updated.sketch,sel,
    {kind:'unbind-hole',circleId:'holeB'},stamp(updated.sketch,sel));
  assert.equal(unbound.kind,'accepted',unbound.reason);
  assert.equal(inspectArcHoleAnchor(unbound.sketch,sel,'holeB').mode,'fixed');
});
test('mixed fixed/anchored multi-hole drag is one accepted profile revision',()=>{
  const sketch=roundedPlateArcFixture(),sel=select();
  const bound=accept(apply(sketch,sel,{kind:'bind',circleId:'holeB',anchorPointId:'p1'}));
  const wider=editArcConstraint(bound.sketch,'plate:width',{value:150});
  const source=serializeArcSketch(wider);
  const moved=editArcProfileWithTool(wider,sel,{kind:'translate-holes',
    circleIds:['holeA','holeB'],deltaXMm:3,deltaYMm:2},stamp(wider,sel));
  assert.equal(moved.kind,'accepted',moved.reason);
  assert.deepEqual(moved.movedHoleIds,['holeA','holeB']);
  near(point(moved.sketch,'holeA:center').x,38);
  near(point(moved.sketch,'holeB:center').x,118);
  near(point(moved.sketch,'holeB:center').y,42);
  near(inspectArcHoleAnchor(moved.sketch,sel,'holeB').binding.offsetXMm,-32);
  assert.equal(serializeArcSketch(wider),source);
});
test('invalid collision, stale revision and foreign constraints refuse without mutating sketch',()=>{
  const doc=roundedPlateArcFixture(),sel=select();
  const bound=accept(apply(doc,sel,{kind:'bind',circleId:'holeB',anchorPointId:'p1'}));
  const before=serializeArcSketch(bound.sketch);
  const invalid=apply(bound.sketch,sel,{kind:'drag-center',circleId:'holeB',
    handleId:'hole-center:holeB',xMm:35,yMm:40});
  assert.equal(invalid.kind,'refused');
  assert.equal(serializeArcSketch(bound.sketch),before);
  const stale=proposeArcHoleAnchor(bound.sketch,sel,
    {kind:'detach',circleId:'holeB'},stamp(doc,sel));
  assert.match(stale.reason,/stale/);
  const collision=structuredClone(doc);
  collision.constraints.push({id:'holeB:anchorY',kind:'distanceY',
    a:'p0',b:'p1',value:0});
  assert.match(apply(collision,sel,{kind:'bind',circleId:'holeB',anchorPointId:'p1'}).reason,/collision/);
  const foreign=structuredClone(bound.sketch);
  foreign.constraints.push({id:'extra:coupling',kind:'distanceX',
    a:'holeA:center',b:'holeB:center',value:50});
  assert.equal(inspectArcHoleAnchor(foreign,sel,'holeB').mode,'unsupported');
  assert.equal(apply(foreign,sel,{kind:'detach',circleId:'holeB'}).kind,'refused');
});
test('an unsolved source remains diagnosable; edits never claim physical admission',()=>{
  const doc=roundedPlateArcFixture(),sel=select();
  const bound=accept(apply(doc,sel,{kind:'bind',circleId:'holeB',anchorPointId:'p1'}));
  const under=structuredClone(bound.sketch);
  under.constraints=under.constraints.filter(c=>c.id!=='corner1:radius');
  const view=inspectArcHoleAnchor(under,sel,'holeB');
  assert.equal(view.mode,'anchored');
  assert.equal(view.solverStatus,'underconstrained');
  assert.equal(apply(under,sel,{kind:'edit-offset',circleId:'holeB',
    offsetXMm:-30,offsetYMm:40}).kind,'refused');
  const script=fileURLToPath(new URL('../examples/edge-anchored-holes.mjs',import.meta.url));
  const lines=execFileSync(process.execPath,[script],{encoding:'utf8',timeout:30000})
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(x=>x.step),['bind','width-edit','drag','reopen',
    'group-drag','collision-refused','detach']);
  assert.ok(lines.every(x=>x.nativeExact===false));
});
