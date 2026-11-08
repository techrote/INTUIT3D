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
  commitUndoableFeatureEditRevert, FEATURE_EDIT_FIELD_REVERT_FORMAT,
  previewFeatureEditFieldRevert, commitUndoableFeatureEditFieldRevert}
  from '../src/feature-edit-revert.ts';

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

test('retargeted historical writer retires the departed body and rebuilds the restored body',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{eventId:'edit.gauge.target',type:'feature.edit',
    featureId:'extrude.gauge',patch:{writeTargets:['body.gauge.temporary']}});
  assert.ok(planProject(doc).features.every(row=>row.status==='ready'));
  const preview=previewFeatureEditRevert(doc,request(doc,{
    targetEventId:'edit.gauge.target',eventId:'revert.gauge.target',
  }));
  assert.deepEqual(preview.revertedFields,['writeTargets']);
  assert.deepEqual(preview.invalidatedBodyIds,
    ['body.gauge.temporary','body.gauge']);
  assert.deepEqual(find(preview.document,'extrude.gauge').writeTargets,['body.gauge']);
  assert.equal(find(preview.document,'sketch.gauge').payload.widthMm,40);
  const rebuildRequest={
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedFromRevision:doc.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:preview.invalidatedBodyIds,
  };
  const manifest=planBodyRebuildManifest(doc,preview.document,rebuildRequest);
  assert.deepEqual(manifest.bodies.map(row=>row.action),['retire','rebuild']);
  assert.throws(()=>planBodyRebuildManifest(doc,preview.document,{
    ...rebuildRequest,bodyIds:['body.gauge'],
  }),ProjectFormatError);
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

test('revert only historical payload while preserving later same-feature datum dependency',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{eventId:'edit.saddle.datum',type:'feature.edit',
    featureId:'extrude.saddle',
    patch:{dependsOn:['sketch.saddle','sketch.gauge']}});
  assert.ok(planProject(doc).features.every(row=>row.status==='ready'));
  const original=serializeProject(doc);
  const preview=previewFeatureEditRevert(doc,request(doc));
  assert.deepEqual(preview.revertedFields,['payload']);
  assert.deepEqual(find(preview.document,'extrude.saddle').dependsOn,
    ['sketch.saddle','sketch.gauge']);
  assert.equal(find(preview.document,'extrude.saddle').payload.thicknessMm,10);
  assert.equal(find(preview.document,'sketch.gauge').payload.widthMm,40);
  assert.deepEqual(preview.invalidatedBodyIds,['body.saddle','body.clamp']);
  const manifest=planBodyRebuildManifest(doc,preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedFromRevision:doc.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:['body.saddle','body.clamp','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(row=>row.action),
    ['rebuild','rebuild','preserve_candidate']);
  assert.equal(serializeProject(doc),original);

  let session=commitUndoableFeatureEditRevert(startUndoHistory(doc),request(doc));
  session=deserializeModelArchive(serializeModelArchive(createModelArchive(session))).history;
  assert.deepEqual(find(session.document,'extrude.saddle').dependsOn,
    ['sketch.saddle','sketch.gauge']);
  session=undoTransaction(session,['undo.saddle.disjoint']);
  assert.equal(find(session.document,'extrude.saddle').payload.thicknessMm,16);
  assert.deepEqual(find(session.document,'extrude.saddle').dependsOn,
    ['sketch.saddle','sketch.gauge']);
  session=redoTransaction(session,['redo.saddle.disjoint']);
  assert.equal(find(session.document,'extrude.saddle').payload.thicknessMm,10);
  assert.deepEqual(find(session.document,'extrude.saddle').dependsOn,
    ['sketch.saddle','sketch.gauge']);
});

test('overlapping payload and kind edits remain blocked even if nested keys differ',()=>{
  let doc=fixture();
  for(const patch of [
    {payload:{thicknessMm:16,label:'new independent-looking nested field'}},
    {kind:'cut'},
  ]){
    const changed=commitEvent(doc,{
      eventId:patch.kind?'later.kind':'later.payload',
      type:'feature.edit',featureId:'extrude.saddle',patch,
    });
    assert.throws(()=>previewFeatureEditRevert(changed,request(changed)),
      ProjectRevisionError);
  }
  // Reversing a multi-field edit must not erase a subsequent edit to just
  // one of the originally edited top-level fields.
  doc=commitEvent(doc,{eventId:'edit.saddle.multi',type:'feature.edit',
    featureId:'extrude.saddle',
    patch:{payload:{thicknessMm:18},dependsOn:['sketch.gauge','sketch.saddle']}});
  doc=commitEvent(doc,{eventId:'edit.saddle.deps.again',type:'feature.edit',
    featureId:'extrude.saddle',patch:{dependsOn:['sketch.saddle']}});
  assert.throws(()=>previewFeatureEditRevert(doc,request(doc,{
    targetEventId:'edit.saddle.multi',eventId:'revert.saddle.multi',
  })),ProjectRevisionError);
});

test('same-feature disjoint rollback still requires exact canonical source identity',()=>{
  const doc=commitEvent(fixture(),{eventId:'later.other.field',type:'feature.edit',
    featureId:'extrude.saddle',patch:{dependsOn:['sketch.saddle','sketch.gauge']}});
  const fork=commitEvent(fixture(),{eventId:'later.other.field',type:'feature.edit',
    featureId:'extrude.saddle',patch:{dependsOn:['sketch.saddle','sketch.gauge'],
      writeTargets:['body.saddle']}});
  assert.equal(doc.revision,fork.revision);
  assert.notEqual(serializeProject(doc),serializeProject(fork));
  assert.throws(()=>previewFeatureEditRevert(fork,request(doc)),
    ProjectRevisionError);
  assert.throws(()=>previewFeatureEditRevert(doc,request(fork)),
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

function fieldRequest(doc, selectedFields, override={}) {
  return {
    format:FEATURE_EDIT_FIELD_REVERT_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    targetEventId:'edit.saddle.compound',eventId:'revert.saddle.fields',
    admission:'require_ready',confirmUnresolved:false,
    selectedFields,...override,
  };
}

test('compound historical edit: keep later same-feature datum, compensate only thickness',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{eventId:'edit.saddle.compound',type:'feature.edit',
    featureId:'extrude.saddle',patch:{
      payload:{thicknessMm:18},dependsOn:['sketch.saddle','sketch.gauge'],
    }});
  doc=commitEvent(doc,{eventId:'edit.saddle.newer.datum',type:'feature.edit',
    featureId:'extrude.saddle',patch:{dependsOn:['sketch.gauge','sketch.saddle']}});
  const initial=serializeProject(doc);
  assert.throws(()=>previewFeatureEditRevert(doc,request(doc,{
    targetEventId:'edit.saddle.compound',eventId:'revert.saddle.legacy',
  })),ProjectRevisionError);
  const selected=fieldRequest(doc,['payload']);
  const preview=previewFeatureEditFieldRevert(doc,selected);
  assert.deepEqual(preview.revertedFields,['payload']);
  assert.equal(find(preview.document,'extrude.saddle').payload.thicknessMm,16);
  assert.deepEqual(find(preview.document,'extrude.saddle').dependsOn,
    ['sketch.gauge','sketch.saddle']);
  assert.equal(find(preview.document,'sketch.gauge').payload.widthMm,40);
  assert.deepEqual(preview.invalidatedBodyIds,['body.saddle','body.clamp']);
  assert.equal(serializeProject(doc),initial);
  const manifest=planBodyRebuildManifest(doc,preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedFromRevision:doc.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:['body.saddle','body.clamp','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(x=>x.action),
    ['rebuild','rebuild','preserve_candidate']);
  let history=commitUndoableFeatureEditFieldRevert(startUndoHistory(doc),selected);
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['undo.saddle.fields']);
  assert.equal(find(history.document,'extrude.saddle').payload.thicknessMm,18);
  history=redoTransaction(history,['redo.saddle.fields']);
  assert.equal(find(history.document,'extrude.saddle').payload.thicknessMm,16);
  assert.deepEqual(find(history.document,'extrude.saddle').dependsOn,
    ['sketch.gauge','sketch.saddle']);
});

test('field-only writer rollback retires departed body and preserves newer payload',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{eventId:'edit.gauge.compound',type:'feature.edit',
    featureId:'extrude.gauge',patch:{
      writeTargets:['body.gauge.temporary'],payload:{thicknessMm:5},
    }});
  doc=commitEvent(doc,{eventId:'edit.gauge.newer.thickness',type:'feature.edit',
    featureId:'extrude.gauge',patch:{payload:{thicknessMm:7}}});
  const selected=fieldRequest(doc,['writeTargets'],{
    targetEventId:'edit.gauge.compound',eventId:'revert.gauge.writer.only',
  });
  const preview=previewFeatureEditFieldRevert(doc,selected);
  assert.deepEqual(find(preview.document,'extrude.gauge').writeTargets,['body.gauge']);
  assert.equal(find(preview.document,'extrude.gauge').payload.thicknessMm,7);
  assert.deepEqual(preview.invalidatedBodyIds,['body.gauge.temporary','body.gauge']);
  const manifest=planBodyRebuildManifest(doc,preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedFromRevision:doc.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:['body.gauge.temporary','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(x=>x.action),['retire','rebuild']);
});

test('field-selective request rejects stale, malformed, absent and kind-split changes',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{eventId:'edit.saddle.compound',type:'feature.edit',
    featureId:'extrude.saddle',patch:{
      payload:{thicknessMm:18},dependsOn:['sketch.saddle','sketch.gauge'],
    }});
  const selected=fieldRequest(doc,['payload']);
  for(const override of [
    {selectedFields:[]},{selectedFields:['payload','payload']},
    {selectedFields:['payload','thicknessMm']},
    {selectedFields:['writeTargets']},{selectedFields:['kind']},
    {eventId:'edit.saddle.compound'},{unknown:true},
  ]) assert.throws(()=>previewFeatureEditFieldRevert(doc,{
    ...selected,...override,
  }),ProjectFormatError);
  const fork={...doc,journal:doc.journal.map(e=>
    e.eventId==='edit.gauge.width'?
      {...e,patch:{payload:{widthMm:41}}}:e)};
  assert.throws(()=>previewFeatureEditFieldRevert(fork,selected),ProjectRevisionError);
  assert.throws(()=>previewFeatureEditFieldRevert(doc,{
    ...selected,expectedRevision:doc.revision-1,
  }),ProjectRevisionError);
  const changed=commitEvent(doc,{eventId:'edit.saddle.kind.change',
    type:'feature.edit',featureId:'extrude.saddle',
    patch:{kind:'cut',payload:{depthMm:2}}});
  assert.throws(()=>previewFeatureEditFieldRevert(changed,
    fieldRequest(changed,['payload'],{
      targetEventId:'edit.saddle.kind.change',eventId:'revert.saddle.split.kind',
    })),ProjectFormatError);
});

test('partial dependency revert requires explicit unresolved-intent permission',()=>{
  let doc=newProject('project.field.pending');
  doc=commitEvent(doc,{eventId:'create.sketch.good',type:'feature.create',
    feature:{id:'sketch.good',kind:'sketch',dependsOn:[],
      writeTargets:['sketch.good'],payload:{}}});
  doc=commitEvent(doc,{eventId:'create.extrude.pending',type:'feature.create',
    feature:{id:'extrude.pending',kind:'extrude',dependsOn:['sketch.missing'],
      writeTargets:['body.pending'],payload:{thicknessMm:4}}});
  doc=commitEvent(doc,{eventId:'edit.pending.compound',type:'feature.edit',
    featureId:'extrude.pending',patch:{
      dependsOn:['sketch.good'],payload:{thicknessMm:8},
    }});
  doc=commitEvent(doc,{eventId:'edit.pending.latest',type:'feature.edit',
    featureId:'extrude.pending',patch:{payload:{thicknessMm:9}}});
  const selected=fieldRequest(doc,['dependsOn'],{
    targetEventId:'edit.pending.compound',eventId:'revert.pending.selected',
  });
  assert.throws(()=>previewFeatureEditFieldRevert(doc,selected),ProjectFormatError);
  assert.throws(()=>previewFeatureEditFieldRevert(doc,{
    ...selected,admission:'permit_unresolved',
  }),ProjectFormatError);
  const preview=previewFeatureEditFieldRevert(doc,{
    ...selected,admission:'permit_unresolved',confirmUnresolved:true,
  });
  assert.equal(preview.plan.features.find(x=>x.feature.id==='extrude.pending').status,
    'pending');
  assert.equal(find(preview.document,'extrude.pending').payload.thicknessMm,9);
  assert.deepEqual(find(preview.document,'extrude.pending').dependsOn,['sketch.missing']);
  assert.deepEqual(preview.regressedReadyFeatureIds,['extrude.pending']);
});

test('connected SKETCH FEATUREOPS RUNTIME pump bracket history fixture',()=>{
  const path=fileURLToPath(new URL('../examples/pump-bracket-history-field-revert.mjs',
    import.meta.url));
  const result=spawnSync(process.execPath,['--experimental-strip-types',path],
    {encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const output=JSON.parse(result.stdout);
  assert.equal(output.format,'intuit3d.feature-edit-field-revert-demo');
  assert.deepEqual(output.bodyActions,['rebuild','rebuild','preserve_candidate']);
  assert.equal(output.archiveUndoRedo,true);
  assert.equal(output.historyFieldTransitionsVerified,true);
  assert.equal(output.exactGeometryAuthority,false);
});
