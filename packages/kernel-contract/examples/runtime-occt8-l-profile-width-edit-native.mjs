/**
 * Actual INTENT/SKETCH 120 -> 140 mm retrospective source-width edit
 * -> dependent native OCCT 8.0.1 C++ physical L rebuild and two STEP files.
 * This is a runnable native acceptance fixture, NOT a synthetic replacement.
 *
 * node packages/kernel-contract/examples/runtime-occt8-l-profile-width-edit-native.mjs
 *   /absolute/path/to/pinned/intuit3d_occt8_plate /fresh/output-directory
 *
 * No independent CAD importer is invoked here: exactAuthority and
 * independentInteroperability remain false until separate qualification.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildAuthoredLBracket,editAuthoredLBracketWidth,
  MODEL_L_BODY_ID,MODEL_L_CUT_IDS}
  from './runtime-occt8-l-profile-document.mjs';
import {requestFromRuntimeOcct8LProfile,runPinnedRuntimeOcct8LProfile}
  from '../src/runtime-occt8-l-profile-provider.mjs';
import {expectedOcct8LProfileMetrics}
  from '../src/occt8-l-profile-v3.mjs';

const binary=process.argv[2]??process.env.INTUIT3D_OCCT8_WORKER;
const folder=process.argv[3];
if(!binary||!folder){
  console.error('Usage: node packages/kernel-contract/examples/runtime-occt8-l-profile-width-edit-native.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
const output=resolve(folder);
await mkdir(output,{recursive:true});
let fixture=buildAuthoredLBracket();
const records=[];
async function physicalRebuild(label,width,volume){
  const request=requestFromRuntimeOcct8LProfile(
    fixture.history,MODEL_L_BODY_ID,{runtime:fixture.runtime,
      model:fixture.model,requestId:'l.width.'+label,exportStep:true});
  assert.equal(request.profile.width,width);
  assert.equal(expectedOcct8LProfileMetrics(request).volumeMm3,volume);
  assert.deepEqual(request.cuts.map(x=>x.featureId),MODEL_L_CUT_IDS);
  const result=await runPinnedRuntimeOcct8LProfile(
    fixture.history,MODEL_L_BODY_ID,{
      runtime:fixture.runtime,model:fixture.model,requestId:request.requestId,
      workerExecutable:resolve(binary),
      readCurrentRevision:()=>fixture.history.document.revision,
      stepOutput:join(output,label+'.step'),timeoutMs:120000});
  assert.equal(result.kind,'experimental_report',
    'real pinned C++ L-profile failure: '+JSON.stringify(result));
  assert.equal(result.semanticBodyId,MODEL_L_BODY_ID);
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.observed.source.solidCount,1);
  assert.ok(Math.abs(result.observed.source.volumeMm3-volume)<1e-6);
  assert.ok(Math.abs(result.observed.stepReadback.volumeMm3-volume)<1e-6);
  assert.match(result.artifact?.sha256??'',/^[a-f0-9]{64}$/);
  records.push({label,revision:request.revision,bodyId:request.featureId,
    profileId:request.profile.profileId,cutIds:request.cuts.map(c=>c.featureId),
    widthMm:width,thicknessMm:request.profile.thickness,
    sourceVolumeMm3:result.observed.source.volumeMm3,
    stepReadbackVolumeMm3:result.observed.stepReadback.volumeMm3,
    stepSha256:result.artifact.sha256,stepBytes:result.artifact.bytes});
}
await physicalRebuild('l-width-120',120,32720);
const edited=editAuthoredLBracketWidth(fixture,140);
for(const id of ['sketch.bracket','extrude.bracket',...MODEL_L_CUT_IDS])
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes(id),id);
assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
const undo=edited.runtime.undo(edited.history,['undo.l.width']);
const redo=edited.runtime.redo(undo,['redo.l.width']);
assert.equal(requestFromRuntimeOcct8LProfile(undo,MODEL_L_BODY_ID,{
  runtime:edited.runtime,model:edited.model,requestId:'l.width.undo',
  exportStep:false}).profile.width,120);
assert.equal(requestFromRuntimeOcct8LProfile(redo,MODEL_L_BODY_ID,{
  runtime:edited.runtime,model:edited.model,requestId:'l.width.redo',
  exportStep:false}).profile.width,140);
fixture={...edited,history:edited.runtime.reopen(edited.runtime.save(edited.history))};
await physicalRebuild('l-width-140',140,35920);
assert.notEqual(records[0].stepSha256,records[1].stepSha256);
assert.equal(records[0].profileId,records[1].profileId);
await writeFile(join(output,'authoritative-document.json'),
  fixture.runtime.save(fixture.history),{flag:'wx'});
await writeFile(join(output,'manifest.json'),JSON.stringify({
  result:'PINNED_OCCT8_CPP_L_PROFILE_SKETCH_WIDTH_REBUILD_EXECUTED',
  occt:'8.0.1',nativeCppExecuted:true,
  sourceProjectId:fixture.history.document.projectId,
  records,independentInteroperability:false,exactAuthority:false,
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PINNED_CXX_L_SKETCH_WIDTH_TWO_STEP_PASS',records},null,2));
