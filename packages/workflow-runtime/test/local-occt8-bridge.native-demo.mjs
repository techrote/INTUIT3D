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
import {runNonOcctPlateProbe} from '../nonocct-step-probe.mjs';

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
const host=await startLocalPinnedOcct8Bridge({
  runtime,model,plateContract,runPinnedOcct8Plate,workerExecutable:worker,
  pythonExecutable:process.env.PYTHON||(process.platform==='win32'?'python':'python3'),
  timeoutMs:120000,
});
const session=createLivePlateSession({
  runtime,readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
});
const independentRequired=process.argv.includes('--require-independent');
const probeExecutable=process.env.INTUIT3D_ANVIL_STEP_PROBE;
const expectedProbeSha256=process.env.INTUIT3D_ANVIL_PROBE_SHA256;
if(independentRequired && (!probeExecutable||!expectedProbeSha256))
  throw new Error('Independent run requires INTUIT3D_ANVIL_STEP_PROBE and INTUIT3D_ANVIL_PROBE_SHA256');
if(Boolean(probeExecutable)!==Boolean(expectedProbeSha256))
  throw new Error('Provide both AnvilCAD probe path and pinned binary SHA-256');
const runIndependent=Boolean(probeExecutable);
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
    ? await runNonOcctPlateProbe({
        probeExecutable,expectedProbeSha256,
        source:out.source,step:out.step,plate:out.result.intendedPlate,
      })
    : null;
  results.push({stage,revision:out.source.revision,
    volumeMm3:volume,sha256:out.step.sha256,bytes:out.step.bytes.length,
    ...(sample?{externalCadSample:sample}:{})});
}
try{
  const saved=session.save();
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
  const undone=await session.applyEditAndEvaluate(
    h=>runtime.undo(h,['pinned.real.undo.12mm']),options('pinned.real.undo'));
  assert.equal(undone.kind,'submitted');
  await record(undone.evaluation,'undo-rebuild-8mm');
  assert.ok(Math.abs(results[2].volumeMm3-results[0].volumeMm3)<1e-7);
  const reopened=await session.reopenAndEvaluate(saved,{
    ...options('pinned.real.reopen'),confirmReplacement:true,
  });
  assert.equal(reopened.kind,'submitted');
  await record(reopened.evaluation,'archive-reopen-rebuild');
  assert.equal(session.save(),saved);
  console.log(JSON.stringify({kind:runIndependent?'RUNTIME_REAL_PINNED_OCCT8_EXTERNAL_SAMPLE_EXECUTED':'RUNTIME_REAL_PINNED_OCCT8_LOCAL_BRIDGE_PASS',
    source:'actual INTENT/SKETCH and native C++ worker',
    exactAuthority:false,independentInteroperability:false,
    externalCadProbeExecuted:runIndependent,results},null,2));
}finally{
  session.cancel();
  await host.close();
}
