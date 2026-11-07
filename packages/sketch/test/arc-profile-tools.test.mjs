import test from 'node:test';
import assert from 'node:assert/strict';
import {roundedPlateArcFixture,serializeArcSketch,parseArcSketch,solveArcSketch}
  from '../arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection}
  from '../arc-hole-authoring.mjs';
import {inspectArcProfileTools,editArcProfileWithTool}
  from '../arc-profile-tools.mjs';
const selection=()=>createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const stamp=(doc,sel)=>({sourceSignature:serializeArcSketch(doc),
  selectionSignature:serializeArcHoleSelection(sel)});
const edit=(doc,sel,command)=>editArcProfileWithTool(doc,sel,command,stamp(doc,sel));
const assertAccepted=result=>{
  assert.equal(result.kind,'accepted',result.reason);
  assert.equal(result.solution.status,'solved');
  assert.equal(result.solution.degreesOfFreedom,0);
  assert.equal(result.profile.providerSubmissionReady,true);
  assert.equal(result.profile.nativeProfileAdmissible,false);
  assert.equal(result.profile.exactBrepAvailable,false);
  assert.equal(result.profile.stepQualified,false);
  return result;
};
const pattern={kind:'array',sourceCircleId:'holeA',patternId:'arrayA',
  rows:2,columns:2,spacingXmm:20,spacingYmm:20};

test('real solved dimensions and hole handles are inspectable with stable IDs',()=>{
  const doc=roundedPlateArcFixture(),sel=selection();
  const inspected=inspectArcProfileTools(doc,sel);
  assert.equal(inspected.status,'solved');
  assert.equal(inspected.profile.id,'plate:main');
  assert.equal(inspected.profile.holes.length,2);
  assert.equal(inspected.previewOnly,true);
  assert.deepEqual(inspected.controls.find(h=>h.id==='dimension:plate:width').valueMm,120);
  assert.equal(inspected.controls.find(h=>h.id==='dimension:corner1:radius').valueMm,8);
  assert.equal(inspected.controls.find(h=>h.id==='hole-diameter:holeA').valueMm,12);
  assert.equal(inspected.controls.find(h=>h.id==='hole-center:holeA').canMove,true);
});

test('drag width, pattern holes, edit corner/diameter, save/reopen and replay one-step results',()=>{
  const doc=roundedPlateArcFixture(),sel=selection();
  const baseline=serializeArcSketch(doc);
  const stretched=assertAccepted(edit(doc,sel,
    {kind:'drag-dimension',constraintId:'plate:width',xMm:150,yMm:0}));
  assert.equal(stretched.appliedValueMm,150);
  assert.equal(stretched.profile.id,sel.profileId);
  const array=assertAccepted(edit(stretched.sketch,stretched.selection,pattern));
  assert.deepEqual(array.createdIds,['arrayA:r0c1','arrayA:r1c0','arrayA:r1c1']);
  assert.deepEqual(array.profile.holes.map(h=>h.id),
    ['holeA','holeB','arrayA:r0c1','arrayA:r1c0','arrayA:r1c1']);
  assert.equal(array.selection.profileId,sel.profileId);
  assert.deepEqual(array.profile.boundary.map(e=>e.id),
    stretched.profile.boundary.map(e=>e.id));
  const radius=assertAccepted(edit(array.sketch,array.selection,
    {kind:'dimension',constraintId:'corner1:radius',valueMm:14}));
  const moved=assertAccepted(edit(radius.sketch,radius.selection,
    {kind:'hole',change:{kind:'move',circleId:'arrayA:r1c1',xMm:65,yMm:60}}));
  const resized=assertAccepted(edit(moved.sketch,moved.selection,
    {kind:'hole',change:{kind:'resize',circleId:'arrayA:r1c1',diameterMm:14}}));
  assert.equal(resized.profile.holes.length,5);
  assert.equal(resized.sketch.circles.find(c=>c.id==='arrayA:r1c1').radiusMm,7);
  const reopened=parseArcSketch(serializeArcSketch(resized.sketch));
  const reopenedSel=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(resized.selection)));
  assert.equal(inspectArcProfileTools(reopened,reopenedSel).profile.materialAreaMm2,
    resized.profile.materialAreaMm2);
  assert.deepEqual(edit(doc,sel,{kind:'drag-dimension',constraintId:'plate:width',xMm:150,yMm:0}).sketch,
    stretched.sketch);
  assert.equal(serializeArcSketch(doc),baseline);
  assert.deepEqual(sel.holeIds,['holeA','holeB']);
});

test('array and dimension edits fail atomically for real clearance or identity failures',()=>{
  const doc=roundedPlateArcFixture(),sel=selection(),before=serializeArcSketch(doc);
  const cases=[
    {...pattern,spacingXmm:0,spacingYmm:0},
    {...pattern,spacingXmm:60},
    {kind:'dimension',constraintId:'corner1:radius',valueMm:90},
    {kind:'drag-dimension',constraintId:'plate:width',xMm:8,yMm:0},
    {kind:'hole',change:{kind:'resize',circleId:'holeA',diameterMm:200}},
    {kind:'dimension',constraintId:'nonexistent',valueMm:12}
  ];
  for(const command of cases) {
    const result=edit(doc,sel,command);
    assert.equal(result.kind,'refused',JSON.stringify(command));
    assert.equal(serializeArcSketch(doc),before);
    assert.deepEqual(sel.holeIds,['holeA','holeB']);
  }
  const accepted=assertAccepted(edit(doc,sel,pattern));
  assert.match(edit(accepted.sketch,accepted.selection,pattern).reason,/identity collision/);
});

test('stale signatures and unsupported command shapes cannot mutate the design',()=>{
  const doc=roundedPlateArcFixture(),sel=selection(),expected=stamp(doc,sel);
  const changed=assertAccepted(edit(doc,sel,
    {kind:'dimension',constraintId:'plate:width',valueMm:150}));
  assert.match(editArcProfileWithTool(changed.sketch,sel,pattern,expected).reason,/stale/);
  assert.match(editArcProfileWithTool(doc,{...sel,holeIds:['holeA']},pattern,expected).reason,/stale/);
  assert.match(edit(doc,sel,{...pattern,unexpected:1}).reason,/invalid/);
  assert.match(edit(doc,sel,{kind:'dimension',constraintId:'plate:width',valueMm:NaN}).reason,/invalid/);
});

test('conflicting authored radius can be repaired by dimension input without losing IDs',()=>{
  const doc=roundedPlateArcFixture(),sel=selection();
  doc.constraints.push({id:'extra:radius',kind:'arcRadius',arc:'arc0',value:9});
  assert.equal(solveArcSketch(doc).status,'conflicted');
  const inspected=inspectArcProfileTools(doc,sel);
  assert.equal(inspected.status,'conflicted');
  assert.equal(inspected.profile,null);
  assert.ok(inspected.controls.some(h=>h.id==='dimension:corner0:radius'));
  const repaired=assertAccepted(edit(doc,sel,
    {kind:'dimension',constraintId:'corner0:radius',valueMm:9}));
  assert.equal(repaired.profile.id,'plate:main');
  assert.equal(repaired.sketch.constraints.find(c=>c.id==='extra:radius').value,9);
});

test('one absent corner equation remains underconstrained and cannot fabricate a profile',()=>{
  const doc=roundedPlateArcFixture(),sel=selection();
  doc.constraints=doc.constraints.filter(c=>c.id!=='corner1:radius');
  assert.equal(inspectArcProfileTools(doc,sel).status,'underconstrained');
  assert.equal(edit(doc,sel,pattern).kind,'refused');
  assert.equal(edit(doc,sel,
    {kind:'drag-dimension',constraintId:'plate:width',xMm:140,yMm:0}).kind,'refused');
});

test('actual public ESM package consumer demonstration executes and reports non-exact status',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const demo=fileURLToPath(new URL('../examples/arc-profile-tools.mjs',import.meta.url));
  const stdout=execFileSync(process.execPath,[demo],{encoding:'utf8',timeout:30000});
  const steps=stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(steps.map(s=>s.step),[
    'original','drag-width-to-150','create-2x2-pattern',
    'retrospective-corner-radius','resize-patterned-hole','reopened','invalid-array']);
  assert.equal(steps[2].holeIds.length,5);
  assert.equal(steps[5].nativeExact,false);
  assert.equal(steps[5].stepQualified,false);
  assert.equal(steps[6].result,'refused');
});
