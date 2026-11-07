/**
 * REAL selected SKETCH -> INTENT feature history -> pinned OCCT 8.0.1 C++
 * concave U-prism, separate through window + blind pocket, 8 -> 12 retrospective edit,
 * selective dependency invalidation, undo/redo, archive and two genuine STEP.
 *
 * Run only with an actually built, pinned C++ worker:
 * node packages/kernel-contract/examples/runtime-occt8-u-profile-native.mjs \
 *   /absolute/path/intuit3d_occt8_plate /fresh/output-directory
 *
 * A native C++ result with same-engine STEP is experimental evidence only;
 * independent CAD interoperability and browser acceptance are separate gates.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {
  buildAuthoredUBracket,editAuthoredUBracketThickness,
  MODEL_U_BODY_ID,MODEL_U_CUT_IDS,
} from './runtime-occt8-u-profile-document.mjs';
import {
  requestFromRuntimeOcct8Orthogonal,runPinnedRuntimeOcct8Orthogonal,
} from '../src/runtime-occt8-orthogonal-profile-provider.mjs';

const executable=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const output=process.argv[3];
if(!executable||!output) {
  console.error('Usage: node packages/kernel-contract/examples/runtime-occt8-u-profile-native.mjs /pinned/occt8/worker /fresh/output');
  process.exit(2);
}
const out=resolve(output);
await mkdir(out,{recursive:true});
let fixture=buildAuthoredUBracket();
const original=fixture;
const records=[];

async function rebuild(label,expectedVolume) {
  const q=requestFromRuntimeOcct8Orthogonal(
    fixture.history,MODEL_U_BODY_ID,{
      runtime:fixture.runtime,model:fixture.model,
      requestId:'native.u.'+label,exportStep:true,
    });
  assert.deepEqual(q.cuts.map(c=>c.featureId),MODEL_U_CUT_IDS);
  const result=await runPinnedRuntimeOcct8Orthogonal(
    fixture.history,MODEL_U_BODY_ID,{
      runtime:fixture.runtime,model:fixture.model,
      requestId:q.requestId,
      workerExecutable:resolve(executable),
      readCurrentRevision:()=>fixture.history.document.revision,
      stepOutput:join(out,label+'.step'),
      timeoutMs:120000,
    });
  assert.equal(result.kind,'experimental_report',
    'pinned C++ failed: '+JSON.stringify(result));
  assert.ok(result.artifact?.sha256);
  assert.equal(result.semanticBodyId,MODEL_U_BODY_ID);
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.observed.source.solidCount,1);
  assert.ok(Math.abs(result.observed.source.volumeMm3-expectedVolume)<1e-6);
  assert.ok(Math.abs(result.observed.stepReadback.volumeMm3-expectedVolume)<1e-6);
  records.push({label,revision:q.revision,bodyId:MODEL_U_BODY_ID,
    profileId:q.profile.profileId,cutFeatureIds:q.cuts.map(c=>c.featureId),
    volumeMm3:result.observed.source.volumeMm3,
    surfaceAreaMm2:result.observed.source.surfaceAreaMm2,
    stepSha256:result.artifact.sha256,stepBytes:result.artifact.bytes,
    sameEngineOnly:true,exactAuthority:false,independentInteroperability:false,
  });
}
await rebuild('initial-8',47600);
const changed=editAuthoredUBracketThickness(fixture,12);
for(const id of ['extrude.u',...MODEL_U_CUT_IDS])
  assert.ok(changed.invalidation.invalidatedFeatureIds.includes(id));
assert.ok(!changed.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
const undo=changed.runtime.undo(changed.history,['undo.thickness']);
const redo=changed.runtime.redo(undo,['redo.thickness']);
assert.equal(requestFromRuntimeOcct8Orthogonal(undo,MODEL_U_BODY_ID,{
  runtime:changed.runtime,model:changed.model,
  requestId:'native.undo',exportStep:false,
}).profile.thickness,8);
assert.equal(requestFromRuntimeOcct8Orthogonal(redo,MODEL_U_BODY_ID,{
  runtime:changed.runtime,model:changed.model,
  requestId:'native.redo',exportStep:false,
}).profile.thickness,12);
fixture={...changed,history:changed.runtime.reopen(changed.runtime.save(changed.history))};
await rebuild('edited-12',71520);
assert.notEqual(records[0].stepSha256,records[1].stepSha256);
assert.equal(records[0].profileId,records[1].profileId);
await writeFile(join(out,'authoritative-document.json'),
  fixture.runtime.save(fixture.history),{flag:'wx'});
await writeFile(join(out,'manifest.json'),JSON.stringify({
  result:'PINNED_OCCT8_CPP_RUNTIME_U_PROFILE_TWO_STEP_EXECUTED',
  provider:'pinned-OCCT-8.0.1-C++',
  originalRevision:original.history.document.revision,
  editedRevision:fixture.history.document.revision,
  invalidated:changed.invalidation.invalidatedFeatureIds,
  records,independentInteroperability:false,exactAuthority:false,
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PINNED_CXX_U_PROFILE_TWO_STEP_PASS',records},null,2));
