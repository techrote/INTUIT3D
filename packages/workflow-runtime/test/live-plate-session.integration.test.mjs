/**
 * Real INTENT + SKETCH + loopback HTTP browser-side session acceptance.
 * The provider is an explicitly synthetic native TEST DOUBLE: no physical
 * B-rep, independent STEP parser or OCCT qualification is claimed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {createWorkflowRuntime} from '../index.mjs';
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
const STEP=Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
function initialProject() {
  let history=transactions.startUndoHistory(model.newProject('runtime.live.plate'));
  return runtime.commit(history,[
    created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
function fakeProvider(request,options) {
  assert.deepEqual(plateContract.parsePlateRequest(request),request);
  return (async()=>{
    if(request.exportStep) await writeFile(options.stepOutput,STEP,{flag:'wx'});
    const artifact=request.exportStep?{path:options.stepOutput,bytes:STEP.length,
      sha256:createHash('sha256').update(STEP).digest('hex'),
      verification:'same_engine_step_readback'}:null;
    return {kind:'experimental_report',requestId:request.requestId,
      featureId:request.featureId,revision:request.revision,
      backend:plateContract.EXPERIMENTAL_BACKEND,
      occtVersion:plateContract.EXPERIMENTAL_OCCT_VERSION,
      exactAuthority:false,independentInteroperability:false,
      observed:{source:{valid:true}},artifact};
  })();
}
test('live model-backed plate: add hole, thickness edit, undo/reopen and local STEP',async()=>{
  let history=initialProject();
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;}});
  const host=await startLocalPlateBridge({runtime,model,plateContract,runExperimentalPlate:fakeProvider});
  try {
    const evaluate=(requestId)=>session.evaluate({
      url:host.url,token:host.token,requestId,exportStep:true});
    const first=await evaluate('live.initial');
    assert.equal(first.kind,'experimental_plate_evaluated',JSON.stringify(first));
    assert.equal(first.result.intendedPlate.holes.length,2);
    assert.deepEqual(Buffer.from(session.currentStep().bytes),STEP);
    // Actual HTTP adapter SHA-verifies these test-provider bytes. The caller
    // must not be able to corrupt the cached copy via either return path.
    first.step.bytes[0]=0;
    assert.deepEqual(Buffer.from(session.currentStep().bytes),STEP,
      'modifying an evaluation response must not alter the native receipt');
    const downloaded=session.currentStep();
    downloaded.bytes[0]=0;
    assert.deepEqual(Buffer.from(session.currentStep().bytes),STEP,
      'modifying one download buffer must not corrupt later downloads');
    const savedBefore=session.save();
    const denied=session.applyEdit(h=>runtime.editPlateHoles(h,{
      sketchFeatureId:'sketch.plate',eventId:'bad.hole',
      expectedRevision:h.document.revision,admission:'require_admissible',
      operations:[{kind:'add',id:'hole.bad',x:35,y:40,radius:4}]}));
    assert.equal(denied.kind,'refused');
    assert.equal(session.save(),savedBefore);
    assert.ok(session.currentStep(),'refused edit does not invalidate still-current bytes');
    const added=session.applyEdit(h=>runtime.editPlateHoles(h,{
      sketchFeatureId:'sketch.plate',eventId:'add.third',
      expectedRevision:h.document.revision,admission:'require_admissible',
      operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}]}));
    assert.equal(added.kind,'committed',JSON.stringify(added));
    assert.deepEqual(added.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
    assert.equal(session.currentStep(),null);
    const second=await evaluate('live.three');
    assert.equal(second.kind,'experimental_plate_evaluated',JSON.stringify(second));
    assert.equal(second.result.intendedPlate.holes.length,3);
    const edited=session.applyEdit(h=>runtime.commit(h,[{
      eventId:'edit.plate.thickness',type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:10}},
    }]));
    assert.equal(edited.kind,'committed');
    assert.equal(session.currentStep(),null);
    const third=await evaluate('live.thicker');
    assert.equal(third.kind,'experimental_plate_evaluated',JSON.stringify(third));
    assert.equal(third.result.intendedPlate.thickness,10);
    const saved=session.save();
    assert.equal(session.reopen(saved).kind,'opened');
    const undone=session.applyEdit(h=>runtime.undo(h,['undo.thickness']));
    assert.equal(undone.kind,'committed');
    assert.equal((await evaluate('live.undo')).result.intendedPlate.thickness,8);
    const reloaded=session.reopen(saved);
    assert.equal(reloaded.kind,'refused','replacement requires explicit consent');
    assert.equal(session.reopen(saved,{confirmReplacement:true}).kind,'opened');
    const replay=await evaluate('live.reopen');
    assert.equal(replay.result.intendedPlate.thickness,10);
    assert.equal(replay.result.intendedPlate.holes.length,3);
    assert.equal(replay.exactAuthority,false);
    assert.equal(replay.independentInteroperability,false);
  } finally {session.cancel();await host.close();}
});

test('one-command edit + localhost evaluation sends only admitted revisions and fences STEP',async()=>{
  let history=initialProject();
  const host=await startLocalPlateBridge({runtime,model,plateContract,runExperimentalPlate:fakeProvider});
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;}});
  const native=(requestId)=>({url:host.url,token:host.token,requestId,exportStep:true});
  try {
    const original=await session.evaluate(native('composed.initial'));
    assert.equal(original.kind,'experimental_plate_evaluated');
    assert.ok(session.currentStep());
    const baseline=session.save();
    const refused=await session.applyEditAndEvaluate(h=>runtime.editPlateHoles(h,{
      sketchFeatureId:'sketch.plate',eventId:'composed.invalid',
      expectedRevision:h.document.revision,admission:'require_admissible',
      operations:[{kind:'add',id:'hole.invalid',x:35,y:40,radius:4}],
    }),native('composed.invalid.never.sent'));
    assert.equal(refused.kind,'refused');
    assert.equal(refused.evaluation,null);
    assert.equal(session.save(),baseline);
    assert.ok(session.currentStep(),'refused authoring retains already-verified receipt');
    const committed=await session.applyEditAndEvaluate(h=>runtime.editPlateHoles(h,{
      sketchFeatureId:'sketch.plate',eventId:'composed.third',
      expectedRevision:h.document.revision,admission:'require_admissible',
      operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
    }),native('composed.third'));
    assert.equal(committed.kind,'submitted',JSON.stringify(committed));
    assert.equal(committed.edit.kind,'committed');
    assert.equal(committed.evaluation.kind,'experimental_plate_evaluated',
      JSON.stringify(committed.evaluation));
    assert.equal(committed.evaluation.result.intendedPlate.holes.length,3);
    assert.deepEqual(committed.edit.invalidation.invalidatedFeatureIds,
      ['sketch.plate','plate','cut']);
    assert.ok(session.currentStep(),'latest revision has a verified experimental receipt');
    const revision=history.document.revision;
    const saved=session.save();
    const undone=await session.applyEditAndEvaluate(h=>runtime.undo(h,['composed.undo']),
      native('composed.undo'));
    assert.equal(undone.kind,'submitted');
    assert.equal(undone.edit.history.document.revision,revision+1);
    assert.equal(undone.evaluation.kind,'experimental_plate_evaluated');
    assert.equal(undone.evaluation.result.intendedPlate.holes.length,2);
    assert.equal(session.currentStep()?.sha256,undone.evaluation.step.sha256);
    assert.equal(session.reopen(saved).kind,'refused');
    assert.equal(session.reopen(saved,{confirmReplacement:true}).kind,'opened');
    assert.equal(session.currentStep(),null,'restoring a different revision fences native bytes');
    const reopened=await session.evaluate(native('composed.reopened'));
    assert.equal(reopened.kind,'experimental_plate_evaluated');
    assert.equal(reopened.result.intendedPlate.holes.length,3);
    assert.equal(reopened.exactAuthority,false);
    assert.equal(reopened.independentInteroperability,false);
  } finally {session.cancel();await host.close();}
});

test('superseded noncooperative native reply never becomes downloadable',async()=>{
  let history=initialProject(),start,finish;
  const begun=new Promise(r=>start=r);
  const gate=new Promise(r=>finish=r);
  let requests=0;
  const fakeReply=opts=>({kind:'experimental_plate_evaluated',exactAuthority:false,
    independentInteroperability:false,
    source:{projectId:history.document.projectId,revision:history.document.revision},
    result:{requestId:opts.requestId,cutFeatureId:opts.cutFeatureId},
    step:{filename:'plate.step',bytes:new Uint8Array([1,2,3]),sha256:'synthetic'}});
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;},
    evaluateImpl:async opts=>{
      requests++;
      if(requests===1) {start();await gate;}
      return fakeReply(opts);
    }});
  const first=session.evaluate({requestId:'live.old'});
  await begun;
  session.applyEdit(h=>runtime.commit(h,[{
    eventId:'edit.thickness',type:'feature.edit',featureId:'plate',
    patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}},
  }]));
  finish();
  assert.equal((await first).code,'stale_revision');
  assert.equal(session.currentStep(),null);
  const newest=await session.evaluate({requestId:'live.new'});
  assert.equal(newest.kind,'experimental_plate_evaluated');
  assert.deepEqual([...session.currentStep().bytes],[1,2,3]);
  history=runtime.undo(history,['undo.thickness']);
  assert.equal(session.currentStep(),null,'external undo invalidates receipt');
  assert.equal(session.refresh().hasVerifiedStep,false);
});

test('same-revision verified STEP survives cancelled, unavailable and STEP-less native refresh; edit revokes it',async()=>{
  let history=initialProject();
  let attempts=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;},
    evaluateImpl:async options=>{
      attempts++;
      if(attempts===2) return {kind:'unresolved',code:'worker_crash',
        reason:'synthetic provider unavailable',artifact:null,
        exactAuthority:false,independentInteroperability:false};
      return {kind:'experimental_plate_evaluated',exactAuthority:false,
        independentInteroperability:false,
        source:{projectId:history.document.projectId,revision:history.document.revision},
        result:{requestId:options.requestId,cutFeatureId:options.cutFeatureId},
        step:options.exportStep?{filename:'synthetic.step',
          bytes:new Uint8Array([1,2,3]),sha256:'synthetic-only'}:undefined};
    }});
  const initial=await session.evaluate({requestId:'recovery.first',exportStep:true});
  assert.equal(initial.kind,'experimental_plate_evaluated');
  assert.ok(session.currentStep());
  const originalArchive=session.save();
  session.cancel();
  assert.equal(session.currentStep()?.sha256,'synthetic-only',
    'cancelling a job must not revoke verified bytes of the unchanged document');
  const unavailable=await session.evaluate({requestId:'recovery.unavailable',exportStep:true});
  assert.equal(unavailable.kind,'unresolved');
  assert.equal(unavailable.code,'worker_crash');
  assert.equal(session.refresh().lastResultKind,'unresolved',
    'the latest provider failure must remain visible alongside a valid older receipt');
  assert.equal(session.currentStep()?.sha256,'synthetic-only',
    'failed native refresh does not corrupt a still-current verified STEP');
  const noExport=await session.evaluate({requestId:'recovery.noexport',exportStep:false});
  assert.equal(noExport.kind,'experimental_plate_evaluated');
  assert.equal(noExport.step,undefined);
  assert.ok(session.currentStep(),
    'a native evaluation with export disabled must not erase the existing current STEP');
  const changed=session.applyEdit(h=>runtime.commit(h,[{
    eventId:'recovery.change.thickness',type:'feature.edit',featureId:'plate',
    patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}},
  }]));
  assert.equal(changed.kind,'committed');
  assert.notEqual(session.save(),originalArchive);
  assert.equal(session.currentStep(),null,
    'even a historically valid export must be revoked after a real model revision');
  assert.equal(session.refresh().lastResultKind,null);
});

test('one-call reopen and native rebuild refuses unconfirmed replacement; rebuilds confirmed archive over HTTP',async()=>{
  let history=initialProject();
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;}});
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:fakeProvider});
  const native=(requestId,confirmReplacement)=>({
    url:host.url,token:host.token,requestId,confirmReplacement,exportStep:true,
  });
  try {
    const saved=session.save();
    const edited=session.applyEdit(h=>runtime.commit(h,[{
      eventId:'reopen.change.thickness',type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}},
    }]));
    assert.equal(edited.kind,'committed');
    const before=session.save();
    const blocked=await session.reopenAndEvaluate(saved,native('reopen.denied',false));
    assert.equal(blocked.kind,'refused');
    assert.equal(blocked.evaluation,null);
    assert.equal(session.save(),before);
    assert.equal(session.currentStep(),null);
    const accepted=await session.reopenAndEvaluate(saved,native('reopen.confirmed',true));
    assert.equal(accepted.kind,'submitted',JSON.stringify(accepted));
    assert.equal(accepted.reopen.kind,'opened');
    assert.equal(accepted.evaluation.kind,'experimental_plate_evaluated',
      JSON.stringify(accepted.evaluation));
    assert.equal(accepted.evaluation.result.intendedPlate.thickness,8);
    assert.equal(session.save(),saved);
    assert.equal(session.currentStep()?.sha256,accepted.evaluation.step.sha256);
    assert.equal(accepted.evaluation.exactAuthority,false);
    assert.equal(accepted.evaluation.independentInteroperability,false);
  } finally {session.cancel();await host.close();}
});

test('hung native attempt times out promptly, retains same-archive STEP, and recovers without late publication',async()=>{
  let history=initialProject(),calls=0,releaseHung;
  const hung=new Promise(resolve=>{releaseHung=resolve;});
  const receipt=(options,attempt)=>({kind:'experimental_plate_evaluated',
    exactAuthority:false,independentInteroperability:false,
    source:{projectId:history.document.projectId,revision:history.document.revision},
    result:{requestId:options.requestId,cutFeatureId:options.cutFeatureId},
    step:{filename:'synthetic.step',bytes:new Uint8Array([attempt]),sha256:'synthetic.'+attempt}});
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;},
    evaluateImpl:async options=>{
      const attempt=++calls;
      if(attempt===2) await hung; // Deliberately ignores AbortSignal.
      return receipt(options,attempt);
    }});
  const initial=await session.evaluate({requestId:'deadline.initial'});
  assert.equal(initial.kind,'experimental_plate_evaluated');
  assert.equal(session.currentStep()?.sha256,'synthetic.1');
  // The pre-fix path never settled until the test double voluntarily returned.
  const bounded=await Promise.race([
    session.evaluate({requestId:'deadline.hung',deadlineMs:40}),
    new Promise(resolve=>setTimeout(()=>resolve({code:'test_watchdog'}),1500)),
  ]);
  assert.equal(bounded.code,'timeout',JSON.stringify(bounded));
  assert.equal(bounded.exactAuthority,false);
  assert.equal(session.refresh().lastResultKind,'unresolved');
  assert.equal(session.currentStep()?.sha256,'synthetic.1',
    'a hung same-revision refresh cannot revoke a verified older download');
  const recovered=await session.evaluate({requestId:'deadline.recovered',deadlineMs:200});
  assert.equal(recovered.kind,'experimental_plate_evaluated');
  assert.equal(session.currentStep()?.sha256,'synthetic.3');
  releaseHung(); // Native result from the timed-out attempt arrives late.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(session.currentStep()?.sha256,'synthetic.3',
    'late completion must not publish after a newer successful evaluation');
  const changed=session.applyEdit(h=>runtime.commit(h,[{
    eventId:'deadline.edit.thickness',type:'feature.edit',featureId:'plate',
    patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}},
  }]));
  assert.equal(changed.kind,'committed');
  assert.equal(session.currentStep(),null,'a real edit must invalidate the prior receipt');
});

test('explicit cancellation settles immediately even if the adapter ignores AbortSignal',async()=>{
  let history=initialProject(),started,release;
  const begun=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;},
    evaluateImpl:async ()=>{started();await gate;return {kind:'unresolved',code:'cancelled',
      exactAuthority:false,independentInteroperability:false};}});
  const pending=session.evaluate({requestId:'cancel.noncooperative',deadlineMs:10000});
  await begun;
  session.cancel();
  const result=await Promise.race([
    pending,new Promise(resolve=>setTimeout(()=>resolve({code:'test_watchdog'}),1500)),
  ]);
  assert.equal(result.code,'stale_revision',JSON.stringify(result));
  assert.equal(session.refresh().inFlight,false);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(session.currentStep(),null);
  assert.equal(session.refresh().lastResultKind,null);
  await assert.rejects(session.evaluate({deadlineMs:Infinity}),/deadlineMs/);
});


test('solver-backed preview does not mutate project or STEP; one-call commit rebuilds physical request',async()=>{
  let history=initialProject(),nativeRequests=0;
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:async(req,opts)=>{nativeRequests++;return fakeProvider(req,opts);}});
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:next=>{history=next;}});
  const native=id=>({url:host.url,token:host.token,requestId:id,exportStep:true});
  try {
    const original=await session.evaluate(native('preview.initial'));
    assert.equal(original.kind,'experimental_plate_evaluated');
    assert.equal(nativeRequests,1);
    const originalArchive=session.save();
    const originalStep=session.currentStep();
    const admitted=session.previewEdit(h=>runtime.editPlateHoles(h,{
      sketchFeatureId:'sketch.plate',eventId:'preview.hole.add',
      expectedRevision:h.document.revision,admission:'require_admissible',
      operations:[{kind:'add',id:'previewC',x:60,y:20,radius:4}],
    }));
    assert.equal(admitted.kind,'preview',JSON.stringify(admitted));
    assert.equal(admitted.exactAuthority,false);
    assert.equal(admitted.nativeEvaluation,null);
    assert.equal(admitted.sourceRevision,history.document.revision);
    assert.equal(admitted.candidateRevision,history.document.revision+1);
    assert.equal(admitted.report.features.find(f=>f.featureId==='sketch.plate').profile.holes.length,3);
    assert.deepEqual(admitted.invalidation.invalidatedFeatureIds,
      ['sketch.plate','plate','cut']);
    assert.equal(session.save(),originalArchive,'candidate must not enter authoritative journal');
    assert.deepEqual(session.currentStep(),originalStep,'uncommitted drag must not revoke STEP');
    assert.notEqual(session.currentStep(),originalStep,
      'unchanged current STEP must be returned as independent download bytes');
    assert.equal(nativeRequests,1,'preview does not dispatch physical provider');
    const applied=await session.commitPreviewAndEvaluate(admitted,native('preview.physical'));
    assert.equal(applied.kind,'submitted');
    assert.equal(applied.evaluation.kind,'experimental_plate_evaluated',
      JSON.stringify(applied.evaluation));
    assert.equal(applied.evaluation.result.intendedPlate.holes.length,3);
    assert.equal(nativeRequests,2);
    assert.equal(applied.edit.invalidation.exactReuseAllowed,false);
    assert.notEqual(session.save(),originalArchive);
    assert.equal(session.currentStep()?.sha256,applied.evaluation.step.sha256);
    const twice=await session.commitPreviewAndEvaluate(admitted,native('preview.duplicate'));
    assert.equal(twice.kind,'refused');
    assert.equal(twice.edit.code,'invalid_preview');
    assert.equal(twice.evaluation,null);
    assert.equal(nativeRequests,2,'a consumed preview must never rebuild twice');
    const undone=session.applyEdit(h=>runtime.undo(h,['preview.undo']));
    assert.equal(undone.kind,'committed');
    assert.equal(session.currentStep(),null);
    assert.equal(undone.report.features.find(f=>f.featureId==='sketch.plate').profile.holes.length,2);
  }finally{session.cancel();await host.close();}
});

test('preview refusal and stale archive fences preserve author intent with no native dispatch',async()=>{
  let history=initialProject(),dispatched=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:next=>{history=next;},
    evaluateImpl:async()=>{dispatched++;throw Error('must not dispatch for stale or refused preview');}});
  const attempt=(eventId,id,x,y)=>session.previewEdit(h=>runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId,
    expectedRevision:h.document.revision,admission:'require_admissible',
    operations:[{kind:'add',id,x,y,radius:4}],
  }));
  const original=session.save();
  const refused=attempt('preview.bad','previewBad',35,40);
  assert.equal(refused.kind,'refused','overlap is decided by real SKETCH profile gate');
  assert.equal(session.save(),original);
  const first=attempt('preview.okA','previewA',60,20);
  const competing=attempt('preview.okB','previewB',70,20);
  assert.equal(first.kind,'preview');
  assert.equal(competing.kind,'preview');
  assert.equal(session.save(),original);
  assert.equal(session.refresh().hasActivePreview,true);
  const old=await session.commitPreviewAndEvaluate(first,{requestId:'preview.old'});
  assert.equal(old.kind,'refused');
  assert.equal(old.edit.code,'invalid_preview',
    'older pointer pose must not commit after a newer pose is rendered');
  assert.equal(old.evaluation,null);
  assert.equal(session.cancelPreview(first).code,'invalid_preview',
    'late pointercancel must not discard a newer gesture');
  // Display-layer mutation must never become authoritative candidate geometry.
  competing.report.features[0].diagnostics.push('UI tampering must be ignored');
  const accepted=session.commitPreview(competing);
  assert.equal(accepted.kind,'committed');
  assert.equal(accepted.report.features.find(f=>f.featureId==='sketch.plate').profile.holes.length,3);
  assert.equal(session.refresh().hasActivePreview,false);
  const stale=await session.commitPreviewAndEvaluate(competing,{requestId:'preview.used'});
  assert.equal(stale.kind,'refused');
  assert.equal(stale.edit.code,'invalid_preview');
  assert.equal(stale.evaluation,null);
  const foreign=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:next=>{history=next;}});
  assert.equal(foreign.commitPreview(first).code,'invalid_preview');
  assert.equal(dispatched,0,'previews, refused edits and stale tokens cannot invoke native');
  assert.equal(history.document.revision,accepted.report.revision);
  assert.equal(session.currentStep(),null,'committed preview revokes old geometry');
  const external=attempt('preview.external','previewD',60,20);
  assert.equal(external.kind,'preview');
  history=runtime.undo(history,['preview.external.undo']);
  assert.equal(session.commitPreview(external).code,'stale_preview');
  assert.equal(session.refresh().hasActivePreview,false);
});

test('rejected latest pose and pointercancel never publish a previous drag sample',()=>{
  let history=initialProject();
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:next=>{history=next;}});
  const pose=(eventId,x,y)=>session.previewEdit(h=>runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId,expectedRevision:h.document.revision,
    admission:'require_admissible',operations:[{kind:'add',id:'holeC',x,y,radius:4}],
  }));
  const before=session.save(),revision=history.document.revision;
  const first=pose('drag.first',60,20);
  const second=pose('drag.second',70,20);
  assert.equal(first.kind,'preview');assert.equal(second.kind,'preview');
  assert.equal(session.commitPreview(first).code,'invalid_preview');
  assert.equal(pose('drag.invalid',35,40).kind,'refused');
  assert.equal(session.commitPreview(second).code,'invalid_preview',
    'latest invalid pointer sample must revoke earlier valid pose');
  assert.equal(session.refresh().hasActivePreview,false);
  const third=pose('drag.third',60,20);
  assert.equal(third.kind,'preview');
  assert.equal(session.cancelPreview(third).kind,'discarded');
  assert.equal(session.commitPreview(third).code,'invalid_preview');
  assert.equal(session.cancelPreview(third).code,'invalid_preview');
  assert.equal(session.save(),before);
  assert.equal(history.document.revision,revision);
  const final=pose('drag.final',75,20);
  assert.equal(final.kind,'preview');
  assert.equal(session.commitPreview(final).kind,'committed');
  assert.equal(session.commitPreview(final).code,'invalid_preview');
  assert.notEqual(session.save(),before);
});


test('native state preserves actionable refusal and source-valid last-good STEP without stale availability',async()=>{
  let history=initialProject();
  let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  let calls=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:next=>{history=next;},
    evaluateImpl:async opts=>{
      calls++;
      if(calls===2) {
        await blocked;
        return {kind:'unresolved',code:'unsupported_feature',
          reason:'additional authored body.plate.2 omitted by plate-v1',
          artifact:null,exactAuthority:false,independentInteroperability:false};
      }
      if(calls===3) return new Promise(()=>{}); // non-cooperative hung provider
      return {kind:'experimental_plate_evaluated',
        exactAuthority:false,independentInteroperability:false,
        source:{projectId:history.document.projectId,revision:history.document.revision},
        result:{requestId:opts.requestId,cutFeatureId:opts.cutFeatureId},
        step:{filename:'plate.step',bytes:Uint8Array.of(1,2,3),
          sha256:'synthetic-unqualified-step'}};
    }});
  assert.deepEqual({
    provider:session.refresh().providerState,step:session.refresh().stepAvailability,
    code:session.refresh().lastResultCode,
  },{provider:'idle',step:'unavailable',code:null});
  const first=await session.evaluate({requestId:'diagnostic.first'});
  assert.equal(first.kind,'experimental_plate_evaluated');
  assert.equal(session.refresh().providerState,'evaluated');
  assert.equal(session.refresh().stepAvailability,'current');
  assert.equal(session.refresh().lastResultReason,null);
  const awaiting=session.evaluate({requestId:'diagnostic.blocked'});
  assert.equal(session.refresh().providerState,'pending');
  assert.equal(session.refresh().stepAvailability,'last_good');
  assert.equal(session.refresh().hasVerifiedStep,true);
  release();
  assert.equal((await awaiting).code,'unsupported_feature');
  const failed=session.refresh();
  assert.equal(failed.providerState,'provider_failed');
  assert.equal(failed.stepAvailability,'last_good');
  assert.equal(failed.lastResultKind,'unresolved');
  assert.equal(failed.lastResultCode,'unsupported_feature');
  assert.match(failed.lastResultReason,/additional authored body/);
  assert.deepEqual([...session.currentStep().bytes],[1,2,3],
    'same canonical archive retains previously verified bytes after refusal');
  const originalArchive=session.save();
  const timedOut=await session.evaluate({requestId:'diagnostic.timeout',deadlineMs:75});
  assert.equal(timedOut.code,'timeout');
  assert.equal(session.refresh().lastResultCode,'timeout');
  assert.equal(session.refresh().stepAvailability,'last_good');
  session.applyEdit(h=>runtime.commit(h,[{
    eventId:'diagnostic.edit',type:'feature.edit',featureId:'plate',
    patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}},
  }]));
  const revised=session.refresh();
  assert.equal(revised.providerState,'idle');
  assert.equal(revised.stepAvailability,'unavailable');
  assert.equal(revised.hasVerifiedStep,false);
  assert.equal(revised.lastResultCode,null);
  assert.equal(revised.lastResultReason,null);
  assert.equal(session.currentStep(),null);
  assert.equal((await session.evaluate({requestId:'diagnostic.revised'})).kind,
    'experimental_plate_evaluated');
  assert.equal(session.refresh().stepAvailability,'current');
  history=runtime.undo(history,['diagnostic.undo']);
  assert.equal(session.refresh().stepAvailability,'unavailable',
    'undo of a source revision immediately revokes native bytes');
  assert.equal(session.currentStep(),null);
  const reopened=session.reopen(originalArchive,{confirmReplacement:true});
  assert.equal(reopened.kind,'opened');
  assert.equal(session.refresh().providerState,'idle');
  assert.equal(session.refresh().stepAvailability,'unavailable',
    'reopening a prior archive cannot resurrect an old native receipt');
});

test('malformed native reply is a terminal visible provider failure',async()=>{
  let history=initialProject();
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:next=>{history=next;},
    evaluateImpl:async()=>({kind:'experimental_plate_evaluated',
      exactAuthority:true,independentInteroperability:true})});
  const result=await session.evaluate({requestId:'diagnostic.malformed'});
  assert.equal(result.code,'invalid_provider_result');
  const state=session.refresh();
  assert.equal(state.providerState,'provider_failed');
  assert.equal(state.stepAvailability,'unavailable');
  assert.equal(state.lastResultCode,'invalid_provider_result');
  assert.match(state.lastResultReason,/qualified experimental contract/);
});
