import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createDimensionedLPlateSketch} from '@intuit3d/sketch/selected-profile/v1';
import {createWorkflowRuntime} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';
import {createPersistentHistorySource} from '../persistent-history-source.mjs';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const storage=()=>({
  values:new Map(),
  getItem(key){return this.values.get(key)??null;},
  setItem(key,value){this.values.set(key,value);},
});
const create=(id,kind,dependsOn,writeTargets,payload)=>({
  eventId:'seed.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
function initial(){
  const makeSketch=()=>({sketch:createDimensionedLPlateSketch()});
  return runtime.commit(transactions.startUndoHistory(model.newProject('runtime.lifecycle.clevis')),[
    create('sketch.frame','sketch',[],[],makeSketch()),
    create('extrude.frame','extrude',['sketch.frame'],['body.frame'],
      {sourceSketchId:'sketch.frame',thicknessMm:8}),
    create('cut.frame','cut',['extrude.frame'],['body.frame'],
      {sourceSketchId:'sketch.frame',targetBodyId:'body.frame'}),
    create('sketch.datum','sketch',[],[],makeSketch()),
    create('extrude.datum','extrude',['sketch.datum'],['body.datum'],
      {sourceSketchId:'sketch.datum',thicknessMm:12}),
    create('cut.datum','cut',['extrude.datum'],['body.datum'],
      {sourceSketchId:'sketch.datum',targetBodyId:'body.datum'}),
    create('cut.frame.guide','cut',['cut.frame','cut.datum'],['body.frame'],{
      sourceSketchId:'sketch.datum',targetBodyId:'body.frame',
      reference:{sourceBodyId:'body.datum',sourceWriterId:'cut.datum',
        anchor:{featureId:'cut.datum',roleId:'edge.datum.outer',kind:'edge'}},
    }),
  ]);
}
function select(session,kind,extras={}){
  const {projectId,revision}=session.refresh();
  return kind==='removal'
    ?session.inspectFeatureRemoval({projectId,expectedRevision:revision,
      featureId:'extrude.datum',...extras})
    :session.inspectFeatureRecovery({projectId,expectedRevision:revision,
      selectedFeatureIds:['cut.frame.guide'],...extras});
}
function removeCommand(inspection,more={}){
  return {kind:'model.feature.remove',
    request:{format:'intuit3d.feature-lifecycle',version:1,action:'remove',
      featureId:'extrude.datum',mode:'cascade_descendants',confirmCascade:true,
      eventIds:['remove.guide','remove.cut','remove.extrude'],
      sourceDocumentFence:inspection.sourceDocumentFence,...more}};
}
function recoverCommand(inspection,more={}){
  return {kind:'model.feature.recover-closure',
    request:{format:'intuit3d.feature-recovery-closure',version:1,
      expectedDocumentFence:inspection.sourceDocumentFence,
      selectedFeatureIds:['cut.frame.guide'],
      eventIds:['recover.extrude','recover.cut','recover.guide'],
      admission:'require_ready',confirmAncestorRestore:true,
      confirmUnresolved:false,...more}};
}
function submit(session,command){
  const {projectId,revision}=session.refresh();
  return session.applyCommand({...command,projectId,expectedRevision:revision});
}
function active(session){
  return model.featuresOf(runtime.reopen(session.save()).document).map(f=>f.id);
}

test('cross-body cut deletion and explicit transitive recovery are durable, atomic, undoable',()=>{
  const store=storage();
  const persisted=createPersistentHistorySource({runtime,storage:store,initialHistory:initial()});
  const session=createLivePlateSession({runtime,...persisted});
  const original=session.save();
  const impact=select(session,'removal');
  assert.equal(impact.kind,'ready',JSON.stringify(impact));
  assert.equal(impact.exactAuthority,false);
  assert.deepEqual(impact.impact.cascadeIds,
    ['extrude.datum','cut.datum','cut.frame.guide']);

  // No implicit deletion of linked cut or its source is permitted.
  const denied=submit(session,removeCommand(impact,{
    mode:'reject_if_referenced',confirmCascade:false,eventIds:['remove.denied'],
  }));
  assert.equal(denied.kind,'refused',JSON.stringify(denied));
  assert.equal(denied.code,'feature_removal_refused');
  assert.equal(session.save(),original);

  const deleted=submit(session,removeCommand(impact));
  assert.equal(deleted.kind,'committed',JSON.stringify(deleted));
  assert.equal(deleted.report.exactGeometryAvailable,false);
  const removedArchive=session.save();
  assert.notEqual(removedArchive,original);
  assert.ok(!active(session).includes('cut.frame.guide'));
  assert.ok(active(session).includes('cut.frame'));
  assert.equal(session.currentStep(),null);

  const inspection=select(session,'recovery');
  assert.equal(inspection.kind,'ready',JSON.stringify(inspection));
  assert.deepEqual(inspection.inspection.requiredFeatureIds,
    ['extrude.datum','cut.datum','cut.frame.guide']);
  assert.deepEqual(inspection.inspection.additionalAncestorIds,
    ['extrude.datum','cut.datum']);
  assert.equal(inspection.inspection.canRequireReady,true);
  assert.equal(inspection.exactAuthority,false);

  const noConsent=submit(session,recoverCommand(inspection,{
    confirmAncestorRestore:false,
  }));
  assert.equal(noConsent.kind,'refused');
  assert.equal(noConsent.code,'feature_recovery_refused');
  assert.equal(session.save(),removedArchive);

  const restored=submit(session,recoverCommand(inspection));
  assert.equal(restored.kind,'committed',JSON.stringify(restored));
  assert.equal(restored.report.exactGeometryAvailable,false);
  assert.ok(restored.invalidation.invalidatedFeatureIds.includes('cut.frame.guide'));
  assert.ok(active(session).includes('cut.frame.guide'));
  const recoveredArchive=session.save();
  assert.notEqual(recoveredArchive,removedArchive);

  // A new browser process reads the same canonical archive, with no shadow journal.
  const reopened=createLivePlateSession({runtime,
    ...createPersistentHistorySource({runtime,storage:store})});
  assert.equal(reopened.save(),recoveredArchive);
  assert.equal(reopened.currentStep(),null);
  assert.equal(submit(reopened,{kind:'model.undo',
    eventIds:['undo.recover.extrude','undo.recover.cut','undo.recover.guide']}).kind,'committed');
  assert.ok(!active(reopened).includes('cut.frame.guide'));
  assert.equal(submit(reopened,{kind:'model.redo',
    eventIds:['redo.recover.extrude','redo.recover.cut','redo.recover.guide']}).kind,'committed');
  assert.deepEqual(active(reopened),active(session));
  assert.equal(reopened.currentStep(),null);
  session.cancel();reopened.cancel();
});

test('stale, unacknowledged and same-revision divergent recovery cannot publish or dispatch',async()=>{
  let current=initial(),publications=0,nativeCalls=0;
  const session=createLivePlateSession({
    runtime,readCurrentHistory:()=>current,
    publishHistory:next=>{current=next;publications++;},
    evaluateImpl:async()=>{nativeCalls++;throw new Error('refusal dispatched native');},
  });
  const first=select(session,'removal');
  assert.equal(submit(session,removeCommand(first)).kind,'committed');
  assert.equal(publications,1);
  const afterRemoval=session.save();
  const inspection=select(session,'recovery');
  assert.equal(inspection.kind,'ready');
  assert.equal(select(session,'recovery',{
    expectedRevision:current.document.revision-1,
  }).code,'stale_command');
  assert.equal(select(session,'recovery',{
    selectedFeatureIds:['cut.frame'],
  }).code,'feature_recovery_refused');
  const mismatch=await session.applyCommandAndEvaluate({
    ...recoverCommand(inspection,{eventIds:['recovery.one']}),
    projectId:current.document.projectId,
    expectedRevision:current.document.revision,
  });
  assert.equal(mismatch.kind,'refused');
  assert.equal(mismatch.evaluation,null);
  assert.equal(mismatch.edit.code,'feature_recovery_refused');
  assert.equal(session.save(),afterRemoval);
  assert.equal(publications,1);
  assert.equal(nativeCalls,0);

  // A competing same-revision branch with a different valid journal is NOT
  // admitted merely because its project ID and scalar revision still match.
  const edited=structuredClone(current.document);
  edited.journal[edited.journal.length-1].eventId='external.divergent.remove';
  const alternate=model.parseProject(edited);
  assert.equal(alternate.revision,current.document.revision);
  current=transactions.startUndoHistory(alternate);
  const sameRevision=await session.applyCommandAndEvaluate({
    ...recoverCommand(inspection),projectId:current.document.projectId,
    expectedRevision:current.document.revision,
  });
  assert.equal(sameRevision.kind,'refused');
  assert.equal(sameRevision.edit.code,'stale_source');
  assert.equal(sameRevision.evaluation,null);
  assert.equal(publications,1);
  assert.equal(nativeCalls,0);
  assert.equal(session.currentStep(),null);
  session.cancel();
});

test('one atomic authoring batch can stage removal and never leak it after later refusal',()=>{
  let current=initial(),writes=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,
    publishHistory:next=>{current=next;writes++;},
  });
  const original=session.save(),inspection=select(session,'removal');
  const {projectId,revision}=session.refresh();
  const outcome=session.applyCommands({
    kind:'commands.batch',projectId,expectedRevision:revision,commands:[
      removeCommand(inspection),
      {kind:'model.feature.recover-closure',request:{
        format:'intuit3d.feature-recovery-closure',version:1,
        expectedDocumentFence:'stale-source',
        selectedFeatureIds:['cut.frame.guide'],
        eventIds:['batch.recover.extrude','batch.recover.cut','batch.recover.guide'],
        admission:'require_ready',confirmAncestorRestore:true,confirmUnresolved:false,
      }},
    ],
  });
  assert.equal(outcome.kind,'refused');
  assert.equal(outcome.commandIndex,1);
  assert.equal(outcome.code,'stale_source');
  assert.equal(writes,0);
  assert.equal(session.save(),original);
  assert.equal(session.currentStep(),null);
  session.cancel();
});
