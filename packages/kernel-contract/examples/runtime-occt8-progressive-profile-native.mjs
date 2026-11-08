/** Real INTENT -> solved SKETCH -> pinned C++ v6 progression and retrospective edit.
 * node packages/kernel-contract/examples/runtime-occt8-progressive-profile-native.mjs
 *   /absolute/pinned/worker /fresh/output
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {buildAuthoredSlopedBracket,SLOPED_BODY_ID}
  from './runtime-occt8-sloped-profile-document.mjs';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {requestFromRuntimeOcct8Flexible}
  from '../src/runtime-occt8-flexible-linear-provider.mjs';
import {runPinnedOcct8FlexibleLinear}
  from '../src/local-occt8-flexible-linear-provider.mjs';
import {expectedOcct8FlexibleLinearMetrics}
  from '../src/occt8-flexible-linear-v6.mjs';

const worker=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const output=process.argv[3];
if(!worker||!output){
  console.error('Usage: node .../runtime-occt8-progressive-profile-native.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
const folder=resolve(output);
await mkdir(folder,{recursive:true});
const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{
  cwd:sourceRoot,encoding:'utf8',
}).trim();
if(process.env.INTUIT3D_SOURCE_SHA)
  assert.equal(sourceSha,process.env.INTUIT3D_SOURCE_SHA,'source SHA mismatch');
const hash=b=>createHash('sha256').update(b).digest('hex');
const workerExecutable=resolve(worker);
const provenance={
  sourceSha,cppSourceSha256:hash(await readFile(new URL(
    '../../../native/occt8/plate_worker.cpp',import.meta.url))),
  workerSha256:hash(await readFile(workerExecutable)),
  requiredOcct:'8.0.1',compiledFromThisSource:'requires-source-matched-build-log',
};
const receipts=[];
for(const cutCount of [0,1,2]){
  const fixture=buildAuthoredSlopedBracket({cutCount});
  const edited=editExtrudeThickness(fixture.history,{
    eventId:'progressive.native.edit.'+cutCount,
    expectedRevision:fixture.history.document.revision,
    featureId:'extrude.sloped',thicknessMm:12,
  },fixture.services);
  const undone=fixture.runtime.undo(edited.history,['progressive.native.undo.'+cutCount]);
  const redone=fixture.runtime.redo(undone,['progressive.native.redo.'+cutCount]);
  const reopened=fixture.runtime.reopen(fixture.runtime.save(redone));
  for(const [thickness,history] of [[8,fixture.history],[12,reopened]]){
    const requestId='authored.progressive.native.'+cutCount+'.'+thickness;
    const q=requestFromRuntimeOcct8Flexible(history,SLOPED_BODY_ID,{
      runtime:fixture.runtime,model:fixture.model,requestId,exportStep:true,
    });
    assert.equal(q.profile.thickness,thickness);
    assert.equal(q.cuts.length,cutCount);
    const stepPath=join(folder,'authored-'+cutCount+'-'+thickness+'.step');
    const result=await runPinnedOcct8FlexibleLinear(q,{
      workerExecutable,readCurrentRevision:()=>history.document.revision,
      stepOutput:stepPath,timeoutMs:120000,
    });
    assert.equal(result.kind,'experimental_report',JSON.stringify(result));
    assert.equal(result.exactAuthority,false);
    const expected=expectedOcct8FlexibleLinearMetrics(q);
    for(const kind of ['source','stepReadback']){
      const got=result.observed[kind];
      assert.equal(got.valid,true);
      assert.equal(got.solidCount,1);
      assert.equal(got.cylindricalHoles.length,0);
      assert.ok(Math.abs(got.volumeMm3-expected.volumeMm3)<1e-5);
      assert.ok(Math.abs(got.surfaceAreaMm2-expected.surfaceAreaMm2)<1e-5);
    }
    const actualBytes=await readFile(stepPath);
    assert.equal(hash(actualBytes),result.artifact.sha256);
    receipts.push({cutCount,thickness,requestId,
      projectId:history.document.projectId,
      revision:history.document.revision,bodyId:q.featureId,
      profileId:q.profile.profileId,cutFeatureIds:q.cuts.map(c=>c.featureId),
      expected,source:result.observed.source,stepReadback:result.observed.stepReadback,
      stepSha256:result.artifact.sha256,stepBytes:actualBytes.length,
      exactAuthority:false,independentInteroperability:false});
  }
}
assert.equal(new Set(receipts.map(r=>r.stepSha256)).size,6);
for(const n of [0,1,2]){
  const [before,after]=receipts.filter(r=>r.cutCount===n);
  assert.equal(before.bodyId,after.bodyId);
  assert.equal(before.profileId,after.profileId);
  assert.deepEqual(before.cutFeatureIds,after.cutFeatureIds);
  assert.ok(after.expected.volumeMm3>before.expected.volumeMm3);
}
await writeFile(join(folder,'authored-progressive-v6-receipts.json'),JSON.stringify({
  status:'PINNED_AUTHORED_V6_PHYSICAL_EXECUTED',provenance,receipts,
  limitations:['same_engine_only','browser_human_not_qualified',
    'independent_non_OCCT_STEP_pending','source_binary_binding_requires_build_log'],
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PINNED_AUTHORED_PROGRESSIVE_V6_PASS',
  provenance,receipts},null,2));
