import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  OCCT8_FLEXIBLE_LINEAR_PROTOCOL,parseOcct8FlexibleLinearRequest,
  expectedOcct8FlexibleLinearMetrics,assessOcct8FlexibleLinearResponse,
} from '../src/occt8-flexible-linear-v6.mjs';
import {parseOcct8LinearProfileRequest} from '../src/occt8-linear-profile-v5.mjs';
import {requestFromRuntimeOcct8Flexible}
  from '../src/runtime-occt8-flexible-linear-provider.mjs';
import {runPinnedOcct8FlexibleLinear}
  from '../src/local-occt8-flexible-linear-provider.mjs';
import {buildAuthoredSlopedBracket,SLOPED_BODY_ID}
  from '../examples/runtime-occt8-sloped-profile-document.mjs';
import {editExtrudeThickness} from '@intuit3d/feature-ops';

const base=JSON.parse(readFileSync(new URL(
  '../../../native/examples/occt8-sloped-bracket-linear.request.json',
  import.meta.url),'utf8'));
function request(n,t=8){
  const q=structuredClone(base);
  q.protocol=OCCT8_FLEXIBLE_LINEAR_PROTOCOL;
  q.profile.thickness=t;
  q.cuts=q.cuts.slice(0,n);
  if(n===2)q.cuts[1].cutDepthMm=t;
  q.revision=20+n*2+(t===12?1:0);
  q.requestId='native.progressive.v6.'+n+'.'+t;
  return q;
}
test('v6 standalone and one-cut solids are accepted; v5 still requires two cuts',()=>{
  for(let n=0;n<=2;n++)for(const t of [8,12]){
    const q=parseOcct8FlexibleLinearRequest(request(n,t));
    assert.equal(q.cuts.length,n);
    const mass=expectedOcct8FlexibleLinearMetrics(q);
    const volume=5700*t-(n>=1?75*Math.PI:0)-(n===2?112*t:0);
    assert.ok(Math.abs(mass.volumeMm3-volume)<1e-7);
    if(n<2)assert.throws(()=>parseOcct8LinearProfileRequest({
      ...q,protocol:'intuit3d/kernel/linear-profile-cut-chain-v5'}));
  }
});
test('v6 refuses fabricated physical topology, stale revisions and boundary escapes',()=>{
  const q=request(0);
  const m=expectedOcct8FlexibleLinearMetrics(q);
  const source={valid:true,solidCount:1,...m,cylindricalHoles:[]};
  const raw={protocol:q.protocol,requestId:q.requestId,featureId:q.featureId,
    revision:q.revision,status:'validated_exact',backend:'OCCT-cxx-8.0.1',
    occtVersion:'8.0.1',units:'mm',source,stepReadback:null,stepWritten:false};
  const noExport={...q,exportStep:false};
  assert.equal(assessOcct8FlexibleLinearResponse(noExport,raw,
    {currentRevision:q.revision}).kind,'experimental_report');
  assert.equal(assessOcct8FlexibleLinearResponse(noExport,raw,
    {currentRevision:q.revision+1}).code,'stale_revision');
  assert.throws(()=>assessOcct8FlexibleLinearResponse(noExport,{
    ...raw,source:{...source,solidCount:2}},{currentRevision:q.revision}));
  assert.throws(()=>parseOcct8FlexibleLinearRequest({
    ...request(1),cuts:[{...request(1).cuts[0],x:55,y:50}]}));
  assert.throws(()=>parseOcct8FlexibleLinearRequest({
    ...request(0),units:'inch'}));
});
test('actual authored SKETCH body can be exported before cuts, after one and after two',()=>{
  for(let n=0;n<=2;n++){
    const fixture=buildAuthoredSlopedBracket({cutCount:n});
    const get=(f,id)=>requestFromRuntimeOcct8Flexible(
      f.history,SLOPED_BODY_ID,{runtime:f.runtime,model:f.model,
        requestId:id,exportStep:false});
    const first=get(fixture,'progressive.initial.'+n);
    assert.equal(first.profile.thickness,8);
    assert.equal(first.cuts.length,n);
    assert.equal(first.featureId,SLOPED_BODY_ID);
    const edited=editExtrudeThickness(fixture.history,{
      eventId:'progressive.edit.'+n,
      expectedRevision:fixture.history.document.revision,
      featureId:'extrude.sloped',thicknessMm:12,
    },fixture.services);
    const reopen={...fixture,
      history:fixture.runtime.reopen(fixture.runtime.save(edited.history))};
    const second=get(reopen,'progressive.edited.'+n);
    assert.equal(second.profile.profileId,first.profile.profileId);
    assert.deepEqual(second.cuts.map(c=>c.featureId),
      first.cuts.map(c=>c.featureId));
    assert.equal(second.profile.thickness,12);
    assert.ok(expectedOcct8FlexibleLinearMetrics(second).volumeMm3>
      expectedOcct8FlexibleLinearMetrics(first).volumeMm3);
  }
});
test('v6 zero-cut export refuses untracked sketch dependencies and wrong source frame',()=>{
  const fixture=buildAuthoredSlopedBracket({cutCount:0});
  const features=fixture.model.featuresOf(fixture.history.document);
  const baseFeature=features.find(f=>f.kind==='extrude'&&
    f.writeTargets?.includes(SLOPED_BODY_ID));
  assert.ok(baseFeature?.dependsOn?.includes(baseFeature.payload.sourceSketchId));
  assert.equal(baseFeature.payload.units,'mm');
  assert.equal(baseFeature.payload.frame,'local_xy');
  const options={runtime:fixture.runtime,model:fixture.model,
    requestId:'progressive.provenance.good',exportStep:false};
  assert.equal(requestFromRuntimeOcct8Flexible(fixture.history,SLOPED_BODY_ID,
    options).cuts.length,0);
  for(const corrupt of [
    f=>({...f,dependsOn:[]}),
    f=>({...f,payload:{...f.payload,frame:'world_xy'}}),
    f=>({...f,payload:{...f.payload,units:'inch'}}),
  ]){
    // Inject an inconsistent feature record without changing RUNTIME's
    // original solved journal, isolating the native adapter's own admission.
    const model={featuresOf:()=>features.map(f=>f===baseFeature?corrupt(f):f)};
    assert.throws(()=>requestFromRuntimeOcct8Flexible(
      fixture.history,SLOPED_BODY_ID,{...options,model}),
      /base extrusion must depend on its selected local-mm SKETCH/);
  }
});
test('v6 requires an explicit pinned native worker without preview fallback',async()=>{
  await assert.rejects(()=>runPinnedOcct8FlexibleLinear(request(0),{
    readCurrentRevision:()=>20,
  }),/workerExecutable/);
});
