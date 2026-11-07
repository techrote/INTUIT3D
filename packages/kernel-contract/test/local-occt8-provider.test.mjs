// Process tests prove the Node-to-bridge transport and publication boundary.
// The subprocess below is synthetic; these are NOT actual OCCT 8.0.1 or STEP tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPinnedOcct8Plate} from '../src/local-occt8-provider.mjs';
import {PLATE_PROTOCOL, KernelContractError} from '../src/plate-v1.mjs';

const request = (exportStep = false) => ({
  protocol:PLATE_PROTOCOL, requestId:'fixture.native-bridge',
  featureId:'fixture.plate', revision:4, units:'mm',
  plate:{width:120,depth:80,thickness:8,
    holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]},
  exportStep,
});
const source = String.raw`
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const mode = 'MODE_HERE';
let text='';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {text+=chunk;});
process.stdin.on('end',async()=>{
  if(mode==='hang'){setInterval(()=>{},1000);return;}
  const r=JSON.parse(text);
  const p=r.plate;
  const cuts=p.holes.reduce((sum,h)=>sum+Math.PI*h.radius*h.radius,0);
  const walls=p.holes.reduce((sum,h)=>sum+2*Math.PI*h.radius,0);
  const metrics={
    valid:true,solidCount:1,
    volumeMm3:(p.width*p.depth-cuts)*p.thickness,
    surfaceAreaMm2:2*(p.width*p.depth-cuts)+
      (2*(p.width+p.depth)+walls)*p.thickness,
    cylindricalHoles:p.holes.map(h=>({...h,axisZ:1})),
  };
  const stepIndex=process.argv.indexOf('--step-output');
  let stepPath,stepSha256,stepVerification,part21Audit;
  if(stepIndex>=0){
    stepPath=process.argv[stepIndex+1];
    const bytes=Buffer.from('ISO-10303-21;\\n'+'X'.repeat(350)+'\\nEND-ISO-10303-21;\\n');
    await writeFile(stepPath,bytes);
    stepSha256=createHash('sha256').update(bytes).digest('hex');
    stepVerification=process.argv.includes('--cross-version-step-audit')
      ? 'occt-7.9.3.1-separate-process' : 'occt-8.0.1-same-engine';
    if(process.argv.includes('--part21-step-audit'))
      part21Audit={kind:'part21-plate-structural-v1',sha256:stepSha256};
  }
  if(mode==='bad-digest')stepSha256='0'.repeat(64);
  if(mode==='bad-backend')metrics.valid=false;
  console.log(JSON.stringify({
    protocol:r.protocol,requestId:r.requestId,featureId:r.featureId,
    revision:r.revision,backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    status:'validated_exact',units:'mm',source:metrics,
    stepReadback:r.exportStep?metrics:null,stepWritten:r.exportStep,
    ...(stepPath?{stepPath,stepSha256,stepVerification,part21Audit}:{}),
  }));
});
`;
async function fixture(mode, fn) {
  const dir=await fs.mkdtemp(join(tmpdir(),'intuit3d-occt8-node-'));
  const script=join(dir,'synthetic-bridge.mjs');
  await fs.writeFile(script,source.replace('MODE_HERE',mode));
  try{return await fn({dir,script});}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
const options = script => ({
  workerExecutable:'/trusted/build/intuit3d_occt8_plate',
  nativeSupervisor:script,
  pythonExecutable:process.execPath,
  readCurrentRevision:()=>4,
  timeoutMs:2500,
});

test('synthetic OCCT8 subprocess: typed report is not production exact; stale edit skips worker',async()=>fixture('good',async({script})=>{
  const result=await runPinnedOcct8Plate(request(),options(script));
  assert.equal(result.kind,'experimental_report',JSON.stringify(result));
  assert.equal(result.backend,'OCCT-cxx-8.0.1');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.observed.source.solidCount,1);
  assert.equal(result.artifact,null);
  const stale=await runPinnedOcct8Plate(request(),{...options('/no/worker'),readCurrentRevision:()=>5});
  assert.equal(stale.code,'stale_revision');
}));

test('synthetic STEP transport: verified digest and plate-subset evidence, exclusive download',async()=>fixture('good',async({dir,script})=>{
  const output=join(dir,'plate.step');
  const first=await runPinnedOcct8Plate(request(true),{...options(script),stepOutput:output});
  assert.equal(first.kind,'experimental_report',JSON.stringify(first));
  assert.equal(first.artifact.verification,'occt8_part21_plate_subset');
  assert.equal(first.artifact.sha256,first.part21Audit.sha256);
  const before=await fs.readFile(output);
  assert.ok(before.length>256);
  const second=await runPinnedOcct8Plate(request(true),{...options(script),stepOutput:output});
  assert.equal(second.code,'requires_reconciliation');
  assert.deepEqual(await fs.readFile(output),before);
}));

test('synthetic producer lying about STEP digest is rejected without file publication',async()=>fixture('bad-digest',async({dir,script})=>{
  const output=join(dir,'must-not-publish.step');
  const response=await runPinnedOcct8Plate(request(true),{...options(script),stepOutput:output});
  assert.equal(response.code,'requires_reconciliation');
  await assert.rejects(fs.stat(output),{code:'ENOENT'});
}));

test('synthetic producer with bad geometry is rejected before publication',async()=>fixture('bad-backend',async({dir,script})=>{
  const output=join(dir,'must-not-publish.step');
  const response=await runPinnedOcct8Plate(request(true),{...options(script),stepOutput:output});
  assert.equal(response.code,'requires_reconciliation');
  await assert.rejects(fs.stat(output),{code:'ENOENT'});
}));

test('real OS subprocess cancellation prevents synthetic STEP publication',async()=>fixture('hang',async({dir,script})=>{
  const output=join(dir,'cancelled.step');
  const aborter=new AbortController();
  const pending=runPinnedOcct8Plate(request(true),{...options(script),stepOutput:output,signal:aborter.signal});
  setTimeout(()=>aborter.abort(),120);
  const result=await pending;
  assert.equal(result.code,'cancelled');
  await assert.rejects(fs.stat(output),{code:'ENOENT'});
}));

test('missing pinned executable path and incorrect audit flags are rejected early',async()=>{
  await assert.rejects(runPinnedOcct8Plate(request(),{readCurrentRevision:()=>4}),KernelContractError);
  await assert.rejects(runPinnedOcct8Plate(request(),{
    workerExecutable:'placeholder',readCurrentRevision:()=>4,part21StepAudit:'yes',
  }),KernelContractError);
});
