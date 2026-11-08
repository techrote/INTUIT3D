import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject, parseProject, ProjectFormatError,
  ProjectRevisionError, serializeProject,
} from '../src/index.ts';
import {
  startUndoHistory, serializeUndoHistory, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import { createModelArchive, deserializeModelArchive, serializeModelArchive } from '../src/archive.ts';
import {
  FEATURE_LIFECYCLE_FORMAT, inspectFeatureRemoval, previewFeatureRemoval,
} from '../src/feature-lifecycle.ts';
import {
  FEATURE_RECOVERY_CLOSURE_FORMAT, inspectFeatureRecoveryClosure,
  previewFeatureRecoveryClosure, commitUndoableFeatureRecoveryClosure,
} from '../src/feature-recovery-closure.ts';

const create = (id,kind,dependsOn=[],writeTargets=[],payload={}) => ({
  eventId:'event.create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
function part() {
  let doc=newProject('project.recovery.drive.bracket');
  const add=(id,kind,deps,targets,payload={})=>{
    doc=commitEvent(doc,create(id,kind,deps,targets,payload));
  };
  add('sketch.frame','sketch',[],['profile.frame'],{widthMm:110,heightMm:55});
  add('extrude.frame','extrude',['sketch.frame'],['body.frame'],{thicknessMm:12});
  add('cut.frame','cut',['extrude.frame'],['body.frame'],{diameterMm:6});
  add('sketch.datum','sketch',[],['profile.datum'],{widthMm:45,heightMm:30});
  add('extrude.datum','extrude',['sketch.datum'],['body.datum'],{thicknessMm:7});
  add('cut.datum','cut',['extrude.datum'],['body.datum'],{diameterMm:5});
  add('sketch.gauge','sketch',[],['profile.gauge'],{widthMm:20,heightMm:10});
  add('extrude.gauge','extrude',['sketch.gauge'],['body.gauge'],{thicknessMm:3});
  add('cut.frame.guide','cut',['cut.frame','cut.datum'],['body.frame'],{
    reference:{sourceBodyId:'body.datum',sourceWriterId:'cut.datum',
      anchor:{featureId:'cut.datum',roleId:'edge.datum.outer',kind:'edge'}},
    depthMm:5,
  });
  assert.ok(planProject(doc).features.every(row=>row.status==='ready'));
  return doc;
}
const inspectRequest=(doc, selectedFeatureIds=['cut.frame.guide'])=>({
  format:FEATURE_RECOVERY_CLOSURE_FORMAT,version:1,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  expectedDocumentFence:serializeProject(doc),selectedFeatureIds,
});
const commitRequest=(doc,selectedFeatureIds,eventIds,more={})=>({
  ...inspectRequest(doc,selectedFeatureIds),
  eventIds,admission:'require_ready',confirmAncestorRestore:true,
  confirmUnresolved:false,...more,
});
function cascade(doc,id) {
  const impact=inspectFeatureRemoval(doc,id);
  return previewFeatureRemoval(doc,{
    format:FEATURE_LIFECYCLE_FORMAT,version:1,action:'remove',
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    featureId:id,mode:'cascade_descendants',confirmCascade:true,
    eventIds:impact.cascadeIds.map((_,i)=>'event.cascade.'+i),
  }).document;
}

test('recovers exactly the missing cross-body datum ancestors, not all visible timeline rows',()=>{
  const original=part();
  const removed=cascade(original,'extrude.datum');
  const inspection=inspectFeatureRecoveryClosure(removed,inspectRequest(removed));
  assert.deepEqual(inspection.requiredFeatureIds,
    ['extrude.datum','cut.datum','cut.frame.guide']);
  assert.deepEqual(inspection.additionalAncestorIds,['extrude.datum','cut.datum']);
  assert.deepEqual(inspection.missingDependencyIds,[]);
  assert.equal(inspection.canRequireReady,true);
  assert.equal(inspection.exactGeometryAuthority,false);
  assert.throws(()=>previewFeatureRecoveryClosure(removed,commitRequest(removed,
    ['cut.frame.guide'],['restore.extrude','restore.cut','restore.guide'],
    {confirmAncestorRestore:false})),ProjectFormatError);
  const preview=previewFeatureRecoveryClosure(removed,commitRequest(removed,
    ['cut.frame.guide'],['restore.extrude','restore.cut','restore.guide']));
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(preview.lifecycle.exactGeometryAuthority,false);
  assert.deepEqual(preview.lifecycle.events.map(e=>e.featureId),
    inspection.requiredFeatureIds);
  assert.ok(preview.lifecycle.plan.features.every(row=>row.status==='ready'));
  assert.ok(preview.lifecycle.invalidation.readyToEvaluate.includes('cut.frame.guide'));
  assert.ok(!preview.lifecycle.invalidation.readyToEvaluate.includes('extrude.gauge'));
  assert.deepEqual(featuresOf(preview.lifecycle.document).find(f=>f.id==='cut.frame.guide')
    .payload,featuresOf(original).find(f=>f.id==='cut.frame.guide').payload);
});

test('one undo frame and archive reopen preserve author identities and unrelated body',()=>{
  const original=part(), removed=cascade(original,'extrude.datum');
  let history=startUndoHistory(removed);
  history=commitUndoableFeatureRecoveryClosure(history,commitRequest(removed,
    ['cut.frame.guide'],['restore.extrude','restore.cut','restore.guide']));
  assert.equal(history.undoStack.length,1);
  assert.deepEqual(planProject(history.document).executableOrder,
    planProject(original).executableOrder);
  const recovered=history.document;
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['undo.guide','undo.cut','undo.extrude']);
  assert.deepEqual(featuresOf(history.document).map(f=>f.id),
    featuresOf(removed).map(f=>f.id));
  history=redoTransaction(history,['redo.extrude','redo.cut','redo.guide']);
  assert.deepEqual(featuresOf(history.document).map(f=>f.id),
    featuresOf(recovered).map(f=>f.id));
  assert.equal(history.redoStack.length,0);
});

test('revision and full-journal fences reject concurrent divergent branches at equal revision',()=>{
  const initial=part(), removed=cascade(initial,'extrude.datum');
  const request=inspectRequest(removed);
  // Same project and revision, different valid journal event ID. A scalar
  // revision-only guard would accept this divergent authoring branch.
  const divergent=JSON.parse(serializeProject(removed));
  divergent.journal[divergent.journal.length-1].eventId='event.concurrent.cascade';
  const alternate=parseProject(divergent);
  assert.equal(alternate.revision,removed.revision);
  assert.notEqual(serializeProject(alternate),serializeProject(removed));
  assert.throws(()=>inspectFeatureRecoveryClosure(alternate,request),ProjectRevisionError);
  assert.throws(()=>inspectFeatureRecoveryClosure(removed,{
    ...request,expectedRevision:removed.revision-1,
  }),ProjectRevisionError);
  assert.throws(()=>inspectFeatureRecoveryClosure(removed,{
    ...request,expectedProjectId:'project.foreign',
  }),ProjectRevisionError);
  assert.equal(serializeProject(removed),request.expectedDocumentFence);
});

test('an existing ready parallel body writer is never sacrificed by restoration',()=>{
  let doc=newProject('project.conflicting.writer');
  doc=commitEvent(doc,create('sketch.base','sketch',[],['profile.base']));
  doc=commitEvent(doc,create('extrude.base','extrude',['sketch.base'],['body.base']));
  doc=commitEvent(doc,create('cut.removed','cut',['extrude.base'],['body.base']));
  doc=commitEvent(doc,{eventId:'event.remove.old',type:'feature.remove',
    featureId:'cut.removed'});
  doc=commitEvent(doc,create('cut.parallel','cut',['extrude.base'],['body.base']));
  assert.equal(planProject(doc).features.find(x=>x.feature.id==='cut.parallel').status,'ready');
  const inspection=inspectFeatureRecoveryClosure(doc,inspectRequest(doc,['cut.removed']));
  assert.ok(inspection.regressedReadyFeatureIds.includes('cut.parallel'));
  assert.equal(inspection.canRequireReady,false);
  const request=commitRequest(doc,['cut.removed'],['event.recover.unsafe'],
    {admission:'permit_unresolved',confirmUnresolved:true});
  assert.throws(()=>previewFeatureRecoveryClosure(doc,request),/regresses existing ready/);
  assert.deepEqual(featuresOf(doc).map(f=>f.id),
    ['sketch.base','extrude.base','cut.parallel']);
});

test('missing never-authored dependencies stay pending and require explicit acknowledgement',()=>{
  let doc=newProject('project.unavailable.datum');
  doc=commitEvent(doc,create('cut.orphan','cut',['datum.never.created'],
    ['body.orphan']));
  doc=commitEvent(doc,{eventId:'event.remove.orphan',type:'feature.remove',
    featureId:'cut.orphan'});
  const inspection=inspectFeatureRecoveryClosure(doc,inspectRequest(doc,['cut.orphan']));
  assert.deepEqual(inspection.missingDependencyIds,['datum.never.created']);
  assert.deepEqual(inspection.unresolved.map(x=>x.status),['pending']);
  const req=commitRequest(doc,['cut.orphan'],['event.restore.orphan']);
  assert.throws(()=>previewFeatureRecoveryClosure(doc,req),/unresolved intent/);
  assert.throws(()=>previewFeatureRecoveryClosure(doc,{
    ...req,admission:'permit_unresolved',
  }),/explicit confirmation/);
  const preview=previewFeatureRecoveryClosure(doc,{
    ...req,admission:'permit_unresolved',confirmUnresolved:true,
  });
  assert.equal(preview.lifecycle.plan.features[0].status,'pending');
  assert.equal(preview.exactGeometryAuthority,false);
});

test('refuses stale, malformed, duplicate, used and mismatched IDs atomically',()=>{
  const removed=cascade(part(),'extrude.datum');
  const before=serializeProject(removed);
  const session=startUndoHistory(removed);
  const saved=serializeUndoHistory(session);
  const req=commitRequest(removed,['cut.frame.guide'],
    ['event.recovery.one','event.recovery.two','event.recovery.three']);
  assert.throws(()=>previewFeatureRecoveryClosure(removed,{
    ...req,eventIds:['event.same','event.same','event.third'],
  }),ProjectFormatError);
  assert.throws(()=>previewFeatureRecoveryClosure(removed,{
    ...req,eventIds:['event.only.one'],
  }),ProjectFormatError);
  assert.throws(()=>previewFeatureRecoveryClosure(removed,{
    ...req,eventIds:['event.create.sketch.frame','event.two','event.three'],
  }),ProjectFormatError);
  assert.throws(()=>previewFeatureRecoveryClosure(removed,{
    ...req,extraField:true,
  }),ProjectFormatError);
  assert.throws(()=>inspectFeatureRecoveryClosure(removed,
    inspectRequest(removed,['cut.frame'])),/not a tombstone/);
  assert.throws(()=>commitUndoableFeatureRecoveryClosure(session,{
    ...req,expectedDocumentFence:'diverged',
  }),ProjectRevisionError);
  assert.equal(serializeProject(removed),before);
  assert.equal(serializeUndoHistory(session),saved);
});

test('caps ancestor closure at 64 restoration commands rather than silently truncating',()=>{
  let doc=newProject('project.deep.recovery');
  for(let i=0;i<65;i++) doc=commitEvent(doc,create('chain.'+i,'cut',
    i===0?[]:['chain.'+(i-1)],['body.'+i]));
  for(let i=64;i>=0;i--) doc=commitEvent(doc,{
    eventId:'event.remove.chain.'+i,type:'feature.remove',featureId:'chain.'+i,
  });
  assert.throws(()=>inspectFeatureRecoveryClosure(doc,
    inspectRequest(doc,['chain.64'])),/exceeds atomic journal capacity/);
});

test('real SKETCH / FEATUREOPS / RUNTIME mechanical recovery example runs',async()=>{
  const { runRecoveryClevis }=await import('../examples/recover-linked-clevis.mjs');
  const result=runRecoveryClevis();
  assert.equal(result.recoveredReady,true);
  assert.equal(result.exactGeometryAuthority,false);
  assert.equal(result.archiveUndoRedo,true);
});
