import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseOcct8CutRequest, expectedOcct8CutMetrics, assessOcct8CutResponse} from '../src/occt8-cut-v1.mjs';
import {runPinnedOcct8CutChain} from '../src/local-occt8-cut-provider.mjs';

const request=()=>{
  return {protocol:'intuit3d/kernel/plate-cut-chain-v1',
    requestId:'fixture.ordered-pocket',featureId:'body.plate',revision:8,
    units:'mm',exportStep:true,
    plate:{width:120,depth:80,thickness:8,
      holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]},
    cuts:[
      {featureId:'cut.blind',x:-10,y:20,width:12,depth:10,cutDepthMm:3},
      {featureId:'cut.through',x:5,y:-20,width:10,depth:8,cutDepthMm:8},
    ]};
};

test('semantic ordered-cut admission and retrospective dimension edit',()=>{
  const original=parseOcct8CutRequest(request());
  assert.deepEqual(original.cuts.map(c=>c.featureId),['cut.blind','cut.through']);
  const expected=expectedOcct8CutMetrics(original);
  const volume=(120*80-2*Math.PI*36)*8-12*10*3-10*8*8;
  assert.ok(Math.abs(expected.volumeMm3-volume)<1e-7);
  const modified=request();
  modified.plate.thickness=12; modified.cuts[1].cutDepthMm=12;
  assert.notEqual(expectedOcct8CutMetrics(parseOcct8CutRequest(modified)).volumeMm3,volume);
});

test('reject material overcut, bore intersection, duplicate identity and touching cuts',()=>{
  for(const edit of [
    r=>{r.cuts[0].cutDepthMm=9;},
    r=>{r.cuts[0].x=-30;r.cuts[0].y=0;},
    r=>{r.cuts[1].featureId='cut.blind';},
    r=>{r.cuts[1].x=-10;r.cuts[1].y=20;},
  ]) { const bad=request(); edit(bad); assert.throws(()=>parseOcct8CutRequest(bad));}
});

test('reject fabricated successful C++ cut report with incorrect mass',()=>{
  const r=request(), metrics=expectedOcct8CutMetrics(r);
  const source={valid:true,solidCount:1,volumeMm3:metrics.volumeMm3+120,
    surfaceAreaMm2:metrics.surfaceAreaMm2,
    cylindricalHoles:r.plate.holes.map(h=>({...h,axisZ:1}))};
  const report={protocol:r.protocol,requestId:r.requestId,featureId:r.featureId,
    revision:r.revision,backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    status:'validated_exact',units:'mm',source,stepReadback:source,
    stepWritten:true,stepPath:'/tmp/not-real.step',
    stepSha256:'a'.repeat(64),stepVerification:'occt-8.0.1-same-engine'};
  assert.throws(()=>assessOcct8CutResponse(r,report,{currentRevision:8}),/mass\/area/);
});

test('real process spawn failure leaves no STEP, no false positive',async()=>{
  const d=await mkdtemp(join(tmpdir(),'intuit3d-occt8-cut-test-'));
  try {
    const out=join(d,'never.step');
    const result=await runPinnedOcct8CutChain(request(),{
      workerExecutable:join(d,'not-a-native-worker'),
      readCurrentRevision:()=>8,stepOutput:out,timeoutMs:2500,
    });
    assert.equal(result.kind,'unresolved');
    assert.notEqual(result.code,'validated_exact');
    await assert.rejects(stat(out),{code:'ENOENT'});
  } finally {await rm(d,{recursive:true,force:true});}
});

test('actual pinned C++ ordered-cut STEP only with provisioned binary',
  {skip:!process.env.INTUIT3D_OCCT8_WORKER},async()=>{
  const d=await mkdtemp(join(tmpdir(),'intuit3d-native-cut-executed-'));
  try {
    const r=request(),output=join(d,'real-cxx.step');
    const result=await runPinnedOcct8CutChain(r,{
      workerExecutable:process.env.INTUIT3D_OCCT8_WORKER,
      readCurrentRevision:()=>8,stepOutput:output,timeoutMs:120000,
    });
    assert.equal(result.kind,'experimental_report',JSON.stringify(result));
    assert.equal(result.exactAuthority,false);
    assert.equal(result.artifact.sha256.length,64);
    assert.ok((await readFile(output)).includes(Buffer.from('ISO-10303-21')));
  } finally {await rm(d,{recursive:true,force:true});}
});
