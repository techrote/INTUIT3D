import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOcct8LProfileRequest,expectedOcct8LProfileMetrics,
  assessOcct8LProfileResponse} from '../src/occt8-l-profile-v3.mjs';
const request={
  protocol:'intuit3d/kernel/l-profile-cut-chain-v3',
  requestId:'lbracket.8',featureId:'body.lbracket',revision:8,
  units:'mm',exportStep:true,
  profile:{profileId:'sketch.lbracket',width:120,depth:80,
    thickness:8,legWidth:30,footHeight:20},
  cuts:[
    {featureId:'pocket.blind',kind:'circle',x:-45,y:10,
      radius:5,cutDepthMm:3},
    {featureId:'window.through',kind:'rectangle',x:15,y:-30,
      width:10,depth:8,cutDepthMm:8},
  ],
};
test('selected L profile: dimension edit changes material, stable identities',()=>{
  const a=parseOcct8LProfileRequest(request);
  const b=parseOcct8LProfileRequest({...request,revision:12,profile:{
    ...request.profile,thickness:12},cuts:[
    {...request.cuts[0],cutDepthMm:5},
    {...request.cuts[1],cutDepthMm:12},
  ]});
  assert.equal(a.profile.profileId,b.profile.profileId);
  assert.deepEqual(a.cuts.map(x=>x.featureId),b.cuts.map(x=>x.featureId));
  const area=120*20+30*(80-20);
  const expected8=area*8-Math.PI*25*3-10*8*8;
  const expected12=area*12-Math.PI*25*5-10*8*12;
  assert.ok(Math.abs(expectedOcct8LProfileMetrics(a).volumeMm3-expected8)<1e-8);
  assert.ok(Math.abs(expectedOcct8LProfileMetrics(b).volumeMm3-expected12)<1e-8);
});
test('missing L material, duplicate semantic ID, degenerate notch rejected',()=>{
  assert.throws(()=>parseOcct8LProfileRequest({...request,cuts:[
    {...request.cuts[0],x:10,y:10},request.cuts[1]]}),/missing L-profile material/);
  assert.throws(()=>parseOcct8LProfileRequest({...request,cuts:[
    {...request.cuts[0],featureId:request.profile.profileId},request.cuts[1]]}),/identity/);
  assert.throws(()=>parseOcct8LProfileRequest({...request,profile:{
    ...request.profile,legWidth:120}}),/notch/);
});
test('native metric, revision and STEP receipts are never fabricated as authority',()=>{
  const q=parseOcct8LProfileRequest(request);
  const m=expectedOcct8LProfileMetrics(q);
  const measured={valid:true,solidCount:1,...m,
    cylindricalHoles:[{x:-45,y:10,radius:5,axisZ:1}]};
  const response={protocol:q.protocol,requestId:q.requestId,
    featureId:q.featureId,revision:q.revision,
    backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',status:'validated_exact',
    units:'mm',source:measured,stepReadback:measured,stepWritten:true,
    stepPath:'/tmp/private.step',stepSha256:'0'.repeat(64),
    stepVerification:'occt-8.0.1-same-engine'};
  const verdict=assessOcct8LProfileResponse(q,response,{currentRevision:8});
  assert.equal(verdict.kind,'experimental_report');
  assert.equal(verdict.exactAuthority,false);
  assert.equal(verdict.independentInteroperability,false);
  assert.equal(assessOcct8LProfileResponse(q,response,{currentRevision:9}).code,
    'stale_revision');
  assert.throws(()=>assessOcct8LProfileResponse(q,{...response,
    source:{...measured,volumeMm3:measured.volumeMm3-80}},
    {currentRevision:8}),/mass\/area/);
});
