/**
 * Real INTENT cut-extent edit (3 -> 5 mm blind L-bracket pocket) -> an
 * isolated pinned OCCT 8.0.1 C++ Boolean rebuild -> two distinct STEP files.
 * The native worker is mandatory: neither OCP nor preview can pass this demo.
 *
 * node packages/kernel-contract/examples/runtime-occt8-l-profile-pocket-edit-native.mjs
 *   /absolute/path/to/pinned/intuit3d_occt8_plate /fresh/output-directory
 *
 * External non-OCCT import is a separate acceptance gate, not claimed here.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildAuthoredLBracket,editAuthoredLBracketPocketDepth,
  MODEL_L_BODY_ID,MODEL_L_CUT_IDS}
  from './runtime-occt8-l-profile-document.mjs';
import {requestFromRuntimeOcct8LProfile,runPinnedRuntimeOcct8LProfile}
  from '../src/runtime-occt8-l-profile-provider.mjs';
import {expectedOcct8LProfileMetrics} from '../src/occt8-l-profile-v3.mjs';

const binary=process.argv[2]??process.env.INTUIT3D_OCCT8_WORKER;
const directory=process.argv[3];
if(!binary||!directory){
  console.error('Usage: node packages/kernel-contract/examples/runtime-occt8-l-profile-pocket-edit-native.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
const output=resolve(directory);
await mkdir(output,{recursive:true});
let fixture=buildAuthoredLBracket();
const records=[];
async function physicalRebuild(label,pocketDepthMm,expectedVolumeMm3) {
  const request=requestFromRuntimeOcct8LProfile(
    fixture.history,MODEL_L_BODY_ID,{runtime:fixture.runtime,
      model:fixture.model,requestId:'l.pocket.'+label,exportStep:true});
  assert.equal(request.profile.thickness,8);
  assert.deepEqual(request.cuts.map(c=>c.featureId),MODEL_L_CUT_IDS);
  assert.deepEqual(request.cuts.map(c=>c.cutDepthMm),[8,pocketDepthMm]);
  assert.equal(expectedOcct8LProfileMetrics(request).volumeMm3,expectedVolumeMm3);
  const result=await runPinnedRuntimeOcct8LProfile(
    fixture.history,MODEL_L_BODY_ID,{
      runtime:fixture.runtime,model:fixture.model,requestId:request.requestId,
      workerExecutable:resolve(binary),
      readCurrentRevision:()=>fixture.history.document.revision,
      stepOutput:join(output,label+'.step'),timeoutMs:120000});
  assert.equal(result.kind,'experimental_report',
    'pinned C++ must physically succeed: '+JSON.stringify(result));
  assert.equal(result.semanticBodyId,MODEL_L_BODY_ID);
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.observed.source.solidCount,1);
  assert.ok(Math.abs(result.observed.source.volumeMm3-expectedVolumeMm3)<1e-6);
  assert.ok(Math.abs(result.observed.stepReadback.volumeMm3-expectedVolumeMm3)<1e-6);
  assert.match(result.artifact?.sha256??'',/^[a-f0-9]{64}$/);
  records.push({label,revision:request.revision,bodyId:request.featureId,
    profileId:request.profile.profileId,cutIds:request.cuts.map(c=>c.featureId),
    pocketDepthMm,expectedVolumeMm3,
    sourceVolumeMm3:result.observed.source.volumeMm3,
    stepReadbackVolumeMm3:result.observed.stepReadback.volumeMm3,
    stepSha256:result.artifact.sha256,stepBytes:result.artifact.bytes});
}
await physicalRebuild('pocket-3',3,32720);
const edited=editAuthoredLBracketPocketDepth(fixture,5);
assert.ok(edited.invalidation.invalidatedFeatureIds.includes('cut.pocket'));
for(const unaffected of ['extrude.bracket','cut.window','extrude.spacer'])
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes(unaffected));
const undo=edited.runtime.undo(edited.history,['undo.pocket.depth']);
const redo=edited.runtime.redo(undo,['redo.pocket.depth']);
assert.equal(requestFromRuntimeOcct8LProfile(undo,MODEL_L_BODY_ID,{
  runtime:edited.runtime,model:edited.model,requestId:'pocket.undo',
  exportStep:false}).cuts[1].cutDepthMm,3);
assert.equal(requestFromRuntimeOcct8LProfile(redo,MODEL_L_BODY_ID,{
  runtime:edited.runtime,model:edited.model,requestId:'pocket.redo',
  exportStep:false}).cuts[1].cutDepthMm,5);
fixture={...edited,history:edited.runtime.reopen(edited.runtime.save(edited.history))};
await physicalRebuild('pocket-5',5,32560);
assert.notEqual(records[0].stepSha256,records[1].stepSha256);
assert.equal(records[0].bodyId,records[1].bodyId);
assert.equal(records[0].profileId,records[1].profileId);
await writeFile(join(output,'authoritative-document.json'),
  fixture.runtime.save(fixture.history),{flag:'wx'});
await writeFile(join(output,'manifest.json'),JSON.stringify({
  result:'PINNED_OCCT8_CPP_L_PROFILE_POCKET_REBUILD_EXECUTED',
  occt:'8.0.1',nativeCppExecuted:true,
  sourceProjectId:fixture.history.document.projectId,
  records,exactAuthority:false,independentInteroperability:false,
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PINNED_CXX_L_POCKET_DEPTH_TWO_STEP_PASS',records},null,2));
