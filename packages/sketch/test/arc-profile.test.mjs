import test from 'node:test';
import assert from 'node:assert/strict';
import {roundedPlateArcFixture,editArcConstraint,editArcCircleRadius,
  solveArcSketch,parseArcSketch,serializeArcSketch} from '../arc-constraints.mjs';
import {prepareArcProfileForProvider,ARC_PROFILE_FORMAT} from '../arc-profile.mjs';

const boundary=['bottom','arc1','right','arc2','top','arc3','left','arc0'];
const prepare=(doc,id='plate:outer')=>prepareArcProfileForProvider(
  doc,solveArcSketch(doc),{profileId:id,boundaryIds:boundary,holeIds:['holeA','holeB']});
const approx=(a,b)=>assert.ok(Math.abs(a-b)<2e-5,String(a)+' != '+String(b));

test('solved arc/radius/tangent equations become a globally checked analytic profile for provider review',()=>{
  const doc=roundedPlateArcFixture();
  const p=prepare(doc);
  assert.equal(p.format,ARC_PROFILE_FORMAT);
  assert.equal(p.status,'analytic_2d_validated_pending_native');
  assert.equal(p.providerSubmissionReady,true);
  assert.equal(p.nativeProfileAdmissible,false);
  assert.equal(p.stepQualified,false);
  assert.equal(p.globalSelfIntersectionChecked,true);
  assert.equal(p.holeContainmentChecked,true);
  assert.deepEqual(p.boundary.map(e=>e.id),boundary);
  assert.deepEqual(p.holes.map(e=>e.id),['holeA','holeB']);
  approx(p.materialAreaMm2,9600-(1-Math.PI/4)*(4**2+8**2+12**2+6**2)-72*Math.PI);
});

test('retrospective width/arc-radius/hole edits preserve curve and profile IDs through archive replay',()=>{
  const doc=roundedPlateArcFixture(),before=prepare(doc);
  let edited=editArcConstraint(doc,'plate:width',{value:150});
  edited=editArcConstraint(edited,'corner1:radius',{value:14});
  edited=editArcCircleRadius(edited,'holeA',7);
  const after=prepare(edited),reopened=prepare(parseArcSketch(serializeArcSketch(edited)));
  assert.equal(after.id,before.id);
  assert.deepEqual(after.boundary.map(c=>c.id),before.boundary.map(c=>c.id));
  assert.deepEqual(after.holes.map(c=>c.id),before.holes.map(c=>c.id));
  assert.equal(after.holes[0].radiusMm,7);
  assert.notEqual(after.materialAreaMm2,before.materialAreaMm2);
  assert.notEqual(after.sourceSignature,before.sourceSignature);
  assert.deepEqual(after,reopened);
});

test('real boundary piercing and overlapping circle dimensions are refused before provider submission',()=>{
  const original=roundedPlateArcFixture();
  const edgePiercing=editArcCircleRadius(original,'holeA',40);
  assert.equal(solveArcSketch(edgePiercing).status,'solved');
  assert.throws(()=>prepare(edgePiercing),/hole intersects or approaches boundary/);
  let overlap=editArcCircleRadius(original,'holeA',24);
  overlap=editArcCircleRadius(overlap,'holeB',27);
  assert.equal(solveArcSketch(overlap).status,'solved');
  assert.throws(()=>prepare(overlap),/hole overlap or contact/);
});

test('hole outside boundary and invalid sketch have no provider-submittable profile',()=>{
  const outside=roundedPlateArcFixture();
  outside.constraints.find(c=>c.id==='holeA:fixed').x=-10;
  assert.equal(solveArcSketch(outside).status,'solved');
  assert.throws(()=>prepare(outside),/hole outside analytic boundary/);
  const bad=roundedPlateArcFixture();
  bad.constraints.push({id:'contradiction',kind:'arcRadius',arc:'arc1',value:55});
  assert.equal(solveArcSketch(bad).status,'conflicted');
  assert.throws(()=>prepare(bad),/stale, unsolved/);
});

test('rejected wire omissions and falsified solver observations cannot bypass admission',()=>{
  const original=roundedPlateArcFixture(),solution=solveArcSketch(original);
  const altered=structuredClone(solution);
  altered.geometry.points.find(p=>p.id==='arc1:center').x+=5;
  assert.throws(()=>prepareArcProfileForProvider(original,altered,
    {profileId:'p',boundaryIds:boundary,holeIds:['holeA','holeB']}),/modified/);
  assert.throws(()=>prepareArcProfileForProvider(original,solution,
    {profileId:'p',boundaryIds:boundary.slice(1),holeIds:['holeA','holeB']}),/unconnected|open/);
  assert.throws(()=>prepareArcProfileForProvider(original,solution,
    {profileId:'bad id',boundaryIds:boundary}),/stable profileId/);
});
