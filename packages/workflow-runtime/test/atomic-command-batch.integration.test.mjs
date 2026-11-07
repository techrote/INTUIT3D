/**
 * Actual INTENT/SKETCH journal and authenticated localhost provider transport.
 * The provider is deliberately SYNTHETIC; these tests prove transaction,
 * provenance and native-dispatch fences, NOT physical OCCT or STEP geometry.
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
import {createLivePlateSession} from '../live-plate-session.mjs';
import {createPersistentHistorySource} from '../persistent-history-source.mjs';
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
function initialHistory(){
  const history=transactions.startUndoHistory(model.newProject('runtime.atomic.batch'));
  const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
  return runtime.commit(history,[
    create('batch.seed.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('batch.seed.extrude',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('batch.seed.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
function fakeStorage(){
  const data=new Map();
  let writes=0,fail=false;
  return {
    getItem:key=>data.get(key)??null,
    setItem(key,value){
      if(fail)throw new Error('synthetic persistent storage failure');
      data.set(key,value);writes++;
    },
    get writes(){return writes;},
    failWrites(value){fail=value;},
  };
}
async function syntheticProvider(request,{stepOutput}){
  const bytes=Buffer.from('SYNTHETIC_NOT_STEP:'+JSON.stringify(request.plate));
  if(request.exportStep)await writeFile(stepOutput,bytes,{flag:'wx'});
  return {kind:'experimental_report',requestId:request.requestId,
    featureId:request.featureId,revision:request.revision,
    backend:plateContract.EXPERIMENTAL_BACKEND,
    occtVersion:plateContract.EXPERIMENTAL_OCCT_VERSION,
    exactAuthority:false,independentInteroperability:false,
    artifact:request.exportStep?{path:stepOutput,bytes:bytes.length,
      sha256:createHash('sha256').update(bytes).digest('hex'),
      verification:'same_engine_step_readback'}:null,
    observed:{source:{valid:true}}};
}
function batch(session,commands){
  const {projectId,revision}=session.refresh();
  return {kind:'commands.batch',projectId,expectedRevision:revision,commands};
}
function thickness(eventId,mm){
  return {kind:'model.events',events:[{eventId,type:'feature.edit',
    featureId:'plate',patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:mm}}}]};
}
function addHole(eventId,id,x,y,radius=4){
  return {kind:'sketch.holes',request:{sketchFeatureId:'sketch.plate',eventId,
    operations:[{kind:'add',id,x,y,radius}]}};
}

test('one durable batch publication: actual model/sketch 8→12, hole add, dependent rebuild, two different test artifacts, undo and reopen',async()=>{
  const storage=fakeStorage();
  const source=createPersistentHistorySource({runtime,storage,initialHistory:initialHistory()});
  const session=createLivePlateSession({runtime,...source});
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:syntheticProvider});
  const options=id=>({url:host.url,token:host.token,requestId:id,exportStep:true});
  try {
    const first=await session.evaluate(options('batch.baseline'));
    assert.equal(first.kind,'experimental_plate_evaluated',JSON.stringify(first));
    assert.equal(first.result.intendedPlate.thickness,8);
    assert.equal(first.result.intendedPlate.holes.length,2);
    const before=session.refresh();
    const oldDigest=first.step.sha256;
    const oldArchive=session.save();
    assert.equal(storage.writes,1,'project creation wrote one canonical archive');
    const accepted=session.applyCommands(batch(session,[
      thickness('batch.thickness.12',12),addHole('batch.third.bore','holeC',60,20),
    ]));
    assert.equal(accepted.kind,'committed',JSON.stringify(accepted));
    assert.equal(accepted.report.revision,before.revision+2);
    assert.equal(storage.writes,2,'two model transactions publish ONE durable archive');
    assert.deepEqual(accepted.invalidation.invalidatedFeatureIds,
      ['sketch.plate','plate','cut']);
    assert.equal(session.currentStep(),null,'old revision export is revoked at commit');
    const afterArchive=session.save();
    assert.notEqual(afterArchive,oldArchive);
    const after=await session.evaluate(options('batch.modified'));
    assert.equal(after.kind,'experimental_plate_evaluated',JSON.stringify(after));
    assert.equal(after.result.intendedPlate.thickness,12);
    assert.equal(after.result.intendedPlate.holes.length,3);
    assert.notEqual(after.step.sha256,oldDigest);
    assert.equal(session.currentStep()?.sha256,after.step.sha256);
    assert.equal(storage.writes,2,'native evaluation must not mutate model archive');

    const reopened=createLivePlateSession({runtime,
      ...createPersistentHistorySource({runtime,storage})});
    assert.equal(reopened.save(),afterArchive);
    assert.equal(reopened.currentStep(),null,'reopen never restores cached native bytes');
    const replay=await reopened.evaluate(options('batch.reopened'));
    assert.equal(replay.kind,'experimental_plate_evaluated');
    assert.equal(replay.step.sha256,after.step.sha256);

    // A grouped restore stages two normal INTENT undos; it is intentionally
    // not falsely represented as a single undo entry.
    const undone=reopened.applyCommands(batch(reopened,[
      {kind:'model.undo',eventIds:['batch.undo.hole']},
      {kind:'model.undo',eventIds:['batch.undo.thickness']},
    ]));
    assert.equal(undone.kind,'committed',JSON.stringify(undone));
    assert.equal(reopened.currentStep(),null);
    const restored=await reopened.evaluate(options('batch.undone'));
    assert.equal(restored.result.intendedPlate.thickness,8);
    assert.equal(restored.result.intendedPlate.holes.length,2);
    assert.equal(restored.step.sha256,oldDigest);
    assert.equal(storage.writes,3,'two history undos were durably committed once');
    reopened.cancel();
  } finally {session.cancel();await host.close();}
});

test('stale, malformed, inadmissible and failed-storage batches are all-or-nothing; no native dispatch or stale STEP',async()=>{
  const storage=fakeStorage();
  const source=createPersistentHistorySource({runtime,storage,initialHistory:initialHistory()});
  let calls=0;
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:(request,options)=>{calls++;return syntheticProvider(request,options);}});
  const session=createLivePlateSession({runtime,...source});
  const options=id=>({url:host.url,token:host.token,requestId:id,exportStep:true});
  try {
    const verified=await session.evaluate(options('batch.negative.baseline'));
    assert.equal(verified.kind,'experimental_plate_evaluated');
    assert.equal(calls,1);
    const sha=verified.step.sha256,original=session.save(),writes=storage.writes;
    const denied=await session.applyCommandsAndEvaluate(batch(session,[
      thickness('batch.denied.thickness',10),
      addHole('batch.overlap.refused','hole.overlap',35,40),
    ]),options('batch.negative.never.sent'));
    assert.equal(denied.kind,'refused',JSON.stringify(denied));
    assert.equal(denied.edit.commandIndex,1,'second solver admission caused full rollback');
    assert.equal(denied.edit.code,'inadmissible_sketch');
    assert.equal(denied.evaluation,null);
    assert.equal(storage.writes,writes);
    assert.equal(calls,1);
    assert.equal(session.save(),original);
    assert.equal(session.currentStep()?.sha256,sha);

    const stale=batch(session,[thickness('batch.stale',14)]);
    stale.expectedRevision--;
    const rejected=session.applyCommands(stale);
    assert.equal(rejected.kind,'refused');
    assert.equal(rejected.code,'stale_command');
    assert.equal(session.save(),original);
    assert.throws(()=>session.applyCommands(batch(session,[])),/1–16 operations/);
    assert.throws(()=>session.applyCommands(batch(session,[
      {kind:'model.events',expectedRevision:session.refresh().revision,
        events:[{eventId:'batch.forged',type:'feature.edit',
          featureId:'plate',patch:{payload:{thicknessMm:11}}}]},
    ])),/omit outer fences/);
    assert.equal(session.save(),original);

    storage.failWrites(true);
    assert.throws(()=>session.applyCommands(batch(session,[
      thickness('batch.storage.first',12),
      addHole('batch.storage.second','holeC',60,20),
    ])),/synthetic persistent storage failure/);
    storage.failWrites(false);
    assert.equal(storage.writes,writes);
    assert.equal(session.save(),original);
    assert.equal(session.currentStep()?.sha256,sha,
      'failed durable publication must preserve the still-current verified STEP');
    assert.equal(calls,1);
  } finally {session.cancel();await host.close();}
});
