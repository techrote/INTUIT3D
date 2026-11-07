/**
 * One command on a machine with a GENUINE pinned OCCT 8.0.1 C++ binary:
 * INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
 *   npm run demo:occt8:bridge --workspace @intuit3d/workflow-runtime
 * No synthetic provider is installed. This script fails without the worker.
 */
import assert from 'node:assert/strict';
import {isAbsolute} from 'node:path';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {expectedPlateMetrics} from '@intuit3d/kernel-contract/plate-v1';
import {runPinnedOcct8Plate} from '@intuit3d/kernel-contract/local-occt8-provider';
import {createWorkflowRuntime} from '../index.mjs';
import {startLocalPinnedOcct8Bridge} from '../local-plate-bridge.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';
import {verifyCurrentLivePlateStep} from '../nonocct-step-probe.mjs';

const worker=process.env.INTUIT3D_OCCT8_WORKER;
if(!worker||!isAbsolute(worker))
  throw new Error('INTUIT3D_OCCT8_WORKER must be an actual absolute pinned C++ worker executable');
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
let current=transactions.startUndoHistory(model.newProject('runtime.occt8.real.plate.cut'));
current=runtime.commit(current,[
  create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:sketch.plateSketchFixture()}}),
  create('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
    writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
  create('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
    writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
]);
// Fail before opening a localhost listener when an external verification run
// cannot possibly proceed. Do not leave a live process behind on misconfiguration.
const independentRequired=process.argv.includes('--require-independent');
const probeExecutable=process.env.INTUIT3D_ANVIL_STEP_PROBE;
const expectedProbeSha256=process.env.INTUIT3D_ANVIL_PROBE_SHA256;
if(independentRequired && (!probeExecutable||!expectedProbeSha256))
  throw new Error('Independent run requires INTUIT3D_ANVIL_STEP_PROBE and INTUIT3D_ANVIL_PROBE_SHA256');
if(Boolean(probeExecutable)!==Boolean(expectedProbeSha256))
  throw new Error('Provide both AnvilCAD probe path and pinned binary SHA-256');
const runIndependent=Boolean(probeExecutable);
const host=await startLocalPinnedOcct8Bridge({
  runtime,model,plateContract,runPinnedOcct8Plate,workerExecutable:worker,
  pythonExecutable:process.env.PYTHON||(process.platform==='win32'?'python':'python3'),
  timeoutMs:120000,
});
const session=createLivePlateSession({
  runtime,readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
});
const results=[];
const options=(id)=>({
  url:host.url,token:host.token,requestId:id,exportStep:true,deadlineMs:120000,
});
async function record(out,stage){
  assert.equal(out.kind,'experimental_plate_evaluated',JSON.stringify(out));
  assert.equal(out.result.backend,'OCCT-cxx-8.0.1');
  assert.equal(out.result.occtVersion,'8.0.1');
  assert.equal(out.result.artifact?.verification,'occt8_part21_plate_subset');
  assert.equal(out.step?.verification,'occt8_part21_plate_subset');
  assert.deepEqual(out.result.part21Audit,{
    kind:'part21-plate-structural-v1',sha256:out.step.sha256,
  });
  assert.equal(out.exactAuthority,false);
  assert.equal(out.independentInteroperability,false);
  assert.equal(session.currentStep()?.sha256,out.step.sha256);
  const target=expectedPlateMetrics(out.result.intendedPlate);
  const volume=out.result.observed.source.volumeMm3;
  assert.ok(Math.abs(target.volumeMm3-volume)<=Math.max(1e-7,Math.abs(target.volumeMm3)*1e-10));
  assert.ok(new TextDecoder().decode(out.step.bytes.subarray(0,20)).includes('ISO-10303-21'));
  const sample=runIndependent
    ? await verifyCurrentLivePlateStep({
        session,evaluation:out,probeExecutable,expectedProbeSha256,
      })
    : null;
  results.push({stage,revision:out.source.revision,
    volumeMm3:volume,sha256:out.step.sha256,bytes:out.step.bytes.length,
    holes:out.result.intendedPlate.holes.map(h=>({x:h.x,y:h.y,radius:h.radius})),
    ...(sample?{externalCadSample:sample}:{})});
}
try{
  const initialArchive=session.save();
  await record(await session.evaluate(options('pinned.real.8mm')),'plate-8mm-two-bores');
  const changed=await session.applyEditAndEvaluate(h=>{
    const plate=model.featuresOf(h.document).find(f=>f.id==='plate');
    return runtime.commit(h,[{eventId:'pinned.real.thickness.12mm',
      type:'feature.edit',featureId:'plate',
      patch:{payload:{...plate.payload,thicknessMm:12}}}],h.document.revision);
  },options('pinned.real.12mm'));
  assert.equal(changed.kind,'submitted');
  await record(changed.evaluation,'retrospective-12mm-rebuild');
  assert.ok(results[1].volumeMm3>results[0].volumeMm3);
  assert.notEqual(results[1].sha256,results[0].sha256);

  // This is a *real solved-sketch change* to the two existing bores, not just
  // another thickness setting. It must survive native Boolean/STEP reconstruction
  // and a separate non-OCCT importer when the independent executable is supplied.
  const resized=await session.applyEditAndEvaluate(h=>runtime.resizePlateHoleLayout(h,{
    sketchFeatureId:'sketch.plate',eventId:'pinned.real.hole.layout.resize',
    expectedRevision:h.document.revision,admission:'require_admissible',
    holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
    scaleX:0.8,scaleY:1,radiusScale:0.75,
  }),options('pinned.real.holes.resized'));
  assert.equal(resized.kind,'submitted',JSON.stringify(resized));
  assert.deepEqual(resized.edit.invalidation.invalidatedFeatureIds,
    ['sketch.plate','plate','cut']);
  await record(resized.evaluation,'solved-hole-spacing-and-bore-resize');
  assert.deepEqual(results[2].holes.map(h=>[h.x,h.y,h.radius]),
    [[-20,0,4.5],[20,0,4.5]]);
  assert.ok(results[2].volumeMm3>results[1].volumeMm3);
  assert.notEqual(results[2].sha256,results[1].sha256);
  const editedArchive=session.save();

  const undoneHoles=await session.applyEditAndEvaluate(
    h=>runtime.undo(h,['pinned.real.undo.hole.layout']),
    options('pinned.real.undo.holes'));
  assert.equal(undoneHoles.kind,'submitted');
  await record(undoneHoles.evaluation,'undo-hole-layout-rebuild');
  assert.deepEqual(results[3].holes,results[1].holes);
  assert.ok(Math.abs(results[3].volumeMm3-results[1].volumeMm3)<1e-7);

  const undoneThickness=await session.applyEditAndEvaluate(
    h=>runtime.undo(h,['pinned.real.undo.thickness']),
    options('pinned.real.undo.thickness'));
  assert.equal(undoneThickness.kind,'submitted');
  await record(undoneThickness.evaluation,'undo-thickness-rebuild');
  assert.deepEqual(results[4].holes,results[0].holes);
  assert.ok(Math.abs(results[4].volumeMm3-results[0].volumeMm3)<1e-7);

  const reopenedEdited=await session.reopenAndEvaluate(editedArchive,{
    ...options('pinned.real.reopen.edited'),confirmReplacement:true,
  });
  assert.equal(reopenedEdited.kind,'submitted');
  await record(reopenedEdited.evaluation,'archive-reopen-edited-hole-layout');
  assert.deepEqual(results[5].holes,results[2].holes);
  assert.ok(Math.abs(results[5].volumeMm3-results[2].volumeMm3)<1e-7);
  assert.equal(session.save(),editedArchive);

  const reopenedInitial=await session.reopenAndEvaluate(initialArchive,{
    ...options('pinned.real.reopen.initial'),confirmReplacement:true,
  });
  assert.equal(reopenedInitial.kind,'submitted');
  await record(reopenedInitial.evaluation,'archive-reopen-original-plate');
  assert.deepEqual(results[6].holes,results[0].holes);
  assert.ok(Math.abs(results[6].volumeMm3-results[0].volumeMm3)<1e-7);
  assert.equal(session.save(),initialArchive);
  console.log(JSON.stringify({kind:runIndependent?'RUNTIME_REAL_PINNED_OCCT8_EXTERNAL_SAMPLE_EXECUTED':'RUNTIME_REAL_PINNED_OCCT8_LOCAL_BRIDGE_PASS',
    source:'actual INTENT/SKETCH and native C++ worker',
    exactAuthority:false,independentInteroperability:false,
    externalCadProbeExecuted:runIndependent,results},null,2));
}finally{
  session.cancel();
  await host.close();
}
