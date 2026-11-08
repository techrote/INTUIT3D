/**
 * End-to-end real authored INTENT/SKETCH -> pinned OCCT8 v5.
 * node packages/kernel-contract/examples/runtime-occt8-sloped-profile-native.mjs
 *   /absolute/pinned/worker /fresh/output
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildAuthoredSlopedBracket,editAuthoredSlopedThickness,SLOPED_BODY_ID,
  SLOPED_CUT_IDS} from './runtime-occt8-sloped-profile-document.mjs';
import {requestFromRuntimeOcct8Linear,runPinnedRuntimeOcct8Linear}
  from '../src/runtime-occt8-linear-profile-provider.mjs';

const worker=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const out=process.argv[3];
if(!worker||!out){
  console.error('Usage: node .../runtime-occt8-sloped-profile-native.mjs /pinned/worker /fresh/out');
  process.exit(2);
}
const folder=resolve(out);
await mkdir(folder,{recursive:true});
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{
  cwd:fileURLToPath(new URL('../../../',import.meta.url)),
  encoding:'utf8',
}).trim();
if(process.env.INTUIT3D_SOURCE_SHA)
  assert.equal(sourceSha,process.env.INTUIT3D_SOURCE_SHA,
    'pinned physical evidence checkout differs from requested source SHA');
const workerExecutable=resolve(worker);
const workerSha256=createHash('sha256').update(await readFile(workerExecutable)).digest('hex');
const cppSourceSha256=createHash('sha256').update(
  await readFile(new URL('../../../native/occt8/plate_worker.cpp',import.meta.url))
).digest('hex');
const provenance={sourceSha,workerSha256,cppSourceSha256,
  pinnedVersionRequired:'OCCT-cxx-8.0.1',
  qualifiedBinarySourceBinding:'requires-exact-head-build-log'};

let fixture=buildAuthoredSlopedBracket();
const receipts=[];
async function exportBody(label,volume){
  const q=requestFromRuntimeOcct8Linear(fixture.history,SLOPED_BODY_ID,{
    model:fixture.model,runtime:fixture.runtime,
    requestId:'authored.sloped.'+label,exportStep:true,
  });
  assert.deepEqual(q.cuts.map(c=>c.featureId),SLOPED_CUT_IDS);
  const result=await runPinnedRuntimeOcct8Linear(fixture.history,SLOPED_BODY_ID,{
    model:fixture.model,runtime:fixture.runtime,requestId:q.requestId,
    workerExecutable:resolve(worker),
    readCurrentRevision:()=>fixture.history.document.revision,
    stepOutput:join(folder,label+'.step'),timeoutMs:120000,
  });
  assert.equal(result.kind,'experimental_report',JSON.stringify(result));
  assert.equal(result.semanticBodyId,SLOPED_BODY_ID);
  assert.equal(result.observed.source.solidCount,1);
  assert.equal(result.observed.stepReadback.solidCount,1);
  for(const metric of [result.observed.source,result.observed.stepReadback])
    assert.ok(Math.abs(metric.volumeMm3-volume)<1e-5);
  assert.equal(result.exactAuthority,false);
  receipts.push({label,semanticBodyId:SLOPED_BODY_ID,
    profileId:q.profile.profileId,revision:q.revision,
    cutFeatureIds:q.cuts.map(c=>c.featureId),
    cutDepths:q.cuts.map(c=>c.cutDepthMm),
    source:result.observed.source,stepReadback:result.observed.stepReadback,
    stepSha256:result.artifact.sha256,stepBytes:result.artifact.bytes,
    exactAuthority:false,independentInteroperability:false});
}
await exportBody('authored-8',44404);
const changed=editAuthoredSlopedThickness(fixture,12);
for(const id of ['extrude.sloped',...SLOPED_CUT_IDS])
  assert.ok(changed.invalidation.invalidatedFeatureIds.includes(id));
assert.equal(requestFromRuntimeOcct8Linear(
  changed.runtime.undo(changed.history,['undo.sloped']),SLOPED_BODY_ID,{
    runtime:changed.runtime,model:changed.model,requestId:'undo.sloped',
    exportStep:false}).profile.thickness,8);
fixture={...changed,history:changed.runtime.reopen(changed.runtime.save(changed.history))};
await exportBody('authored-12',66756);
assert.notEqual(receipts[0].stepSha256,receipts[1].stepSha256);
assert.deepEqual(receipts.map(r=>r.cutDepths),[[8,3],[12,3]]);
assert.equal(receipts[0].profileId,receipts[1].profileId);
await writeFile(join(folder,'authored-document.json'),
  fixture.runtime.save(fixture.history),{flag:'wx'});
await writeFile(join(folder,'authored-receipts.json'),JSON.stringify({
  result:'PINNED_CXX_AUTHORED_SLOPED_TWO_STEP_EXECUTED',
  provenance,
  receipts,exactAuthority:false,independentInteroperability:false,
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PINNED_CXX_AUTHORED_SLOPED_TWO_STEP_PASS',provenance,receipts},null,2));
