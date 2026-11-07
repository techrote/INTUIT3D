/**
 * Real INTENT/SKETCH + real localhost bridge + SYNTHETIC native provider.
 * Verifies atomic source persistence, replay, revision-scoped STEP and refusal;
 * does NOT qualify OCCT B-rep or physical STEP geometry.
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
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';
import {createPersistentHistorySource} from '../persistent-history-source.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
function seed(){
  let h=transactions.startUndoHistory(model.newProject('runtime.persisted.plate'));
  return runtime.commit(h,[
    create('seed.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('seed.extrude',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('seed.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
function fakeStorage(){
  const map=new Map();let rejectWrite=false;
  return {
    getItem:k=>map.get(k)??null,
    setItem(k,v){if(rejectWrite)throw new Error('synthetic quota failure');map.set(k,v);},
    failWrites:v=>{rejectWrite=v;},
    removeItem:k=>map.delete(k),
  };
}
async function syntheticProvider(request,options){
  // Different physical design requests produce different bytes. This is an
  // explicit test double, not a real STEP or geometric readback.
  const bytes=Buffer.from('SYNTHETIC_STEP_NOT_NATIVE:'+JSON.stringify(request.plate));
  if(request.exportStep) await writeFile(options.stepOutput,bytes,{flag:'wx'});
  return {kind:'experimental_report',requestId:request.requestId,
    featureId:request.featureId,revision:request.revision,
    backend:plateContract.EXPERIMENTAL_BACKEND,
    occtVersion:plateContract.EXPERIMENTAL_OCCT_VERSION,
    exactAuthority:false,independentInteroperability:false,
    artifact:request.exportStep?{path:options.stepOutput,bytes:bytes.length,
      sha256:createHash('sha256').update(bytes).digest('hex'),
      verification:'same_engine_step_readback'}:null,
    observed:{source:{valid:true}}};
}

test('durable real journal: native response at 8/12, undo, reopen and verified latest-only bytes',async()=>{
  const storage=fakeStorage();
  const first=createPersistentHistorySource({runtime,storage,initialHistory:seed()});
  const original=first.save();
  const session=createLivePlateSession({runtime,...first});
  const host=await startLocalPlateBridge({
    runtime,model,plateContract,runExperimentalPlate:syntheticProvider,
  });
  const opts=id=>({url:host.url,token:host.token,requestId:id,exportStep:true});
  try {
    const eight=await session.evaluate(opts('durable.8'));
    assert.equal(eight.kind,'experimental_plate_evaluated',JSON.stringify(eight));
    assert.equal(eight.result.intendedPlate.thickness,8);
    assert.equal(eight.exactAuthority,false);
    const digest8=eight.step.sha256;
    const twelve=await session.applyEditAndEvaluate(h=>{
      const feature=model.featuresOf(h.document).find(x=>x.id==='plate');
      return runtime.commit(h,[{eventId:'durable.thickness.12',
        type:'feature.edit',featureId:'plate',
        patch:{payload:{...feature.payload,thicknessMm:12}}}],h.document.revision);
    },opts('durable.12'));
    assert.equal(twelve.kind,'submitted',JSON.stringify(twelve));
    assert.equal(twelve.evaluation.kind,'experimental_plate_evaluated');
    assert.equal(twelve.evaluation.result.intendedPlate.thickness,12);
    const digest12=twelve.evaluation.step.sha256;
    assert.notEqual(digest12,digest8);
    assert.equal(session.currentStep()?.sha256,digest12);
    const saved12=first.save();
    assert.notEqual(saved12,original);
    assert.equal(saved12,session.save());

    // Separate session simulates reload: the stored archive is the only truth,
    // and native receipts must NOT be revived from the previous process.
    const reopenedSource=createPersistentHistorySource({runtime,storage});
    const reloaded=createLivePlateSession({runtime,...reopenedSource});
    assert.equal(reloaded.save(),saved12);
    assert.equal(reloaded.currentStep(),null);
    assert.equal(runtime.inspect(reopenedSource.readCurrentHistory()).features
      .find(x=>x.featureId==='plate').thicknessMm,12);
    const undone=await reloaded.applyEditAndEvaluate(
      h=>runtime.undo(h,['durable.undo.12'],h.document.revision),opts('durable.undo'));
    assert.equal(undone.kind,'submitted');
    assert.equal(undone.evaluation.kind,'experimental_plate_evaluated');
    assert.equal(undone.evaluation.result.intendedPlate.thickness,8);
    assert.equal(undone.evaluation.step.sha256,digest8);
    assert.equal(reloaded.currentStep()?.sha256,digest8);
    assert.notEqual(reloaded.save(),saved12);

    // An actual synchronous persistence failure prevents publication.
    storage.failWrites(true);
    const before=reloaded.save();
    assert.throws(()=>reloaded.applyEdit(h=>runtime.commit(h,[{
      eventId:'durable.would.fail',type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:10}},
    }],h.document.revision)),/quota failure/);
    assert.equal(reloaded.save(),before);
    assert.equal(reloaded.currentStep()?.sha256,digest8);
    storage.failWrites(false);

    const restored=await reloaded.reopenAndEvaluate(saved12,{
      ...opts('durable.reopen'),confirmReplacement:true,
    });
    assert.equal(restored.kind,'submitted');
    assert.equal(restored.evaluation.kind,'experimental_plate_evaluated');
    assert.equal(restored.evaluation.result.intendedPlate.thickness,12);
    assert.equal(restored.evaluation.step.sha256,digest12);
    assert.equal(reloaded.save(),saved12);
    assert.equal(reloaded.currentStep()?.sha256,digest12);
    assert.equal(restored.evaluation.independentInteroperability,false);
  } finally {session.cancel();await host.close();}
});

test('corruption, mutation and unexpected replacement fail closed without a shadow model',()=>{
  const storage=fakeStorage();
  const source=createPersistentHistorySource({runtime,storage,initialHistory:seed()});
  const initial=source.save();
  const first=source.readCurrentHistory();
  // Editing the returned in-memory object does not change the stored history.
  first.document.projectId='tampered.in.memory';
  assert.equal(source.save(),initial);
  assert.equal(source.readCurrentHistory().document.projectId,'runtime.persisted.plate');
  const other=runtime.commit(source.readCurrentHistory(),[
    {eventId:'other.change',type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:9}}},
  ]);
  storage.setItem(source.key,runtime.save(other));
  assert.throws(()=>source.publishHistory(other),/changed since authoritative read/);
  // A fresh read adopts a valid externally saved document, without falsely
  // retaining any previous native receipt or old revision.
  assert.equal(source.readCurrentHistory().document.revision,other.document.revision);
  storage.setItem(source.key,'{broken:archive}');
  assert.throws(()=>source.readCurrentHistory(),/archive failed authoritative admission/);
  assert.throws(()=>createPersistentHistorySource({runtime,storage,initialHistory:seed()}),
    /archive failed authoritative admission/);
  assert.equal(storage.getItem(source.key),'{broken:archive}');
  storage.removeItem(source.key);
  assert.throws(()=>source.readCurrentHistory(),/disappeared/);
});
