/** Execute actual pinned C++ diagonal-profile STEP, never synthetic evidence.
 * node packages/kernel-contract/examples/pinned-occt8-sloped-profile.mjs
 *   /absolute/pinned/worker /fresh/output
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runPinnedOcct8LinearProfileChain}
  from '../src/local-occt8-linear-profile-provider.mjs';
import {parseOcct8LinearProfileRequest,expectedOcct8LinearMetrics}
  from '../src/occt8-linear-profile-v5.mjs';
const binary=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const target=process.argv[3];
if(!binary||!target){
  console.error('Usage: node .../pinned-occt8-sloped-profile.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
const folder=resolve(target);
await mkdir(folder,{recursive:true});
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{
  cwd:fileURLToPath(new URL('../../../',import.meta.url)),
  encoding:'utf8',
}).trim();
if(process.env.INTUIT3D_SOURCE_SHA)
  assert.equal(sourceSha,process.env.INTUIT3D_SOURCE_SHA,
    'pinned physical evidence checkout differs from requested source SHA');
const workerExecutable=resolve(binary);
const workerSha256=createHash('sha256').update(await readFile(workerExecutable)).digest('hex');
const cppSourceSha256=createHash('sha256').update(
  await readFile(new URL('../../../native/occt8/plate_worker.cpp',import.meta.url))
).digest('hex');
const provenance={sourceSha,workerSha256,cppSourceSha256,
  pinnedVersionRequired:'OCCT-cxx-8.0.1',
  qualifiedBinarySourceBinding:'requires-exact-head-build-log'};

const base=parseOcct8LinearProfileRequest(JSON.parse(await readFile(
  new URL('../../../native/examples/occt8-sloped-bracket-linear.request.json',import.meta.url)
)));
const receipts=[];
for(const thickness of [8,12]){
  const request=structuredClone(base);
  request.profile.thickness=thickness;
  request.cuts[1].cutDepthMm=thickness;
  request.revision=base.revision+(thickness===12?1:0);
  request.requestId='selected.sloped.bracket.'+thickness;
  const typed=parseOcct8LinearProfileRequest(request);
  const result=await runPinnedOcct8LinearProfileChain(typed,{
    workerExecutable:resolve(binary),readCurrentRevision:()=>typed.revision,
    stepOutput:join(folder,'sloped-'+thickness+'.step'),timeoutMs:120000,
  });
  assert.equal(result.kind,'experimental_report',JSON.stringify(result));
  const expected=expectedOcct8LinearMetrics(typed);
  assert.equal(result.observed.source.solidCount,1);
  assert.equal(result.observed.stepReadback.solidCount,1);
  assert.ok(Math.abs(result.observed.source.volumeMm3-expected.volumeMm3)<1e-5);
  assert.ok(Math.abs(result.observed.source.surfaceAreaMm2-expected.surfaceAreaMm2)<1e-5);
  assert.ok(Math.abs(result.observed.stepReadback.volumeMm3-expected.volumeMm3)<1e-5);
  assert.ok(result.artifact.bytes>256);
  assert.equal(result.exactAuthority,false);
  receipts.push({thickness,requestId:typed.requestId,revision:typed.revision,
    bodyId:typed.featureId,profileId:typed.profile.profileId,
    cutFeatureIds:typed.cuts.map(c=>c.featureId),expected,
    source:result.observed.source,stepReadback:result.observed.stepReadback,
    stepSha256:result.artifact.sha256,stepBytes:result.artifact.bytes,
    backend:'pinned-OCCT-8.0.1-C++',exactAuthority:false,
    independentInteroperability:false});
}
assert.notEqual(receipts[0].stepSha256,receipts[1].stepSha256);
await writeFile(join(folder,'sloped-receipts.json'),JSON.stringify({
  status:'PINNED_OCCT8_LINEAR_V5_PHYSICAL_WORKER_EXECUTED',provenance,receipts,
  limitations:['same_engine_STEP_readback_only','no_browser_or_human_qualification',
    'not_an_independent_CAD_import'],
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PINNED_OCCT8_LINEAR_V5_PASS',provenance,receipts},null,2));
