/**
 * Actual pinned C++ selected eight-edge U-bracket, one blind circular pocket,
 * one through rectangular window, retrospective thickness 8 -> 12 mm,
 * two distinct physical STEP files, observed mass/area and source identities.
 *
 * node packages/kernel-contract/examples/pinned-occt8-orthogonal-profile.mjs \\
 *   /absolute/path/to/intuit3d_occt8_plate /fresh/output-folder
 *
 * No OCP simulation or synthetic worker is admitted here. Native same-engine
 * evidence is not independently imported external CAD or browser exactness.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runPinnedOcct8OrthogonalProfileChain}
  from '../src/local-occt8-orthogonal-profile-provider.mjs';
import {parseOcct8OrthogonalProfileRequest,expectedOcct8OrthogonalMetrics}
  from '../src/occt8-orthogonal-profile-v4.mjs';

const worker=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const folder=process.argv[3];
if(!worker||!folder) {
  console.error('Usage: node packages/kernel-contract/examples/pinned-occt8-orthogonal-profile.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
const dest=resolve(folder);
await mkdir(dest,{recursive:true});
const raw=await readFile(new URL('../../../native/examples/occt8-u-bracket-orthogonal.request.json',import.meta.url));
const fixture=JSON.parse(raw);
const original=parseOcct8OrthogonalProfileRequest(fixture);
const edited=parseOcct8OrthogonalProfileRequest({
  ...fixture,revision:fixture.revision+1,
  profile:{...fixture.profile,thickness:12},
  cuts:fixture.cuts.map(c=>c.kind==='rectangle'
    ? {...c,cutDepthMm:12} : {...c}),
});
const observations=[];
for(const [label,request] of [['u-8',original],['u-12',edited]]) {
  const filename=join(dest,label+'.step');
  const result=await runPinnedOcct8OrthogonalProfileChain(request,{
    workerExecutable:resolve(worker),
    readCurrentRevision:()=>request.revision,
    stepOutput:filename,timeoutMs:120000,
  });
  assert.equal(result.kind,'experimental_report',
    'pinned C++ physical run failed: '+JSON.stringify(result));
  assert.equal(result.observed.source.solidCount,1);
  assert.equal(result.observed.stepReadback.solidCount,1);
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  const expected=expectedOcct8OrthogonalMetrics(request);
  assert.ok(Math.abs(result.observed.source.volumeMm3-expected.volumeMm3)<1e-5);
  assert.ok(Math.abs(result.observed.source.surfaceAreaMm2-expected.surfaceAreaMm2)<1e-5);
  assert.ok(Math.abs(result.observed.stepReadback.volumeMm3-expected.volumeMm3)<1e-5);
  const bytes=await readFile(filename);
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(result.artifact?.sha256,digest);
  observations.push({
    label,revision:request.revision,profileId:request.profile.profileId,
    bodyId:request.featureId,cuts:request.cuts.map(c=>c.featureId),
    thicknessMm:request.profile.thickness,
    measuredVolumeMm3:result.observed.source.volumeMm3,
    measuredAreaMm2:result.observed.source.surfaceAreaMm2,
    sameEngineVolumeMm3:result.observed.stepReadback.volumeMm3,
    stepSha256:digest,stepBytes:bytes.length,
    exactAuthority:false,independentInteroperability:false,
  });
}
assert.notEqual(observations[0].stepSha256,observations[1].stepSha256);
assert.equal(observations[0].profileId,observations[1].profileId);
assert.deepEqual(observations[0].cuts,observations[1].cuts);
await writeFile(join(dest,'manifest.json'),JSON.stringify({
  result:'PINNED_OCCT8_CPP_SELECTED_ORTHOGONAL_TWO_STEP_EXECUTED',
  sourceFixtureSha256:createHash('sha256').update(raw).digest('hex'),
  version:'OCCT-8.0.1-C++',
  claim:'same-engine physical validation; not independent external CAD',
  observations,
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PINNED_CXX_U_BRACKET_PASS',observations},null,2));
