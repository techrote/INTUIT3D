/** Execute the real pinned OCCT8 v6 progressive workflow (never a synthetic receipt).
 * node packages/kernel-contract/examples/pinned-occt8-progressive-profile.mjs
 *   /absolute/pinned/worker /fresh/output
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runPinnedOcct8FlexibleLinear}
  from '../src/local-occt8-flexible-linear-provider.mjs';
import {parseOcct8FlexibleLinearRequest,expectedOcct8FlexibleLinearMetrics,
  OCCT8_FLEXIBLE_LINEAR_PROTOCOL} from '../src/occt8-flexible-linear-v6.mjs';

const worker=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const output=process.argv[3];
if(!worker||!output) {
  console.error('Usage: node .../pinned-occt8-progressive-profile.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
const folder=resolve(output);
await mkdir(folder,{recursive:true});
const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{
  cwd:sourceRoot,encoding:'utf8',
}).trim();
if(process.env.INTUIT3D_SOURCE_SHA)
  assert.equal(sourceSha,process.env.INTUIT3D_SOURCE_SHA,
    'checkout SHA differs from requested native source');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const workerExecutable=resolve(worker);
const provenance={
  sourceSha,workerSha256:hash(await readFile(workerExecutable)),
  cppSourceSha256:hash(await readFile(new URL('../../../native/occt8/plate_worker.cpp',import.meta.url))),
  occtVersionRequired:'8.0.1',
  sourceToBinaryCompilationBinding:'exact-head-build-log-required',
};
const base=JSON.parse(await readFile(new URL(
  '../../../native/examples/occt8-sloped-bracket-linear.request.json',import.meta.url)));
const receipts=[];
for(const cutCount of [0,1,2])for(const thickness of [8,12]){
  const q=structuredClone(base);
  q.protocol=OCCT8_FLEXIBLE_LINEAR_PROTOCOL;
  q.profile.thickness=thickness;
  q.cuts=q.cuts.slice(0,cutCount);
  if(cutCount===2)q.cuts[1].cutDepthMm=thickness;
  q.revision=20+cutCount*2+(thickness===12?1:0);
  q.requestId='native.progressive.v6.'+cutCount+'.'+thickness;
  const typed=parseOcct8FlexibleLinearRequest(q);
  const stepPath=join(folder,'progressive-'+cutCount+'-'+thickness+'.step');
  const result=await runPinnedOcct8FlexibleLinear(typed,{
    workerExecutable,readCurrentRevision:()=>typed.revision,stepOutput:stepPath,
    timeoutMs:120000,
  });
  assert.equal(result.kind,'experimental_report',JSON.stringify(result));
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  const expected=expectedOcct8FlexibleLinearMetrics(typed);
  for(const phase of ['source','stepReadback']){
    const actual=result.observed[phase];
    assert.equal(actual.valid,true);
    assert.equal(actual.solidCount,1);
    assert.equal(actual.cylindricalHoles.length,cutCount>0?1:0);
    assert.ok(Math.abs(actual.volumeMm3-expected.volumeMm3)<1e-5);
    assert.ok(Math.abs(actual.surfaceAreaMm2-expected.surfaceAreaMm2)<1e-5);
  }
  const real=await readFile(stepPath);
  assert.equal(hash(real),result.artifact.sha256);
  assert.ok(real.length>=256);
  receipts.push({cutCount,thickness,bodyId:typed.featureId,
    profileId:typed.profile.profileId,
    cutFeatureIds:typed.cuts.map(c=>c.featureId),requestId:typed.requestId,
    revision:typed.revision,expected,source:result.observed.source,
    stepReadback:result.observed.stepReadback,stepSha256:result.artifact.sha256,
    stepBytes:real.length,exactAuthority:false,independentInteroperability:false});
}
assert.equal(new Set(receipts.map(r=>r.stepSha256)).size,6,
  'six distinct physically exported progressive solids required');
await writeFile(join(folder,'progressive-v6-receipts.json'),JSON.stringify({
  status:'PINNED_OCCT8_PROGRESSIVE_V6_PHYSICAL_EXECUTED',
  provenance,receipts,limitations:[
    'same_engine_STEP_readback_only','source_binary_binding_needs_build_log',
    'external_non_OCCT_STEP_import_pending','browser_and_human_pending',
  ],
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({
  status:'PINNED_OCCT8_PROGRESSIVE_V6_PASS',provenance,receipts,
},null,2));
