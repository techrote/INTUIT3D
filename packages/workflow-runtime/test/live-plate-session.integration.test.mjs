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
  const receipt=options=>({kind:'experimental_plate_evaluated',
    exactAuthority:false,independentInteroperability:false,
    source:{projectId:history.document.projectId,revision:history.document.revision},
    result:{requestId:options.requestId,cutFeatureId:options.cutFeatureId},
    step:{filename:'synthetic.step',bytes:new Uint8Array([calls]),sha256:'synthetic.'+calls}});
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:h=>{history=h;},
    evaluateImpl:async options=>{
      calls++;
      if(calls===2) await hung; // Deliberately ignores AbortSignal.
      return receipt(options);
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
