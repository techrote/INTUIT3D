import test from 'node:test';
import assert from 'node:assert/strict';
import {editConstraint,createSketch,solveSketch,serializeSketch,parseSketch} from '../index.mjs';
import {discoverPlateProfiles,admitDiscoveredPlateProfile} from '../profile-discovery.mjs';
import {SELECTED_PROFILE_VERSION,createDimensionedLPlateSketch,
  proposeSelectedPlateProfile,admitSelectedPlateProfile} from '../selected-profile.mjs';

const addRectangle=(doc,prefix,x,y,w,h)=>{
  const corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
    .map(([px,py],i)=>({id:prefix+':p'+i,x:px,y:py}));
  doc.points.push(...corners);
  doc.lines.push(...corners.map((p,i)=>({
    id:prefix+':line'+i,start:p.id,end:corners[(i+1)%4].id
  })));
  doc.constraints.push(...corners.map(p=>({
    id:prefix+':fixed:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
  })));
  return createSketch(doc);
};
const choose=(doc,id)=>{
  const r=discoverPlateProfiles(doc);
  return proposeSelectedPlateProfile(doc,{
    candidateId:id??r.candidates.find(c=>c.lineIds.length===6)?.id,
    sourceSignature:r.inputSignature
  });
};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,
  actual+' is not '+expected);

test('L-shaped six-edge sketch is fully constrained with two real holes and stable IDs',()=>{
  const doc=createDimensionedLPlateSketch();
  assert.equal(SELECTED_PROFILE_VERSION,1);
  const solved=solveSketch(doc);
  assert.equal(solved.status,'solved');
  assert.equal(solved.degreesOfFreedom,0);
  const proposal=choose(doc);
  assert.equal(proposal.kind,'selected_analytic_profile');
  assert.equal(proposal.boundary.length,6);
  assert.equal(proposal.holeIds.length,2);
  near(proposal.profile.areaMm2,5600-50*Math.PI);
  assert.equal(proposal.providerSubmissionReady,true);
  assert.equal(proposal.nativeExact,false);
  assert.equal(proposal.exactBrepAvailable,false);
  assert.equal(proposal.independentStepQualified,false);
  assert.deepEqual(admitSelectedPlateProfile(doc,proposal),proposal);
});

test('two disjoint closed contours admit exactly the deliberately selected L-profile',()=>{
  const doc=addRectangle(createDimensionedLPlateSketch(),'second',300,100,40,30);
  const discovered=discoverPlateProfiles(doc);
  assert.equal(discovered.status,'ambiguous');
  assert.equal(discovered.candidates.length,2);
  assert.throws(()=>admitDiscoveredPlateProfile(doc,discovered,discovered.candidates[0].id),
    /ambiguous/);
  const first=choose(doc);
  assert.equal(first.kind,'selected_analytic_profile');
  assert.deepEqual(first.unselectedLineIds,doc.lines.filter(e=>e.id.startsWith('second:')).map(e=>e.id).sort());
  near(admitSelectedPlateProfile(doc,first).profile.areaMm2,5600-50*Math.PI);
  const second=choose(doc,discovered.candidates.find(c=>c.lineIds.length===4).id);
  assert.equal(second.kind,'selected_analytic_profile');
  assert.deepEqual(second.holeIds,[]);
  near(second.profile.areaMm2,1200);
});

test('dimension edits move corner-bound holes; serialized replay and unrelated lines retain selection identity',()=>{
  let doc=addRectangle(createDimensionedLPlateSketch(),'second',300,100,40,30);
  const original=choose(doc);
  doc=editConstraint(editConstraint(editConstraint(doc,'L:length',{value:150}),
    'L:webWidth',{value:50}),'L:height',{value:100});
  doc=parseSketch(serializeSketch(doc));
  const after=choose(doc);
  assert.equal(after.kind,'selected_analytic_profile');
  assert.equal(after.semanticProfileId,original.semanticProfileId);
  assert.deepEqual(after.lineIds,original.lineIds);
  assert.deepEqual(after.holeIds,original.holeIds);
  near(after.profile.areaMm2,8000-50*Math.PI);
  const points=new Map(solveSketch(doc).geometry.points.map(p=>[p.id,p]));
  near(points.get('L:holeLowerCenter').x,120);
  near(points.get('L:holeUpperCenter').y,80);
  assert.deepEqual(admitSelectedPlateProfile(doc,after),after);
  assert.throws(()=>admitSelectedPlateProfile(doc,original),/stale, unsafe or modified/);
});

test('untrusted selection and edited geometry never bypass source revalidation',()=>{
  const doc=createDimensionedLPlateSketch();
  const good=choose(doc);
  for (const mutation of [
    p=>p.profile.areaMm2+=1,
    p=>p.boundary[0].start.x+=1,
    p=>p.unselectedLineIds.push('fake'),
    p=>p.nativeExact=true
  ]) {
    const forged=structuredClone(good);
    mutation(forged);
    assert.throws(()=>admitSelectedPlateProfile(doc,forged),/stale, unsafe or modified/);
  }
  assert.equal(proposeSelectedPlateProfile(doc,{
    candidateId:good.candidateId,sourceSignature:'old'
  }).reason,'stale_source');
  assert.equal(proposeSelectedPlateProfile(doc,{
    candidateId:'cycle:missing',sourceSignature:serializeSketch(doc)
  }).reason,'unknown_profile');
  const under=createSketch({...doc,constraints:doc.constraints.filter(c=>c.id!=='L:length')});
  assert.equal(choose(under,good.candidateId).reason,'source_not_profile_ready');
  const contradictory=createSketch({...doc,constraints:[...doc.constraints,
    {id:'L:conflict',kind:'distanceX',a:'L:a',b:'L:b',value:121}]});
  assert.equal(choose(contradictory,good.candidateId).reason,'source_not_profile_ready');
});

test('nested, overlapping, touching or crossing nonselected loops refuse implicit material subtraction',()=>{
  for (const [x,y,w,h] of [
    [10,10,10,10], [100,10,40,20], [120,0,40,20], [35,25,15,30]
  ]) {
    const doc=addRectangle(createDimensionedLPlateSketch(),'other',x,y,w,h);
    const proposal=choose(doc);
    assert.equal(proposal.kind,'refused',JSON.stringify([x,y,w,h]));
    assert.equal(proposal.reason,'unselected_lines_contact_or_overlap_selected_bounds');
    assert.ok(proposal.overlappingLineIds.length>0);
  }
});

test('deliberate selection of one contour retains unrelated unconstrained-like drafting entities only if solved and geometrically clear',()=>{
  const doc=createDimensionedLPlateSketch();
  doc.points.push({id:'looseA',x:280,y:40},{id:'looseB',x:300,y:70});
  doc.lines.push({id:'looseLine',start:'looseA',end:'looseB'});
  doc.constraints.push(
    {id:'looseFixA',kind:'fixed',point:'looseA',x:280,y:40},
    {id:'looseFixB',kind:'fixed',point:'looseB',x:300,y:70}
  );
  const selection=choose(createSketch(doc));
  assert.equal(selection.kind,'selected_analytic_profile');
  assert.deepEqual(selection.unselectedLineIds,['looseLine']);
  assert.equal(admitSelectedPlateProfile(doc,selection).profile.outer.length,6);
});

test('invalid L geometry refuses instead of returning a manufactured preview',()=>{
  assert.throws(()=>createDimensionedLPlateSketch({webWidthMm:150}),/invalid dimensions/);
  assert.throws(()=>createDimensionedLPlateSketch({flangeHeightMm:80}),/invalid dimensions/);
  assert.throws(()=>createDimensionedLPlateSketch({holeRadiusMm:20}),/do not admit/);
  assert.throws(()=>createDimensionedLPlateSketch({lengthMm:NaN}),/invalid dimensions/);
});


test('disjoint machining islands within concave cutaway admit by real boundaries, not AABBs',()=>{
  let doc=addRectangle(createDimensionedLPlateSketch(),'island',62,42,20,18);
  const original=serializeSketch(doc);
  const discovery=discoverPlateProfiles(doc);
  assert.equal(discovery.candidates.length,2);
  const l=choose(doc);
  const island=choose(doc,discovery.candidates.find(c=>c.lineIds.length===4).id);
  assert.equal(l.kind,'selected_analytic_profile',JSON.stringify(l));
  assert.equal(island.kind,'selected_analytic_profile',JSON.stringify(island));
  assert.deepEqual(l.holeIds,['L:holeLower','L:holeUpper']);
  assert.deepEqual(island.holeIds,[]);
  assert.equal(admitSelectedPlateProfile(doc,l).semanticProfileId,l.semanticProfileId);
  assert.equal(admitSelectedPlateProfile(doc,island).semanticProfileId,island.semanticProfileId);
  doc=parseSketch(serializeSketch(editConstraint(doc,'L:length',{value:150})));
  const resized=choose(doc),reselected=choose(doc,island.candidateId);
  assert.equal(resized.kind,'selected_analytic_profile');
  assert.equal(reselected.kind,'selected_analytic_profile');
  assert.equal(resized.semanticProfileId,l.semanticProfileId);
  assert.equal(reselected.semanticProfileId,island.semanticProfileId);
  assert.equal(serializeSketch(createSketch(JSON.parse(original))),original);
  assert.equal(solveSketch(doc).degreesOfFreedom,0);
  assert.throws(()=>admitSelectedPlateProfile(doc,l),/stale, unsafe or modified/);
});

test('enclosing contour is rejected from either direction without inferred subtraction',()=>{
  const doc=addRectangle(createDimensionedLPlateSketch(),'enclosing',-10,-10,160,110);
  const discovery=discoverPlateProfiles(doc);
  const l=choose(doc);
  const surrounding=choose(doc,discovery.candidates.find(c=>c.lineIds.length===4).id);
  assert.equal(l.kind,'refused');
  assert.equal(surrounding.kind,'refused');
  assert.equal(l.reason,'unselected_lines_contact_or_overlap_selected_bounds');
  assert.equal(surrounding.reason,l.reason);
});
