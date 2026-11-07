import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlateRequest, expectedPlateMetrics, assessPlateResponse, PLATE_PROTOCOL,
  KernelContractError} from '../src/plate-v1.mjs';

const input = (holes = [{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]) => ({
  protocol:PLATE_PROTOCOL, requestId:'req.1', featureId:'plate.1', revision:7, units:'mm',
  plate:{width:120,depth:80,thickness:8,holes}, exportStep:true
});
const metric = (request) => ({valid:true,solidCount:1, ...expectedPlateMetrics(request.plate),
  cylindricalHoles:[...request.plate.holes].sort((a,b)=>a.x-b.x || a.y-b.y || a.radius-b.radius)
    .map(h=>({...h,axisZ:1}))});
const success = request => ({protocol:PLATE_PROTOCOL,requestId:request.requestId,
  featureId:request.featureId,revision:request.revision,backend:'OCP-python-prototype',
  occtVersion:'7.9.3.1',status:'validated_exact',units:'mm',source:metric(request),
  stepReadback:metric(request),stepWritten:true});
const assess = (r,s) => assessPlateResponse(r,s,{currentRevision:r.revision});
const rejects = (fn) => assert.throws(fn,KernelContractError);

test('typed request round-trip with independent copy',()=>{
  const r=input(); const copy=parsePlateRequest(r);
  assert.deepEqual(copy,r); copy.plate.holes[0].x = -29;
  assert.equal(r.plate.holes[0].x,-30);
});
test('independent numerical oracle for two-hole plate',()=>{
  const m=expectedPlateMetrics(input().plate);
  assert.ok(Math.abs(m.volumeMm3-74990.44263153228)<1e-8);
  assert.ok(Math.abs(m.surfaceAreaMm2-22550.79644737231)<1e-8);
});
test('accepts only pinned experimental report, never authoritative B-rep/STEP',()=>{
  const r=input();const result=assess(r,success(r));
  assert.equal(result.kind,'experimental_report');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.step,'same_engine_readback_reported');
});
test('no-export report cannot claim STEP evidence',()=>{
  const r=input([]);r.exportStep=false;const s=success(r);
  s.stepReadback=null;s.stepWritten=false;
  assert.equal(assess(r,s).step,'not_requested');
  s.stepReadback=metric(r);rejects(()=>assess(r,s));
  s.stepReadback=null;s.stepWritten=true;rejects(()=>assess(r,s));
});
test('rejects stale requests regardless of provider claim',()=>{
  const r=input();const res=assessPlateResponse(r,success(r),{currentRevision:8});
  assert.deepEqual(res,{kind:'unresolved',code:'stale_revision',requestId:'req.1',featureId:'plate.1',revision:7});
  rejects(()=>assessPlateResponse(r,success(r),{}));
});
test('retains explicit timeout and reconciliation failure without manufactured exact result',()=>{
  const r=input();for(const code of ['timeout','worker_crash','requires_reconciliation','invalid_request']){
    const response={protocol:PLATE_PROTOCOL,requestId:r.requestId,status:code,message:'worker refused'};
    assert.deepEqual(assess(r,response),{kind:'unresolved',code,requestId:'req.1',featureId:'plate.1',revision:7});
  }
  rejects(()=>assess(r,{protocol:PLATE_PROTOCOL,requestId:r.requestId,status:'approximate_preview',message:'ok'}));
});
test('strict request admission refuses tangency, overlap, invalid numbers and unknown keys',()=>{
  const examples=[
    r=>{r.plate.holes=[{x:54,y:0,radius:6}]},
    r=>{r.plate.holes=[{x:-30,y:0,radius:6},{x:-18,y:0,radius:6}]},
    r=>{r.plate.width=NaN},r=>{r.plate.thickness=Infinity},
    r=>{r.plate.holes[0].radius=1e-7},r=>{r.plate.depth=true},
    r=>{r.revision=Number.MAX_SAFE_INTEGER+1},r=>{r.revision=1.5},
    r=>{r.units='in'},r=>{r.featureId='../bad'},r=>{r.plate.extra=true},
    r=>{r.plate.holes=new Array(65).fill({x:0,y:0,radius:1})},
    r=>{r.exportStep=0},r=>{r.unexpected=0}
  ];
  for (const mutate of examples){const r=input();mutate(r);rejects(()=>parsePlateRequest(r));}
});
test('untrusted success cannot change physical/body/identity/provenance evidence',()=>{
  const r=input();
  const cases=[
    s=>{s.requestId='another'},s=>{s.featureId='another'},s=>{s.revision=6},
    s=>{s.protocol='v0'},s=>{s.units='cm'},s=>{s.status='approximate_preview'},
    s=>{s.backend='occt-wasm'},s=>{s.occtVersion='8.0.1'},
    s=>{s.source.valid=false},s=>{s.source.solidCount=2},
    s=>{s.source.volumeMm3=0},s=>{s.stepReadback.surfaceAreaMm2=0},
    s=>{s.source.cylindricalHoles=[]},s=>{s.source.cylindricalHoles[0].radius=5.99},
    s=>{s.stepReadback.cylindricalHoles[0].x=-29},
    s=>{s.stepReadback.cylindricalHoles[0].axisZ=0.999},
    s=>{s.stepWritten=false},s=>{s.more='forged'},
    s=>{s.stepPath=''},s=>{s.source.cylindricalHoles[0].extra='x'}
  ];
  for(const mutate of cases){const s=success(r); mutate(s); rejects(()=>assess(r,s));}
});
test('micro holes and zero-hole canonical controls',()=>{
  for(const holes of [[],[{x:0,y:0,radius:1e-6}]]){
    const r=input(holes);assert.equal(assess(r,success(r)).kind,'experimental_report');
  }
});
test('tampered success cannot hide a hole despite negligible mass difference',()=>{
  const r=input([{x:0,y:0,radius:1e-6}]);const s=success(r);
  s.source.cylindricalHoles=[];
  rejects(()=>assess(r,s));
});
test('success optional STEP path cannot be substituted for geometry verification',()=>{
  const r=input();const s=success(r);
  s.stepPath='/tmp/export.step';
  const result=assess(r,s);
  assert.equal(result.kind,'experimental_report');
  assert.equal(Object.hasOwn(result,'stepPath'),false);
  s.stepPath=123;rejects(()=>assess(r,s));
});
test('forged failure fields and stale request identity are refused',()=>{
  const r=input();
  rejects(()=>assess(r,{protocol:PLATE_PROTOCOL,requestId:'stale',status:'timeout',message:'ok'}));
  rejects(()=>assess(r,{protocol:PLATE_PROTOCOL,requestId:'req.1',status:'timeout',message:'ok',source:metric(r)}));
  rejects(()=>assess(r,{protocol:PLATE_PROTOCOL,requestId:'req.1',status:'worker_crash',message:'ok',diagnostic:42}));
});
