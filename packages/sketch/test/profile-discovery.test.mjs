import test from 'node:test';
import assert from 'node:assert/strict';
import {plateSketchFixture,editConstraint,createSketch,serializeSketch,parseSketch} from '../index.mjs';
import {PROFILE_DISCOVERY_VERSION,discoverPlateProfiles,admitDiscoveredPlateProfile} from '../profile-discovery.mjs';

const rectangle=()=>plateSketchFixture();
const fixed=(id,x,y)=>({id:'fix:'+id,kind:'fixed',point:id,x,y});
const appendIsolatedRectangle=(doc,prefix,x,y,w,h)=>{
  const points=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([a,b],i)=>({id:prefix+':p'+i,x:a,y:b}));
  doc.points.push(...points);
  doc.lines.push(...points.map((p,i)=>({id:prefix+':e'+i,start:p.id,end:points[(i+1)%4].id})));
  doc.constraints.push(...points.map(p=>fixed(p.id,p.x,p.y)));
  return doc;
};
const rearrangeLines=(doc)=>{
  doc.lines.reverse();
  for(const line of doc.lines) [line.start,line.end]=[line.end,line.start];
  return doc;
};

test('ordered and unordered/reversed plate loops yield one preview with two genuine holes',()=>{
  const doc=rectangle(), before=serializeSketch(doc);
  const r=discoverPlateProfiles(doc);
  assert.equal(r.version,PROFILE_DISCOVERY_VERSION);
  assert.equal(r.previewOnly,true);
  assert.equal(r.status,'ready');
  assert.equal(r.sourceStatus,'solved');
  assert.equal(r.candidates.length,1);
  assert.deepEqual(r.candidates[0].lineIds,['bottom','left','right','top']);
  assert.deepEqual(r.candidates[0].holeIds,['holeA','holeB']);
  assert.ok(Math.abs(r.candidates[0].profile.areaMm2-(9600-72*Math.PI))<1e-8);
  assert.equal(r.candidates[0].profile.status,'analytic_profile_only');
  assert.equal(serializeSketch(doc),before);
  assert.equal(admitDiscoveredPlateProfile(doc,r,r.candidates[0].id).areaMm2,r.candidates[0].profile.areaMm2);

  const shuffled=rearrangeLines(rectangle());
  const s=discoverPlateProfiles(shuffled);
  assert.equal(s.status,'ready');
  assert.equal(s.candidates[0].id,r.candidates[0].id);
  assert.deepEqual(s.candidates[0].profile,r.candidates[0].profile);
  assert.deepEqual(s.candidates[0].holeIds,r.candidates[0].holeIds);
  assert.ok(s.candidates[0].orderedEdges.some(e=>e.reversed));
  assert.equal(admitDiscoveredPlateProfile(shuffled,s,s.candidates[0].id).status,'analytic_profile_only');
});

test('parameter edits and serialization replay keep semantic line identity and update area',()=>{
  for(const width of [90,110,120,140,160]) for(const height of [70,80,100]) {
    let doc=editConstraint(editConstraint(rectangle(),'width',{value:width}),'height',{value:height});
    doc=parseSketch(serializeSketch(doc));
    const r=discoverPlateProfiles(doc);
    assert.equal(r.status,'ready',width+' x '+height);
    assert.equal(r.candidates[0].id,'cycle:bottom|left|right|top');
    assert.ok(Math.abs(r.candidates[0].profile.areaMm2-(width*height-72*Math.PI))<1e-8);
    const admitted=admitDiscoveredPlateProfile(doc,r,r.candidates[0].id);
    assert.equal(admitted.outer.length,4);
    assert.equal(admitted.holes.length,2);
  }
});

test('forged, stale, changed and ambiguous previews are never admitted',()=>{
  const doc=rectangle(), r=discoverPlateProfiles(doc), id=r.candidates[0].id;
  const changed=editConstraint(doc,'width',{value:140});
  assert.throws(()=>admitDiscoveredPlateProfile(changed,r,id),/stale, ambiguous or modified/);
  const fake=structuredClone(r);
  fake.candidates[0].profile.areaMm2+=1;
  assert.throws(()=>admitDiscoveredPlateProfile(doc,fake,id),/stale, ambiguous or modified/);
  const badDirection=structuredClone(r);
  badDirection.candidates[0].orderedEdges[0].reversed=!badDirection.candidates[0].orderedEdges[0].reversed;
  assert.throws(()=>admitDiscoveredPlateProfile(doc,badDirection,id),/stale, ambiguous or modified/);
  assert.throws(()=>admitDiscoveredPlateProfile(doc,r,'cycle:phantom'),/unknown candidate/);
  assert.throws(()=>admitDiscoveredPlateProfile(doc,null,id),/invalid admission/);
});

test('underconstrained and contradicted authored dimensions never produce a profile',()=>{
  const under=rectangle();
  under.constraints=under.constraints.filter(c=>c.id!=='width');
  const a=discoverPlateProfiles(under);
  assert.equal(a.status,'source_unsolved');
  assert.equal(a.sourceStatus,'underconstrained');
  assert.deepEqual(a.candidates,[]);
  const conflict=rectangle();
  conflict.constraints.push({id:'incompatible',kind:'distanceX',a:'p0',b:'p1',value:121});
  const b=discoverPlateProfiles(conflict);
  assert.equal(b.status,'source_unsolved');
  assert.equal(b.sourceStatus,'conflicted');
  assert.deepEqual(b.candidates,[]);
});

test('a disconnected dangling edge cannot be silently erased from an accepted profile',()=>{
  const doc=rectangle();
  doc.points.push({id:'loose1',x:200,y:200},{id:'loose2',x:240,y:220});
  doc.constraints.push(fixed('loose1',200,200),fixed('loose2',240,220));
  doc.lines.push({id:'loose',start:'loose1',end:'loose2'});
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'ambiguous');
  assert.equal(r.candidates.length,1);
  assert.deepEqual(r.rejected.map(d=>d.lineIds),[['loose']]);
  assert.equal(r.rejected[0].reason,'open_or_branching_component');
  assert.throws(()=>admitDiscoveredPlateProfile(doc,r,r.candidates[0].id),/ambiguous/);
});

test('branching T-junction is not silently promoted to a closed profile',()=>{
  const doc=rectangle();
  doc.points.push({id:'branch',x:-20,y:0});
  doc.constraints.push(fixed('branch',-20,0));
  doc.lines.push({id:'branchLine',start:'p0',end:'branch'});
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'no_profile');
  assert.equal(r.candidates.length,0);
  assert.equal(r.rejected[0].reason,'open_or_branching_component');
});

test('two independent closed loops remain explicit selection ambiguity',()=>{
  const doc=appendIsolatedRectangle(rectangle(),'other',200,100,30,20);
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'ambiguous');
  assert.equal(r.candidates.length,2);
  assert.deepEqual(r.candidates[0].lineIds,['bottom','left','right','top']);
  assert.ok(r.candidates[1].profile.areaMm2===600);
  assert.throws(()=>admitDiscoveredPlateProfile(doc,r,r.candidates[0].id),/ambiguous/);
});

test('nested enclosed loops are not auto-classified as outer/inner Boolean topology',()=>{
  const doc=appendIsolatedRectangle(rectangle(),'nested',40,15,10,10);
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'ambiguous');
  assert.equal(r.candidates.length,2);
});

test('circle crossing or just touching an outer boundary rejects the profile',()=>{
  for(const x of [1,5,6,120,125]) {
    const doc=editConstraint(rectangle(),'holeA:fixed',{x});
    const r=discoverPlateProfiles(doc);
    assert.equal(r.status,'no_profile','x='+x);
    assert.equal(r.rejected[0].reason,'ambiguous_circle_contact');
  }
});

test('intersecting hole circles preserve a negative profile witness',()=>{
  const doc=editConstraint(rectangle(),'holeB:fixed',{x:39});
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'no_profile');
  assert.equal(r.rejected[0].reason,'profile_validation_failed');
  assert.match(r.rejected[0].detail,/overlap/);
});

test('outside independent circle does not become a hole of the selected line loop',()=>{
  const doc=editConstraint(rectangle(),'holeB:fixed',{x:160});
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'ready');
  assert.deepEqual(r.candidates[0].holeIds,['holeA']);
  assert.ok(Math.abs(r.candidates[0].profile.areaMm2-(9600-36*Math.PI))<1e-8);
});

test('self-intersecting closed bow-tie does not pass the original analytic validation',()=>{
  const coords=[[0,0],[2,2],[0,2],[2,0]];
  const points=coords.map(([x,y],i)=>({id:'q'+i,x,y}));
  const lines=points.map((p,i)=>({id:'e'+i,start:p.id,end:points[(i+1)%4].id}));
  const doc=createSketch({version:1,units:'mm',points,lines,circles:[],
    constraints:points.map(p=>fixed(p.id,p.x,p.y))});
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'no_profile');
  assert.equal(r.rejected[0].reason,'profile_validation_failed');
  assert.match(r.rejected[0].detail,/self-intersecting/);
});

test('semantic point IDs are required: coincident visual coordinates do not weld an open chain',()=>{
  const doc=rectangle();
  doc.points.push({id:'extra',x:0,y:0});
  doc.constraints.push(fixed('extra',0,0));
  doc.lines.find(l=>l.id==='left').end='extra';
  const r=discoverPlateProfiles(doc);
  assert.equal(r.status,'no_profile');
  assert.equal(r.rejected[0].reason,'open_or_branching_component');
});

test('explicit budgets and validation enforce no unbounded discovery or invented keys',()=>{
  const doc=rectangle();
  assert.equal(discoverPlateProfiles(doc,{maxLines:3}).status,'budget_exceeded');
  assert.equal(discoverPlateProfiles(doc,{maxCircles:1}).status,'budget_exceeded');
  assert.equal(discoverPlateProfiles(doc,{maxCandidates:1}).status,'ready');
  assert.throws(()=>discoverPlateProfiles(doc,{maxLines:0}),/invalid maxLines/);
  assert.throws(()=>discoverPlateProfiles(doc,{maxCandidates:65}),/invalid maxCandidates/);
  assert.throws(()=>discoverPlateProfiles(doc,{maxTimeMs:20}),/invalid options/);
  const two=appendIsolatedRectangle(rectangle(),'other',200,100,30,20);
  assert.equal(discoverPlateProfiles(two,{maxCandidates:1}).status,'budget_exceeded');
});

test('reversing every line in a multi-cycle sketch retains deterministic candidate identities',()=>{
  const doc=appendIsolatedRectangle(rectangle(),'other',200,100,30,20);
  const canonical=discoverPlateProfiles(doc);
  const reversed=discoverPlateProfiles(rearrangeLines(doc));
  assert.equal(canonical.status,'ambiguous');
  assert.deepEqual(canonical.candidates.map(x=>x.id),reversed.candidates.map(x=>x.id));
  assert.deepEqual(canonical.candidates.map(x=>x.profile),reversed.candidates.map(x=>x.profile));
});
