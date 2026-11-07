import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OCCT8_MIXED_CUT_PROTOCOL,parseOcct8MixedCutRequest,
  expectedOcct8MixedCutMetrics,assessOcct8MixedCutResponse}
  from '../src/occt8-mixed-cut-v2.mjs';
import {runPinnedOcct8MixedCutChain}
  from '../src/local-occt8-mixed-cut-provider.mjs';
function fixture() {
  return {protocol:OCCT8_MIXED_CUT_PROTOCOL,requestId:'test.mixed',
    featureId:'body.plate',revision:8,units:'mm',exportStep:true,
    plate:{width:120,depth:80,thickness:8,
      holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]},
    cuts:[
      {featureId:'cut.round',kind:'circle',x:-10,y:20,radius:5,cutDepthMm:3},
      {featureId:'cut.window',kind:'rectangle',x:5,y:-20,
        width:10,depth:8,cutDepthMm:8},
    ]};
}
test('mixed round/rectangle C++ request preserves IDs and changed-dimension mass',()=>{
  const a=parseOcct8MixedCutRequest(fixture());
  assert.deepEqual(a.cuts.map(c=>c.kind),['circle','rectangle']);
  const v=expectedOcct8MixedCutMetrics(a).volumeMm3;
  const expected=(120*80-2*Math.PI*36)*8-Math.PI*25*3-10*8*8;
  assert.ok(Math.abs(v-expected)<1e-7);
  const b=fixture();b.plate.thickness=12;b.cuts[0].cutDepthMm=5;
  b.cuts[1].cutDepthMm=12;b.revision=12;
  assert.ok(expectedOcct8MixedCutMetrics(parseOcct8MixedCutRequest(b)).volumeMm3>v);
  assert.deepEqual(b.cuts.map(c=>c.featureId),a.cuts.map(c=>c.featureId));
});
test('reject circular bore collision, rectangle collision, escaped hole and stale request',()=>{
  for(const edit of [
    q=>{q.cuts[0].x=-30;q.cuts[0].y=0;},
    q=>{q.cuts[0].x=5;q.cuts[0].y=-20;},
    q=>{q.cuts[0].radius=60;},
    q=>{q.cuts[1].cutDepthMm=9;},
    q=>{q.cuts[1].featureId=q.cuts[0].featureId;},
  ]){
    const q=fixture();edit(q);
    assert.throws(()=>parseOcct8MixedCutRequest(q));
  }
  const q=fixture();
  assert.equal(assessOcct8MixedCutResponse(q,{
    protocol:q.protocol,requestId:q.requestId,status:'timeout',message:'timeout'
  },{currentRevision:9}).code,'stale_revision');
});
test('reject fake successful native report with wrong cut volume',()=>{
  const q=fixture();
  const m=expectedOcct8MixedCutMetrics(q);
  const circle=[...q.plate.holes,{x:-10,y:20,radius:5}]
    .sort((a,b)=>a.x-b.x||a.y-b.y);
  const metrics={valid:true,solidCount:1,
    volumeMm3:m.volumeMm3+100,surfaceAreaMm2:m.surfaceAreaMm2,
    cylindricalHoles:circle.map(c=>({...c,axisZ:1}))};
  const raw={protocol:q.protocol,requestId:q.requestId,featureId:q.featureId,
    revision:q.revision,backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    status:'validated_exact',units:'mm',source:metrics,stepReadback:metrics,
    stepWritten:true,stepPath:'/not-real.step',stepSha256:'a'.repeat(64),
    stepVerification:'occt-8.0.1-same-engine'};
  assert.throws(()=>assessOcct8MixedCutResponse(q,raw,{currentRevision:8}),/mass or area/);
});
test('missing real C++ executable returns unresolved without STEP',async()=>{
  const d=await mkdtemp(join(tmpdir(),'intuit3d-mixed-test-'));
  try{
    const output=join(d,'must-not-exist.step');
    const result=await runPinnedOcct8MixedCutChain(fixture(),{
      workerExecutable:join(d,'not-installed'),
      readCurrentRevision:()=>8,stepOutput:output,timeoutMs:2000,
    });
    assert.equal(result.kind,'unresolved');
    await assert.rejects(stat(output),{code:'ENOENT'});
  }finally{await rm(d,{recursive:true,force:true});}
});
test('actual C++ circular pocket plus rectangle STEP on pinned 8.0.1',
  {skip:!process.env.INTUIT3D_OCCT8_WORKER},async()=>{
  const d=await mkdtemp(join(tmpdir(),'intuit3d-mixed-real-'));
  try{
    const output=join(d,'real-mixed.step');
    const result=await runPinnedOcct8MixedCutChain(fixture(),{
      workerExecutable:process.env.INTUIT3D_OCCT8_WORKER,
      readCurrentRevision:()=>8,stepOutput:output,timeoutMs:120000});
    assert.equal(result.kind,'experimental_report',JSON.stringify(result));
    assert.equal(result.observed.source.cylindricalHoles.length,3);
    assert.equal(result.exactAuthority,false);
    assert.ok((await readFile(output)).includes(Buffer.from('ISO-10303-21')));
  }finally{await rm(d,{recursive:true,force:true});}
});
