import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  newProject, commitEvent, featuresOf, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory} from '../src/transactions.ts';
import {createModelArchive, serializeModelArchive,
  deserializeModelArchive} from '../src/archive.ts';
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '../src/body-rebuild-manifest.ts';
import {FEATURE_EDIT_REVERT_FORMAT,previewFeatureEditRevert,
  commitUndoableFeatureEditRevert} from '../src/feature-edit-revert.ts';

function fixture() {
  let doc = newProject('project.motor.saddle.history');
  const records = [
    ['sketch.saddle','sketch',[],['sketch.saddle'],{widthMm:96}],
    ['sketch.gauge','sketch',[],['sketch.gauge'],{widthMm:32}],
    ['extrude.saddle','extrude',['sketch.saddle'],['body.saddle'],{thicknessMm:10}],
    ['cut.saddle','cut',['extrude.saddle','sketch.saddle'],['body.saddle'],
      {targetBodyId:'body.saddle',depthMm:4,throughAll:false}],
    ['extrude.clamp','extrude',['cut.saddle'],['body.clamp'],{thicknessMm:6}],
    ['extrude.gauge','extrude',['sketch.gauge'],['body.gauge'],{thicknessMm:3}],
  ];
  for(const [id,kind,dependsOn,writeTargets,payload] of records){
    doc=commitEvent(doc,{eventId:'create.'+id,type:'feature.create',
      feature:{id,kind,dependsOn,writeTargets,payload}});
  }
  assert.ok(planProject(doc).features.every(row=>row.status==='ready'));
  doc=commitEvent(doc,{eventId:'edit.saddle.thickness',type:'feature.edit',
    featureId:'extrude.saddle',patch:{payload:{thicknessMm:16}}});
  doc=commitEvent(doc,{eventId:'edit.gauge.width',type:'feature.edit',
    featureId:'sketch.gauge',patch:{payload:{widthMm:40}}});
  return doc;
}
function request(doc,override={}){
  return {
    format:FEATURE_EDIT_REVERT_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    targetEventId:'edit.saddle.thickness',eventId:'revert.saddle.thickness',
    admission:'require_ready',confirmUnresolved:false,...override,
  };
}
const find=(doc,id)=>featuresOf(doc).find(f=>f.id===id);

test('revert a past thickness edit without losing a later independent gauge edit',()=>{
  const doc=fixture(),fence=serializeProject(doc);
  const preview=previewFeatureEditRevert(doc,request(doc));
  assert.equal(preview.document.revision,doc.revision+1);
  assert.deepEqual(preview.revertedFields,['payload']);
  assert.deepEqual(preview.invalidatedBodyIds,['body.saddle','body.clamp']);
  assert.deepEqual(preview.invalidation.unchangedReady.includes('extrude.gauge'),true);
  assert.equal(find(preview.document,'extrude.saddle').payload.thicknessMm,10);
  assert.equal(find(preview.document,'sketch.gauge').payload.widthMm,40);
  assert.equal(preview.requiresNativeRebuild,true);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(serializeProject(doc),fence);
  const manifest=planBodyRebuildManifest(doc,preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedFromRevision:doc.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:['body.saddle','body.clamp','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(row=>row.action),
    ['rebuild','rebuild','preserve_candidate']);
});

test('historical selective revert is one undo frame and survives archive/reopen',()=>{
  const doc=fixture();
  let history=commitUndoableFeatureEditRevert(startUndoHistory(doc),request(doc));
  assert.equal(history.undoStack.length,1);
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['undo.revert.saddle']);
  assert.equal(find(history.document,'extrude.saddle').payload.thicknessMm,16);
  assert.equal(find(history.document,'sketch.gauge').payload.widthMm,40);
  history=redoTransaction(history,['redo.revert.saddle']);
  assert.equal(find(history.document,'extrude.saddle').payload.thicknessMm,10);
  assert.equal(find(history.document,'sketch.gauge').payload.widthMm,40);
});

test('stale revision, different project and equal-revision divergent journal reject',()=>{
  const doc=fixture();
  const altered={...doc,journal:doc.journal.map((event)=>
    event.eventId==='edit.gauge.width'?
      {...event,patch:{payload:{widthMm:41}}}:event)};
  for(const change of [
    {expectedRevision:doc.revision-1},
    {expectedProjectId:'project.wrong'},
    {expectedDocumentFence:serializeProject(altered)},
  ]){
    assert.throws(()=>previewFeatureEditRevert(doc,request(doc,change)),
      ProjectRevisionError);
  }
  assert.throws(()=>previewFeatureEditRevert(altered,request(doc)),
    ProjectRevisionError);
});

test('later edit, removal or restoration of selected feature forbids retroactive inverse',()=>{
  const doc=fixture();
  const revisions=[
    commitEvent(doc,{eventId:'later.edit',type:'feature.edit',
      featureId:'extrude.saddle',patch:{payload:{thicknessMm:20}}}),
    commitEvent(doc,{eventId:'later.remove',type:'feature.remove',
      featureId:'extrude.saddle'}),
  ];
  revisions.push(commitEvent(revisions[1],{eventId:'later.restore',
    type:'feature.restore',featureId:'extrude.saddle'}));
  for(const changed of revisions){
    assert.throws(()=>previewFeatureEditRevert(changed,request(changed)),
      ProjectRevisionError);
  }
});

test('bad target, no-op, invalid IDs and extra fields leave original history unchanged',()=>{
  const doc=fixture(),history=startUndoHistory(doc);
  const snapshot=serializeUndoHistory(history);
  const wrong=[
    {targetEventId:'create.extrude.saddle'},
    {targetEventId:'missing.event'},
    {targetEventId:'revert.saddle.thickness'},
    {eventId:'edit.saddle.thickness'},
    {eventId:'1bad'},
    {admission:'unsafe'},
    {confirmUnresolved:'yes'},
    {unknown:true},
  ];
  for(const change of wrong){
    assert.throws(()=>commitUndoableFeatureEditRevert(history,request(doc,change)),
      ProjectFormatError);
  }
  assert.equal(serializeUndoHistory(history),snapshot);
});

test('later display-only timeline moves do not forbid selective semantic rollback',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{eventId:'move.saddle',type:'feature.move',
    featureId:'extrude.saddle',afterFeatureId:'sketch.saddle'});
  const preview=previewFeatureEditRevert(doc,request(doc));
  assert.equal(find(preview.document,'extrude.saddle').payload.thicknessMm,10);
});

test('explicit pending rollback preserves impossible intent; strict and unconfirmed reject',()=>{
  let doc=newProject('project.pending.revert');
  doc=commitEvent(doc,{eventId:'create.sketch.good',type:'feature.create',
    feature:{id:'sketch.good',kind:'sketch',dependsOn:[],
      writeTargets:['sketch.good'],payload:{}}});
  doc=commitEvent(doc,{eventId:'create.extrude.pending',type:'feature.create',
    feature:{id:'extrude.pending',kind:'extrude',dependsOn:['sketch.missing'],
      writeTargets:['body.pending'],payload:{thicknessMm:8}}});
  doc=commitEvent(doc,{eventId:'edit.pending.dep',type:'feature.edit',
    featureId:'extrude.pending',patch:{dependsOn:['sketch.good']}});
  assert.equal(planProject(doc).features.find(x=>x.feature.id==='extrude.pending').status,'ready');
  const base={...request(doc),targetEventId:'edit.pending.dep',
    eventId:'revert.pending.dep'};
  assert.throws(()=>previewFeatureEditRevert(doc,base),ProjectFormatError);
  assert.throws(()=>previewFeatureEditRevert(doc,{
    ...base,admission:'permit_unresolved',confirmUnresolved:false,
  }),ProjectFormatError);
  const preview=previewFeatureEditRevert(doc,{
    ...base,admission:'permit_unresolved',confirmUnresolved:true,
  });
  assert.deepEqual(preview.regressedReadyFeatureIds,['extrude.pending']);
  assert.equal(preview.plan.features.find(x=>x.feature.id==='extrude.pending').status,'pending');
  assert.deepEqual(find(preview.document,'extrude.pending').dependsOn,['sketch.missing']);
  assert.equal(preview.exactGeometryAuthority,false);
});

test('real SKETCH FEATUREOPS RUNTIME modular saddle fixture executes',()=>{
  const path=fileURLToPath(new URL('../examples/selective-motor-saddle-revert.mjs',
    import.meta.url));
  const result=spawnSync(process.execPath,['--experimental-strip-types',path],
    {encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const output=JSON.parse(result.stdout);
  assert.equal(output.format,'intuit3d.feature-edit-revert-demo');
  assert.deepEqual(output.bodyActions,['rebuild','rebuild','preserve_candidate']);
  assert.equal(output.archiveUndoRedo,true);
  assert.equal(output.exactGeometryAuthority,false);
});
