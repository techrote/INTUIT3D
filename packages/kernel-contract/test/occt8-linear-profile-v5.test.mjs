import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseOcct8LinearProfileRequest,expectedOcct8LinearMetrics,
  assessOcct8LinearResponse} from '../src/occt8-linear-profile-v5.mjs';
import {parseOcct8OrthogonalProfileRequest}
  from '../src/occt8-orthogonal-profile-v4.mjs';
import {runPinnedOcct8LinearProfileChain}
  from '../src/local-occt8-linear-profile-provider.mjs';
const SOURCE=JSON.parse(await readFile(new URL(
  '../../../native/examples/occt8-sloped-bracket-linear.request.json',import.meta.url)));
const change=(fn)=>{const x=structuredClone(SOURCE);fn(x);return x;};
test('v5 sloped concave selected contour has independently calculated mass',()=>{
  const q=parseOcct8LinearProfileRequest(SOURCE);
  assert.deepEqual(q.cuts.map(c=>c.featureId),[
    'cut.sloped.blind','cut.sloped.through']);
  assert.equal(q.profile.profileId,'sketch.sloped.bracket');
  const expected=expectedOcct8LinearMetrics(q);
  assert.ok(Math.abs(expected.volumeMm3-
    (5700*8-75*Math.PI-14*8*8))<1e-8);
  assert.ok(Math.abs(expected.surfaceAreaMm2-
    (2*5700+(320+Math.sqrt(4000))*8+30*Math.PI+2*(14+8)*8-2*112))<1e-8);
  assert.throws(()=>parseOcct8OrthogonalProfileRequest(SOURCE));
  const revised=change(x=>{
    x.profile.thickness=12;x.cuts[1].cutDepthMm=12;
    x.revision=15;x.requestId='selected.sloped.bracket.12';
  });
  const second=parseOcct8LinearProfileRequest(revised);
  assert.equal(second.featureId,q.featureId);
  assert.deepEqual(second.cuts.map(c=>c.featureId),q.cuts.map(c=>c.featureId));
  assert.ok(Math.abs(expectedOcct8LinearMetrics(second).volumeMm3-
    (5700*12-75*Math.PI-14*8*12))<1e-8);
});
test('v5 rejects winding, crossings, diagonal boundary touch, cut overlap and unit changes',()=>{
  const bad=[
    change(x=>x.profile.vertices.reverse()),
    change(x=>x.cuts[0].x=55),
    change(x=>{x.cuts[0].x=55;x.cuts[0].y=50;}),
    change(x=>{x.cuts[1].x=55;x.cuts[1].y=50;}),
    change(x=>{x.cuts[1].x=15;x.cuts[1].y=50;}),
    change(x=>{x.profile.vertices[4]={x:110,y:-10};}),
    change(x=>{x.profile.vertices[3]={x:120,y:0};}),
    change(x=>{x.units='inch';}),
    change(x=>{x.cuts[1].cutDepthMm=9;}),
    change(x=>{x.profile.vertices[0].x=1e9;}),
  ];
  for(const candidate of bad)
    assert.throws(()=>parseOcct8LinearProfileRequest(candidate));
});
test('v5 native protocol refuses forged physical mass, wrong STEP and stale revision',()=>{
  const q=parseOcct8LinearProfileRequest(SOURCE);
  const metrics=expectedOcct8LinearMetrics(q);
  const m={valid:true,solidCount:1,...metrics,cylindricalHoles:[
    {x:15,y:50,radius:5,axisZ:1}]};
  const raw={protocol:q.protocol,requestId:q.requestId,featureId:q.featureId,
    revision:q.revision,backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    status:'validated_exact',units:'mm',source:m,stepReadback:m,stepWritten:true,
    stepPath:'/private/sloped.step',stepSha256:'a'.repeat(64),
    stepVerification:'occt-8.0.1-same-engine'};
  const checked=assessOcct8LinearResponse(q,raw,{currentRevision:q.revision});
  assert.equal(checked.kind,'experimental_report');
  assert.equal(checked.exactAuthority,false);
  assert.equal(checked.independentInteroperability,false);
  assert.equal(assessOcct8LinearResponse(q,raw,{currentRevision:999}).code,'stale_revision');
  assert.throws(()=>assessOcct8LinearResponse(q,{...raw,
    stepReadback:{...m,volumeMm3:metrics.volumeMm3-1}},
    {currentRevision:q.revision}));
  assert.throws(()=>assessOcct8LinearResponse(q,{...raw,
    stepVerification:'independent-CAD'},{currentRevision:q.revision}));
});
test('v5 native adapter refuses non-executable and never silently selects OCP',async()=>{
  await assert.rejects(()=>runPinnedOcct8LinearProfileChain(SOURCE,{
    readCurrentRevision:()=>SOURCE.revision,
  }),/workerExecutable/);
});
