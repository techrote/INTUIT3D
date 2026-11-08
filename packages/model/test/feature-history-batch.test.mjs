import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  commitEvent, featuresOf, newProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  FEATURE_HISTORY_BATCH_FORMAT, previewFeatureHistoryBatch,
  commitUndoableFeatureHistoryBatch,
} from '../src/feature-history-batch.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import {
  BODY_REBUILD_MANIFEST_FORMAT, planBodyRebuildManifest,
} from '../src/body-rebuild-manifest.ts';

const find = (doc,id) => featuresOf(doc).find((f)=>f.id===id);
function fixture() {
  let doc=newProject('project.dual.rail.history.batch');
  const parts=[
    ['sketch.base','sketch',[],['sketch.base'],{widthMm:100}],
    ['sketch.cover','sketch',[],['sketch.cover'],{widthMm:65}],
    ['sketch.gauge','sketch',[],['sketch.gauge'],{widthMm:30}],
    ['extrude.base','extrude',['sketch.base'],['body.base'],
      {thicknessMm:10,clearanceMm:1}],
    ['cut.base','cut',['extrude.base','sketch.base'],['body.base'],
      {targetBodyId:'body.base',depthMm:4}],
    ['extrude.cover','extrude',['sketch.cover','cut.base'],['body.cover'],
      {thicknessMm:6}],
    ['extrude.gauge','extrude',['sketch.gauge'],['body.gauge'],
      {thicknessMm:3}],
  ];
  for(const [id,kind,dependsOn,writeTargets,payload] of parts) {
    doc=commitEvent(doc,{type:'feature.create',eventId:'create.'+id,
      feature:{id,kind,dependsOn,writeTargets,payload}});
  }
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.base.compound',
    featureId:'extrude.base',
    patch:{payload:{thicknessMm:18,clearanceMm:4}}});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.base.datum',
    featureId:'extrude.base',
    patch:{dependsOn:['sketch.base','sketch.gauge']}});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.cover.thickness',
    featureId:'extrude.cover',patch:{payload:{thicknessMm:9}}});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.gauge.independent',
    featureId:'extrude.gauge',patch:{payload:{thicknessMm:5}}});
  assert.ok(planProject(doc).features.every((row)=>row.status==='ready'));
  return doc;
}
function request(doc,overrides={}) {
  return {
    format:FEATURE_HISTORY_BATCH_FORMAT,version:1,
    expectedProjectId:doc.projectId,
    expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    admission:'require_ready',confirmUnresolved:false,
    selections:[
      {kind:'scalars',targetEventId:'edit.base.compound',
        eventId:'compensate.base.thickness',selectedFields:['thicknessMm']},
      {kind:'fields',targetEventId:'edit.cover.thickness',
        eventId:'compensate.cover.payload',selectedFields:['payload']},
    ],...overrides,
  };
}

test('two history selections across linked bodies form one source-fenced atomic preview',()=>{
  const original=fixture(),fence=serializeProject(original);
  const preview=previewFeatureHistoryBatch(original,request(original));
  assert.equal(preview.document.revision,original.revision+2);
  assert.deepEqual(preview.selections.map((x)=>x.featureId),
    ['extrude.base','extrude.cover']);
  assert.deepEqual(preview.events.map((x)=>x.eventId),
    ['compensate.base.thickness','compensate.cover.payload']);
  assert.equal(find(preview.document,'extrude.base').payload.thicknessMm,10);
  assert.equal(find(preview.document,'extrude.base').payload.clearanceMm,4);
  assert.deepEqual(find(preview.document,'extrude.base').dependsOn,
    ['sketch.base','sketch.gauge']);
  assert.equal(find(preview.document,'extrude.cover').payload.thicknessMm,6);
  assert.equal(find(preview.document,'extrude.gauge').payload.thicknessMm,5);
  assert.deepEqual(preview.invalidatedBodyIds,['body.base','body.cover']);
  assert.ok(preview.unaffectedReadyFeatureIds.includes('extrude.gauge'));
  assert.deepEqual(preview.regressedReadyFeatureIds,[]);
  assert.equal(preview.exactGeometryAuthority,false);
  const manifest=planBodyRebuildManifest(original,preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:original.projectId,
    expectedFromRevision:original.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:['body.base','body.cover','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map((row)=>row.action),
    ['rebuild','rebuild','preserve_candidate']);
  assert.equal(serializeProject(original),fence);
});

test('one durable undo frame persists through archive, undo and redo both features',()=>{
  const doc=fixture();
  let history=commitUndoableFeatureHistoryBatch(startUndoHistory(doc),request(doc));
  assert.equal(history.undoStack.length,1);
  assert.equal(history.undoStack[0].length,2);
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['undo.cover','undo.base']);
  assert.equal(find(history.document,'extrude.base').payload.thicknessMm,18);
  assert.equal(find(history.document,'extrude.cover').payload.thicknessMm,9);
  assert.equal(find(history.document,'extrude.gauge').payload.thicknessMm,5);
  history=redoTransaction(history,['redo.base','redo.cover']);
  assert.equal(find(history.document,'extrude.base').payload.thicknessMm,10);
  assert.equal(find(history.document,'extrude.cover').payload.thicknessMm,6);
  assert.equal(find(history.document,'extrude.base').payload.clearanceMm,4);
  assert.equal(find(history.document,'extrude.gauge').payload.thicknessMm,5);
});

test('no stale revision, equal-revision alternate journal or duplicate target can commit',()=>{
  const doc=fixture(),history=startUndoHistory(doc);
  const initial=serializeUndoHistory(history);
  const divergent={
    ...doc,journal:doc.journal.map((event)=>
      event.eventId==='edit.gauge.independent'
        ? {...event,patch:{payload:{thicknessMm:7}}}:event),
  };
  assert.equal(divergent.revision,doc.revision);
  assert.notEqual(serializeProject(divergent),serializeProject(doc));
  for(const override of [
    {expectedRevision:doc.revision-1},
    {expectedProjectId:'project.other'},
    {expectedDocumentFence:serializeProject(divergent)},
  ]) {
    assert.throws(()=>previewFeatureHistoryBatch(doc,request(doc,override)),
      ProjectRevisionError);
  }
  assert.throws(()=>previewFeatureHistoryBatch(divergent,request(doc)),
    ProjectRevisionError);
  for(const selections of [
    [request(doc).selections[0],request(doc).selections[0]],
    [request(doc).selections[0],
      {...request(doc).selections[1],eventId:'compensate.base.thickness'}],
    [request(doc).selections[0],
      {kind:'fields',targetEventId:'edit.base.datum',
        eventId:'compensate.base.datum',selectedFields:['dependsOn']}],
  ]) {
    assert.throws(()=>previewFeatureHistoryBatch(doc,
      request(doc,{selections})),ProjectFormatError);
  }
  assert.throws(()=>commitUndoableFeatureHistoryBatch(history,request(doc,{
    selections:[request(doc).selections[0],
      {...request(doc).selections[1],selectedFields:['kind']}],
  })),ProjectFormatError);
  assert.equal(serializeUndoHistory(history),initial);
});

test('intervening same-payload edit, invalid source or stale event ID reject all',()=>{
  const original=fixture();
  const changed=commitEvent(original,{type:'feature.edit',
    eventId:'later.base.reauthor',
    featureId:'extrude.base',patch:{
      payload:{...find(original,'extrude.base').payload,thicknessMm:18},
    }});
  assert.throws(()=>previewFeatureHistoryBatch(changed,request(changed)),
    ProjectRevisionError);
  assert.throws(()=>previewFeatureHistoryBatch(original,request(original,{
    selections:[request(original).selections[0],
      {...request(original).selections[1],
        eventId:'edit.base.compound'}],
  })),ProjectFormatError);
  assert.throws(()=>previewFeatureHistoryBatch(original,request(original,{
    selections:request(original).selections.map((entry,i)=>
      i===1?{...entry,unknown:true}:entry),
  })),ProjectFormatError);
});

test('multi-feature unresolved regression needs both explicit admission and consent',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{type:'feature.create',eventId:'create.sketch.pending',
    feature:{id:'sketch.pending',kind:'sketch',
      dependsOn:['sketch.absent'],writeTargets:['sketch.pending'],payload:{widthMm:12}}});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.pending.repair',
    featureId:'sketch.pending',patch:{dependsOn:[]}});
  const selections=[
    request(doc).selections[0],
    {kind:'fields',targetEventId:'edit.pending.repair',
      eventId:'compensate.pending.repair',selectedFields:['dependsOn']},
  ];
  const strict=request(doc,{selections});
  assert.throws(()=>previewFeatureHistoryBatch(doc,strict),ProjectFormatError);
  assert.throws(()=>previewFeatureHistoryBatch(doc,{
    ...strict,admission:'permit_unresolved',
  }),ProjectFormatError);
  const preview=previewFeatureHistoryBatch(doc,{
    ...strict,admission:'permit_unresolved',confirmUnresolved:true,
  });
  assert.ok(preview.regressedReadyFeatureIds.includes('sketch.pending'));
  assert.equal(preview.plan.features.find((row)=>
    row.feature.id==='sketch.pending').status,'pending');
  assert.ok(preview.invalidatedBodyIds.includes('body.base'));
});

test('actual SKETCH/FEATUREOPS/RUNTIME linked multi-body authoring example',()=>{
  const result=spawnSync(process.execPath,
    ['--experimental-strip-types',
      fileURLToPath(new URL('../examples/dual-rail-history-batch.mjs',import.meta.url))],
    {encoding:'utf8',timeout:45000});
  assert.equal(result.status,0,
    'example failed: '+result.stderr+'\n'+result.stdout);
  const summary=JSON.parse(result.stdout);
  assert.deepEqual(summary.bodyActions,
    ['rebuild','rebuild','preserve_candidate']);
  assert.equal(summary.singleUndoFrame,true);
  assert.equal(summary.archiveUndoRedo,true);
  assert.equal(summary.exactGeometryAuthority,false);
});
