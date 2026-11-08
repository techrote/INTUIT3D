/**
 * One command on a machine with a GENUINE pinned OCCT 8.0.1 C++ binary:
 * INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
 *   npm run demo:occt8:bridge --workspace @intuit3d/workflow-runtime
 * No synthetic provider is installed. This script fails without the worker.
 */
import assert from 'node:assert/strict';
import {isAbsolute,join} from 'node:path';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
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
import {createPersistentHistorySource} from '../persistent-history-source.mjs';
import {verifyCurrentLivePlateStep} from '../nonocct-step-probe.mjs';
import {blankNativePlateHistory,authorBlankNativePlate,widenBlankNativePlate}
  from './blank-contour-physical-fixture.mjs';

const worker=process.env.INTUIT3D_OCCT8_WORKER;
if(!worker||!isAbsolute(worker))
  throw new Error('INTUIT3D_OCCT8_WORKER must be an actual absolute pinned C++ worker executable');
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const runFromEmpty=process.argv.includes('--from-empty');
const evidenceDir=process.env.INTUIT3D_NATIVE_EVIDENCE_DIR;
if(evidenceDir && (!runFromEmpty || !isAbsolute(evidenceDir)))
  throw new Error('INTUIT3D_NATIVE_EVIDENCE_DIR requires --from-empty and an absolute directory');
let current=runFromEmpty?blankNativePlateHistory(runtime):
  transactions.startUndoHistory(model.newProject('runtime.occt8.real.plate.cut'));
if(!runFromEmpty)current=runtime.commit(current,[
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
// Preserve the existing seven-stage JSON output contract for PLATFORM's
// source-pinned runtime_material_oracle. An opt-in additive run qualifies the
// new atomic two-command edit + disk-backed session recovery.
const runAtomicBatch=process.argv.includes('--atomic-batch');
if(runFromEmpty && runAtomicBatch)
  throw new Error('Use --from-empty or --atomic-batch, not both in one physical demo');
const probeExecutable=process.env.INTUIT3D_ANVIL_STEP_PROBE;
const expectedProbeSha256=process.env.INTUIT3D_ANVIL_PROBE_SHA256;
if(independentRequired && (!probeExecutable||!expectedProbeSha256))
  throw new Error('Independent run requires INTUIT3D_ANVIL_STEP_PROBE and INTUIT3D_ANVIL_PROBE_SHA256');
if(Boolean(probeExecutable)!==Boolean(expectedProbeSha256))
  throw new Error('Provide both AnvilCAD probe path and pinned binary SHA-256');
const runIndependent=Boolean(probeExecutable);
// A real filesystem-backed, single-writer project archive. Each model edit is
// published by a same-directory atomic rename; reopening below reads from disk,
// not an in-memory duplicate of the INTENT document.
const tempDir=mkdtempSync(join(tmpdir(),'intuit3d-occt8-session-'));
const archivePath=join(tempDir,'canonical-project.json');
const storageKey='intuit3d.real-occt8.demo';
let archiveWrites=0;
const diskStorage={
  getItem(key){
    if(key!==storageKey)throw new Error('unexpected archive key');
    try {return readFileSync(archivePath,'utf8');}
    catch(error){if(error?.code==='ENOENT')return null;throw error;}
  },
  setItem(key,value){
    if(key!==storageKey||typeof value!=='string')
      throw new Error('invalid native demonstration archive write');
    const pending=join(tempDir,'project.'+(++archiveWrites)+'.tmp');
    writeFileSync(pending,value,{flag:'wx'});
    renameSync(pending,archivePath);
  },
};
const durable=createPersistentHistorySource({
  runtime,storage:diskStorage,key:storageKey,initialHistory:current,
});
const host=await startLocalPinnedOcct8Bridge({
  runtime,model,plateContract,runPinnedOcct8Plate,workerExecutable:worker,
  pythonExecutable:process.env.PYTHON||(process.platform==='win32'?'python':'python3'),
  timeoutMs:120000,
});
const session=createLivePlateSession({runtime,...durable});
const results=[];
const options=(id)=>({
  url:host.url,token:host.token,requestId:id,exportStep:true,
  deadlineMs:120000,requiredBackend:'OCCT-cxx-8.0.1',
});
function preserveFromEmptyEvidence(label,capture){
  if(!evidenceDir)return null;
  assert.ok(capture,'no current pinned STEP custody to preserve');
  const archiveSha256=createHash('sha256').update(capture.archive).digest('hex');
  const stepSha256=createHash('sha256').update(capture.stepBytes).digest('hex');
  assert.equal(archiveSha256,capture.receipt.source.archiveSha256);
  assert.equal(stepSha256,capture.receipt.step.sha256);
  mkdirSync(evidenceDir,{recursive:true});
  // Refuse accidental overwrite of an earlier qualification: every run
  // should be tied to its own evidence directory and immutable source.
  writeFileSync(join(evidenceDir,label+'.i3d-model.json'),capture.archive,{flag:'wx'});
  writeFileSync(join(evidenceDir,label+'.receipt.json'),
    JSON.stringify(capture.receipt,null,2),{flag:'wx'});
  writeFileSync(join(evidenceDir,label+'.step'),capture.stepBytes,{flag:'wx'});
  return {label,archiveSha256,stepSha256,revision:capture.receipt.source.revision};
}
async function record(out,stage,activeSession=session){
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
  assert.equal(activeSession.currentStep()?.sha256,out.step.sha256);
  const target=expectedPlateMetrics(out.result.intendedPlate);
  const volume=out.result.observed.source.volumeMm3;
  assert.ok(Math.abs(target.volumeMm3-volume)<=Math.max(1e-7,Math.abs(target.volumeMm3)*1e-10));
  assert.ok(new TextDecoder().decode(out.step.bytes.subarray(0,20)).includes('ISO-10303-21'));
  const sample=runIndependent
    ? await verifyCurrentLivePlateStep({
        session:activeSession,evaluation:out,probeExecutable,expectedProbeSha256,
      })
    : null;
  results.push({stage,revision:out.source.revision,
    volumeMm3:volume,sha256:out.step.sha256,bytes:out.step.bytes.length,
    holes:out.result.intendedPlate.holes.map(h=>({x:h.x,y:h.y,radius:h.radius})),
    ...(sample?{externalCadSample:sample}:{})});
}
try{
  if(runFromEmpty){
    // This is a real from-zero structural SKETCH authoring transaction, not
    // a pointer/browser test or a seeded rectangle masquerading as user input.
    const authored=authorBlankNativePlate(session,runtime);
    assert.notEqual(session.save(),authored.blankArchive);
    assert.equal(session.currentStep(),null);
    await record(await session.evaluate(options('pinned.drawn.original')),
      'authored-from-empty-120mm');
    assert.deepEqual(results[0].holes,[{x:-25,y:0,radius:6},{x:25,y:0,radius:6}]);
    const firstCapture=session.captureCurrentStepEvidence();
    assert.ok(firstCapture,'pinned STEP must have an archive-bound receipt');
    assert.equal(firstCapture.archive,authored.sourceArchive);
    assert.equal(createHash('sha256').update(firstCapture.archive).digest('hex'),
      firstCapture.receipt.source.archiveSha256);
    assert.equal(createHash('sha256').update(firstCapture.stepBytes).digest('hex'),
      firstCapture.receipt.step.sha256);
    assert.equal(firstCapture.receipt.producer.backend,'OCCT-cxx-8.0.1');
    const originalEvidence=preserveFromEmptyEvidence('01-original',firstCapture);
    const updated=widenBlankNativePlate(session,runtime,authored.contourReceipt);
    assert.equal(updated.kind,'committed');
    assert.equal(session.currentStep(),null,
      'structural contour edit immediately revokes old STEP');
    await record(await session.evaluate(options('pinned.drawn.widened')),
      'retrospective-150mm-rebuild');
    assert.deepEqual(results[1].holes,[{x:-40,y:0,radius:6},{x:10,y:0,radius:6}]);
    assert.ok(results[1].volumeMm3>results[0].volumeMm3);
    assert.notEqual(results[1].sha256,results[0].sha256);
    const editedEvidence=preserveFromEmptyEvidence('02-edited',
      session.captureCurrentStepEvidence());
    const editedArchive=session.save();
    const unchanged=session.applyCommand({
      kind:'model.undo',projectId:session.refresh().projectId,
      expectedRevision:session.refresh().revision-1,
      eventIds:['native.drawn.stale.revision'],
    });
    assert.equal(unchanged.kind,'refused',
      'a stale command must not mutate authored geometry');
    assert.equal(session.save(),editedArchive);
    const undo=session.applyCommand({
      kind:'model.undo',projectId:session.refresh().projectId,
      expectedRevision:session.refresh().revision,
      eventIds:['native.drawn.undo.width'],
    });
    assert.equal(undo.kind,'committed');
    assert.equal(session.currentStep(),null);
    await record(await session.evaluate(options('pinned.drawn.undo')),
      'undo-width-rebuild');
    assert.deepEqual(results[2].holes,results[0].holes);
    assert.ok(Math.abs(results[2].volumeMm3-results[0].volumeMm3)<1e-7);
    const reopened=await session.reopenAndEvaluate(editedArchive,{
      ...options('pinned.drawn.reopen'),confirmReplacement:true,
    });
    assert.equal(reopened.kind,'submitted');
    await record(reopened.evaluation,'reopened-edited-contour');
    assert.deepEqual(results[3].holes,results[1].holes);
    assert.ok(Math.abs(results[3].volumeMm3-results[1].volumeMm3)<1e-7);
    assert.equal(session.save(),editedArchive);
    assert.equal(results.length,4);
    if(evidenceDir)writeFileSync(join(evidenceDir,'manifest.json'),
      JSON.stringify({format:'intuit3d.runtime.from-empty-native-evidence',
        version:1,originalEvidence,editedEvidence,
        browserPointerExecuted:false,
        nativeWorkerExecuted:true,externalCadProbeExecuted:runIndependent,
        results},null,2),{flag:'wx'});
    console.log(JSON.stringify({
      kind:runIndependent
        ?'RUNTIME_REAL_PINNED_OCCT8_FROM_EMPTY_EXTERNAL_SAMPLE_EXECUTED'
        :'RUNTIME_REAL_PINNED_OCCT8_FROM_EMPTY_LOCAL_BRIDGE_PASS',
      source:'authoritative empty INTENT/SKETCH contour, two bores, exact archive journal',
      browserPointerExecuted:false,
      nativeWorkerExecuted:true,
      externalCadProbeExecuted:runIndependent,
      ...(evidenceDir?{evidenceDir}:{}),
      exactAuthority:false,independentInteroperability:false,
      originalArchiveSha256:createHash('sha256').update(authored.sourceArchive).digest('hex'),
      editedArchiveSha256:createHash('sha256').update(editedArchive).digest('hex'),
      results,
    },null,2));
  } else {
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

  if(runAtomicBatch){
  // Physical batch acceptance: change an EARLIER extrusion dimension AND
  // resize two solver-authored hole constraints as one durable transaction
  // publication, then request one genuine pinned C++ rebuild. There must be
  // no intermediate native job or partially written project archive.
  const source=session.refresh();
  const writesBefore=archiveWrites;
  const batched=await session.applyCommandsAndEvaluate({
    kind:'commands.batch',projectId:source.projectId,
    expectedRevision:source.revision,commands:[
      {kind:'model.events',events:[{eventId:'pinned.real.batch.thickness.12',
        type:'feature.edit',featureId:'plate',
        patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}}}]},
      {kind:'sketch.holes.resize',request:{
        sketchFeatureId:'sketch.plate',eventId:'pinned.real.batch.layout',
        admission:'require_admissible',holeIds:['holeA','holeB'],
        pivotXmm:60,pivotYmm:40,scaleX:0.8,scaleY:1,radiusScale:0.75,
      }},
    ],
  },options('pinned.real.atomic.batch'));
  assert.equal(batched.kind,'submitted',JSON.stringify(batched));
  assert.equal(batched.edit.report.revision,source.revision+2);
  assert.deepEqual(batched.edit.invalidation.invalidatedFeatureIds,
    ['sketch.plate','plate','cut']);
  assert.equal(archiveWrites,writesBefore+1,
    'two accepted model edits must durably publish exactly once');
  await record(batched.evaluation,'atomic-thickness-and-hole-layout');
  assert.deepEqual(results[7].holes,results[2].holes);
  assert.ok(Math.abs(results[7].volumeMm3-results[2].volumeMm3)<1e-7);
  assert.notEqual(results[7].sha256,results[0].sha256);
  const batchArchive=session.save();
  assert.equal(readFileSync(archivePath,'utf8'),batchArchive);

  // Fresh session instance from the same ON-DISK authoritative journal.
  // STEP is not persisted or reused: real pinned C++ must reconstruct it.
  const reopenedSession=createLivePlateSession({
    runtime,...createPersistentHistorySource({runtime,storage:diskStorage,key:storageKey}),
  });
  assert.equal(reopenedSession.save(),batchArchive);
  assert.equal(reopenedSession.currentStep(),null);
  await record(await reopenedSession.evaluate(options('pinned.real.disk.reopen')),
    'disk-backed-session-reopen-rebuild',reopenedSession);
  assert.deepEqual(results[8].holes,results[7].holes);
  assert.ok(Math.abs(results[8].volumeMm3-results[7].volumeMm3)<1e-7);
  assert.equal(archiveWrites,writesBefore+1,
    'native evaluation and archive reopen must never rewrite model history');
  reopenedSession.cancel();
  }
  console.log(JSON.stringify({kind:runIndependent?'RUNTIME_REAL_PINNED_OCCT8_EXTERNAL_SAMPLE_EXECUTED':'RUNTIME_REAL_PINNED_OCCT8_LOCAL_BRIDGE_PASS',
    source:'actual INTENT/SKETCH and native C++ worker',
    exactAuthority:false,independentInteroperability:false,
    externalCadProbeExecuted:runIndependent,
    ...(runAtomicBatch?{
      persistedArchiveSha256:createHash('sha256').update(session.save()).digest('hex'),
      persistentHistoryWrites:archiveWrites,
    }:{}),
    results},null,2));
  }
}finally{
  session.cancel();
  try {await host.close();}
  finally {rmSync(tempDir,{recursive:true,force:true});}
}
