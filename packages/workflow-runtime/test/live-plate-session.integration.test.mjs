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
