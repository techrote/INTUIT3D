import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runExperimentalPlate} from '../src/local-plate-provider.mjs';
import {PLATE_PROTOCOL, KernelContractError} from '../src/plate-v1.mjs';

const request = (exportStep = false) => ({
  protocol:PLATE_PROTOCOL, requestId:'request.plate', featureId:'feature.plate',
  revision:4, units:'mm', plate:{width:120,depth:80,thickness:8,
    holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]}, exportStep,
});
const fixtureSource = String.raw`
let text=''; process.stdin.setEncoding('utf8');
process.stdin.on('data', x=>text+=x);
process.stdin.on('end', async()=>{
 const r=JSON.parse(text);
 if(process.env.MOCK_MODE === 'hang') { setInterval(()=>{},1000); return; }
 if(process.env.MOCK_MODE === 'invalid') { console.log('NOT JSON'); return; }
 const holes=r.plate.holes;
 const cuts=holes.reduce((s,h)=>s+Math.PI*h.radius*h.radius,0);
 const walls=holes.reduce((s,h)=>s+2*Math.PI*h.radius,0);
 const metric={valid:true,solidCount:1,volumeMm3:(r.plate.width*r.plate.depth-cuts)*r.plate.thickness,
 surfaceAreaMm2:2*(r.plate.width*r.plate.depth-cuts)+(2*(r.plate.width+r.plate.depth)+walls)*r.plate.thickness,
 cylindricalHoles:holes.map(h=>({...h,axisZ:1}))};
 const stepIndex=process.argv.indexOf('--step-output');
 let stepPath;
 if (stepIndex>=0) {
   stepPath=process.argv[stepIndex+1];
   const fs=await import('node:fs/promises');await fs.writeFile(stepPath,'ISO-10303-21;\\nEND-ISO-10303-21;\\n');
 }
 console.log(JSON.stringify({protocol:r.protocol,requestId:r.requestId,featureId:r.featureId,
 revision:r.revision,units:r.units,status:'validated_exact',backend:'OCP-python-prototype',
 occtVersion:'7.9.3.1',source:metric,stepReadback:r.exportStep?metric:null,
 stepWritten:r.exportStep,...(stepPath?{stepPath}:{})}));
});`;

async function fixture(fn) {
  const dir = await fs.mkdtemp(join(tmpdir(),'intuit3d-js-provider-test-'));
  const script = join(dir,'mock-worker.mjs');
  await fs.writeFile(script,fixtureSource);
  try { return await fn({dir,script}); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
}
const options = script => ({readCurrentRevision:()=>4, pythonExecutable:process.execPath,
  nativeSupervisor:script, timeoutMs:2000});

test('real local subprocess produces explicit experimental measured report; stale revisions never spawn', async()=>fixture(async({script})=>{
  const result=await runExperimentalPlate(request(),options(script));
  assert.equal(result.kind,'experimental_report');
  assert.equal(result.artifact,null);
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.observed.source.solidCount,1);
  const stale=await runExperimentalPlate(request(),{...options('/not/a/script'),readCurrentRevision:()=>5});
  assert.deepEqual(stale,{kind:'unresolved',code:'stale_revision',requestId:'request.plate',
    featureId:'feature.plate',revision:4,artifact:null});
}));

test('STEP publication is an exclusive final step: existing exports cannot be overwritten', async()=>fixture(async({dir,script})=>{
  const path=join(dir,'out.step');
  const first=await runExperimentalPlate(request(true),{...options(script),stepOutput:path});
  assert.equal(first.kind,'experimental_report',JSON.stringify(first));
  assert.equal(first.artifact.path,path);
  assert.equal(first.artifact.verification,'same_engine_step_readback');
  assert.ok(first.artifact.bytes>0);
  const before=await fs.readFile(path);
  const second=await runExperimentalPlate(request(true),{...options(script),stepOutput:path});
  assert.equal(second.code,'requires_reconciliation');
  assert.deepEqual(await fs.readFile(path),before);
}));

test('unparseable native reply never publishes an artifact', async()=>fixture(async({dir,script})=>{
  const old=process.env.MOCK_MODE; process.env.MOCK_MODE='invalid';
  try {
    const path=join(dir,'bad.step');
    const result=await runExperimentalPlate(request(true),{...options(script),stepOutput:path});
    assert.equal(result.code,'requires_reconciliation');
    await assert.rejects(fs.stat(path),{code:'ENOENT'});
  } finally { if(old===undefined) delete process.env.MOCK_MODE; else process.env.MOCK_MODE=old; }
}));

test('cancellation of a real hung subprocess does not publish STEP', async()=>fixture(async({dir,script})=>{
  const old=process.env.MOCK_MODE; process.env.MOCK_MODE='hang';
  const aborter=new AbortController();
  try {
    const path=join(dir,'aborted.step');
    const pending=runExperimentalPlate(request(true),{...options(script),stepOutput:path,signal:aborter.signal});
    setTimeout(()=>aborter.abort(),120);
    const result=await pending;
    assert.equal(result.code,'cancelled');
    await assert.rejects(fs.stat(path),{code:'ENOENT'});
  } finally { if(old===undefined) delete process.env.MOCK_MODE; else process.env.MOCK_MODE=old; }
}));

test('invalid options fail before invoking the native process', async()=>{
  await assert.rejects(runExperimentalPlate(request(),{readCurrentRevision:()=>4,stepOutput:'x'}),KernelContractError);
  await assert.rejects(runExperimentalPlate(request(true),{readCurrentRevision:()=>4}),KernelContractError);
  await assert.rejects(runExperimentalPlate(request(),{readCurrentRevision:()=>4,timeoutMs:0}),KernelContractError);
  await assert.rejects(runExperimentalPlate(request(),{}),KernelContractError);
});
