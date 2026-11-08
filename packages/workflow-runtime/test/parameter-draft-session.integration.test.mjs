/**
 * Executable INTENT/SKETCH + durable RUNTIME parameter-sheet conflict recovery.
 * Authenticated localhost transport uses a SYNTHETIC provider. A test receipt
 * proves revision fencing, never real OCCT 8.0.1 C++ or independent STEP.
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
import * as table from '@intuit3d/model/parameter-formula-table';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {createWorkflowRuntime} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';
import {createPersistentHistorySource} from '../persistent-history-source.mjs';
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const scalar=value=>({op:'literal',unit:'mm',value});
const ref=featureId=>({op:'ref',featureId});
function initialHistory(projectId='runtime.parameter.conflicts'){
  let h=transactions.startUndoHistory(model.newProject(projectId));
  return runtime.commit(h,[
    create('seed.thickness',{id:'p.thickness',kind:'parameter',dependsOn:[],
      writeTargets:[],payload:{parameter:{name:'thickness',unit:'mm',expression:scalar(8)}}}),
    create('seed.offset',{id:'p.offset',kind:'parameter',dependsOn:[],
      writeTargets:[],payload:{parameter:{name:'offset',unit:'mm',expression:scalar(16)}}}),
    create('seed.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('seed.plate',{id:'plate',kind:'extrude',
      dependsOn:['sketch.plate','p.thickness'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8,
        dimensionBindings:{format:'intuit3d.dimension-bindings',version:1,
          entries:[{field:'thicknessMm',unit:'mm',expression:ref('p.thickness')}]}}}),
    create('seed.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',
        targetBodyId:'body.plate'}}),
  ]);
}
const store=()=>{
  const map=new Map();let writes=0,fail=false;
  return {getItem:key=>map.get(key)??null,
    setItem(key,value){if(fail)throw Error('simulated durable write failure');
      map.set(key,value);writes++;},
    get writes(){return writes;},failWrites(v){fail=v;}};
};
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
function edit(h,eventId,featureId,formula){
  return {format:table.PARAMETER_FORMULA_TABLE_FORMAT,version:1,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    admission:'require_admissible',rows:[{eventId,featureId,formula}]};
}
const ack={code:'referenced_parameter_changed',
  featureId:'p.thickness',relatedId:'p.offset'};
function consent(base,current,approvals=[]){
  return {format:'intuit3d.parameter-sheet-resolution',version:1,
    expectedProjectId:base.document.projectId,
    expectedBaseRevision:base.document.revision,
    expectedCurrentRevision:current.document.revision,
    approvals,eventReplacements:[]};
}
const value=(history,id)=>model.featuresOf(history.document)
  .find(f=>f.id===id)?.payload.parameter?.expression;

test('stale unsaved sheet draft remains editable, then reviewed intent rebuilds dependent plate and survives undo/reopen',async()=>{
  const storage=store();
  const source=createPersistentHistorySource({runtime,storage,
    initialHistory:initialHistory()});
  const session=createLivePlateSession({runtime,...source});
  let calls=0;
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:(request,options)=>{calls++;return syntheticProvider(request,options);}});
  const options=requestId=>({url:host.url,token:host.token,requestId,exportStep:true});
  try{
    const base=runtime.reopen(session.save());
    const baseArchive=session.save();
    const draft=edit(base,'draft.thickness','p.thickness','offset - 4 mm');
    const external=session.applyEdit(h=>table.commitUndoableParameterFormulaTableEdit(
      h,edit(h,'later.offset','p.offset','22')));
    assert.equal(external.kind,'committed');
    assert.equal(storage.writes,2);
    const conflict=session.inspectParameterDraft({baseArchive,draft});
    assert.equal(conflict.status,'conflicted');
    assert.deepEqual(conflict.conflicts.map(c=>[c.code,c.featureId,c.relatedId]),
      [['referenced_parameter_changed','p.thickness','p.offset']]);
    const fresh=runtime.reopen(session.save());
    const receipt=await session.evaluate(options('sheet.conflict.current'));
    assert.equal(receipt.kind,'experimental_plate_evaluated',JSON.stringify(receipt));
    assert.equal(receipt.result.intendedPlate.thickness,8);
    const currentDigest=receipt.step.sha256;
    const beforeRefusal=session.save(),beforeCalls=calls;
    const refused=session.applyParameterDraft({baseArchive,draft});
    assert.equal(refused.kind,'refused');
    assert.equal(refused.code,'parameter_sheet_conflict');
    assert.equal(refused.review.status,'conflicted');
    assert.equal(session.save(),beforeRefusal);
    assert.equal(session.currentStep()?.sha256,currentDigest);
    assert.equal(calls,beforeCalls,'conflicted draft cannot dispatch native work');
    const current=runtime.reopen(session.save());
    const approval=consent(base,current,[ack]);
    const reviewed=session.inspectParameterDraft({baseArchive,draft,
      resolution:approval});
    assert.equal(reviewed.status,'ready');
    assert.deepEqual(reviewed.valueComparisons.map(c=>c.currentDraftValue),[18]);
    assert.ok(reviewed.preview.invalidation.invalidatedFeatureIds.includes('plate'));
    const applied=session.applyParameterDraft({baseArchive,draft,resolution:approval});
    assert.equal(applied.kind,'committed',JSON.stringify(applied));
    assert.equal(applied.parameterReview.status,'ready');
    assert.equal(storage.writes,3,'conflict resolution commits ONE durable archive');
    assert.equal(session.currentStep(),null,'old verified STEP revoked after real model edit');
    const after=await session.evaluate(options('sheet.conflict.resolved'));
    assert.equal(after.kind,'experimental_plate_evaluated',JSON.stringify(after));
    assert.equal(after.result.intendedPlate.thickness,18);
    assert.notEqual(after.step.sha256,currentDigest);
    const changedArchive=session.save();
    const restarted=createLivePlateSession({runtime,
      ...createPersistentHistorySource({runtime,storage})});
    try{
      assert.equal(restarted.save(),changedArchive);
      assert.equal(restarted.currentStep(),null,'native bytes are not persisted in the archive');
      const restored=await restarted.evaluate(options('sheet.conflict.reopened'));
      assert.equal(restored.result.intendedPlate.thickness,18);
      assert.equal(restored.step.sha256,after.step.sha256);
      const undone=restarted.applyCommand({kind:'model.undo',
        projectId:restarted.refresh().projectId,
        expectedRevision:restarted.refresh().revision,
        eventIds:['undo.draft.thickness']});
      assert.equal(undone.kind,'committed');
      assert.equal(restarted.currentStep(),null);
      assert.deepEqual(undone.invalidation.invalidatedFeatureIds.includes('plate'),true);
      assert.equal(model.featuresOf(undone.history.document).some(f=>f.id==='plate'),true);
      const undoneReceipt=await restarted.evaluate(options('sheet.conflict.undo'));
      assert.equal(undoneReceipt.result.intendedPlate.thickness,8);
      assert.equal(value(undone.history,'p.offset').value,22,
        'independent concurrent edit must survive undo');
      assert.equal(calls,4);
    }finally{restarted.cancel();}
  }finally{session.cancel();await host.close();}
});

test('approval is never reusable across revisions, unrelated project ancestry or failed storage; verified current receipt survives',async()=>{
  const storage=store();
  const source=createPersistentHistorySource({runtime,storage,
    initialHistory:initialHistory('runtime.sheet.negative')});
  const session=createLivePlateSession({runtime,...source});
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:syntheticProvider});
  try{
    const baseArchive=session.save(),base=runtime.reopen(baseArchive);
    const draft=edit(base,'draft.thickness.negative','p.thickness','offset - 4 mm');
    const changed=session.applyEdit(h=>table.commitUndoableParameterFormulaTableEdit(
      h,edit(h,'later.offset.negative','p.offset','22')));
    assert.equal(changed.kind,'committed');
    const current=runtime.reopen(session.save());
    const receipt=await session.evaluate({url:host.url,token:host.token,
      requestId:'negative.current',exportStep:true});
    const archiveBefore=session.save(),digest=receipt.step.sha256,writes=storage.writes;
    const bad=session.applyParameterDraft({baseArchive,draft,
      resolution:consent(base,current,[{...ack,featureId:'p.offset'}])});
    assert.equal(bad.kind,'refused','unreported approval must not become consent');
    assert.equal(bad.code,'parameter_sheet_conflict');
    assert.equal(session.save(),archiveBefore);
    assert.equal(session.currentStep()?.sha256,digest);
    const stale=session.applyParameterDraft({baseArchive,draft,
      resolution:{...consent(base,current,[ack]),expectedCurrentRevision:current.document.revision-1}});
    assert.equal(stale.kind,'refused');
    assert.equal(stale.code,'stale_parameter_resolution');
    assert.equal(session.save(),archiveBefore);
    assert.throws(()=>session.inspectParameterDraft({
      baseArchive:runtime.save(initialHistory('different.project')),draft}),
      /different project|divergent journal/);
    storage.failWrites(true);
    assert.throws(()=>session.applyParameterDraft({baseArchive,draft,
      resolution:consent(base,current,[ack])}),/simulated durable write failure/);
    storage.failWrites(false);
    assert.equal(storage.writes,writes);
    assert.equal(session.save(),archiveBefore);
    assert.equal(session.currentStep()?.sha256,digest,
      'failed atomic storage write cannot revoke a still-current verified STEP');
  }finally{session.cancel();await host.close();}
});
