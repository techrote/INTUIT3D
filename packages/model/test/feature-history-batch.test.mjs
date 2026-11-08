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
  commitUndoableFeatureHistoryBatch, recoverFeatureHistoryBatchSelection,
  FEATURE_HISTORY_BATCH_RECOVERY_FORMAT,
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

test('retargeted writer retirement is included alongside other batch body rebuilds',()=>{
  // A historical write-target edit is compensated together with a separate
  // thickness edit. A provider must retire the departed body as well as
  // rebuild the restored target; overlooking either leaves stale solids.
  let doc=fixture();
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.cover.retarget',
    featureId:'extrude.cover',patch:{writeTargets:['body.cover.new']}});
  const selected=[
    request(doc).selections[0],
    {kind:'fields',targetEventId:'edit.cover.retarget',
      eventId:'compensate.cover.target',selectedFields:['writeTargets']},
  ];
  const req=request(doc,{selections:selected});
  const preview=previewFeatureHistoryBatch(doc,req);
  assert.deepEqual(find(preview.document,'extrude.cover').writeTargets,
    ['body.cover']);
  assert.deepEqual([...preview.invalidatedBodyIds].sort(),
    ['body.base','body.cover','body.cover.new'].sort());
  const manifest=planBodyRebuildManifest(doc,preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,
    expectedFromRevision:doc.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:['body.base','body.cover','body.cover.new','body.gauge'],
  });
  assert.deepEqual(Object.fromEntries(manifest.bodies.map((row)=>
    [row.bodyId,row.action])),{
      'body.base':'rebuild',
      'body.cover':'rebuild',
      'body.cover.new':'retire',
      'body.gauge':'preserve_candidate',
    });
  let history=commitUndoableFeatureHistoryBatch(startUndoHistory(doc),req);
  assert.equal(history.undoStack.length,1);
  assert.equal(history.undoStack[0].length,2);
  history=undoTransaction(history,['undo.cover.target','undo.base.scalar']);
  assert.deepEqual(find(history.document,'extrude.cover').writeTargets,
    ['body.cover.new']);
  history=redoTransaction(history,['redo.base.scalar','redo.cover.target']);
  assert.deepEqual(find(history.document,'extrude.cover').writeTargets,
    ['body.cover']);
  assert.equal(find(history.document,'extrude.gauge').payload.thicknessMm,5);
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
  assert.equal(summary.recoveredSelectionAfterRuntimeEdit,true);
  assert.equal(summary.exactGeometryAuthority,false);
});


test('stale multi-body selection is recovered only on its canonical append-only lineage',()=>{
  const source=fixture(),captured=request(source);
  const latest=commitEvent(source,{type:'feature.edit',
    eventId:'later.qa.gauge',featureId:'extrude.gauge',
    patch:{payload:{thicknessMm:7}}});
  assert.throws(()=>previewFeatureHistoryBatch(latest,captured),
    ProjectRevisionError,'stale commands may not commit directly');
  const snapshot=serializeProject(latest);
  const result=recoverFeatureHistoryBatchSelection(latest,captured);
  assert.equal(result.format,FEATURE_HISTORY_BATCH_RECOVERY_FORMAT);
  assert.equal(result.status,'ready');
  assert.equal(result.requiresFreshReview,true);
  assert.equal(result.appendedEventCount,1);
  assert.deepEqual(result.newlyInvalidatedBodyIds,[]);
  assert.equal(result.candidateRequest.expectedRevision,latest.revision);
  assert.equal(result.candidateRequest.expectedDocumentFence,snapshot);
  assert.equal(result.candidateRequest.admission,'require_ready');
  assert.equal(result.candidateRequest.confirmUnresolved,false);
  assert.deepEqual(result.preview.invalidatedBodyIds,['body.base','body.cover']);
  let history=commitUndoableFeatureHistoryBatch(startUndoHistory(latest),
    result.candidateRequest);
  assert.equal(history.undoStack.length,1);
  assert.equal(history.undoStack[0].length,2);
  assert.equal(find(history.document,'extrude.gauge').payload.thicknessMm,7);
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['undo.recovered.cover','undo.recovered.base']);
  assert.equal(find(history.document,'extrude.base').payload.thicknessMm,18);
  assert.equal(find(history.document,'extrude.gauge').payload.thicknessMm,7);
  history=redoTransaction(history,['redo.recovered.base','redo.recovered.cover']);
  assert.equal(find(history.document,'extrude.base').payload.thicknessMm,10);
  assert.equal(find(history.document,'extrude.cover').payload.thicknessMm,6);
  assert.equal(find(history.document,'extrude.gauge').payload.thicknessMm,7);
  assert.equal(serializeProject(latest),snapshot,'read-only recovery');
});

test('later disjoint same-feature datum survives a recovered scalar history choice',()=>{
  const source=fixture();
  const latest=commitEvent(source,{type:'feature.edit',
    eventId:'later.base.additional.datum',featureId:'extrude.base',
    patch:{dependsOn:['sketch.base','sketch.cover']}});
  const result=recoverFeatureHistoryBatchSelection(latest,request(source));
  assert.equal(result.status,'ready');
  const committed=commitUndoableFeatureHistoryBatch(startUndoHistory(latest),
    result.candidateRequest);
  assert.deepEqual(find(committed.document,'extrude.base').dependsOn,
    ['sketch.base','sketch.cover']);
  assert.equal(find(committed.document,'extrude.base').payload.thicknessMm,10);
});

test('newly attached dependent body is disclosed, not silently omitted',()=>{
  const source=fixture();
  let latest=commitEvent(source,{type:'feature.create',
    eventId:'create.sketch.brace',
    feature:{id:'sketch.brace',kind:'sketch',dependsOn:[],
      writeTargets:['sketch.brace'],payload:{widthMm:18}}});
  latest=commitEvent(latest,{type:'feature.create',
    eventId:'create.extrude.brace',
    feature:{id:'extrude.brace',kind:'extrude',
      dependsOn:['sketch.brace','extrude.cover'],
      writeTargets:['body.brace'],payload:{thicknessMm:4}}});
  const recovered=recoverFeatureHistoryBatchSelection(latest,request(source));
  assert.equal(recovered.status,'ready');
  assert.deepEqual(recovered.newlyInvalidatedBodyIds,['body.brace']);
  assert.ok(recovered.preview.invalidatedBodyIds.includes('body.brace'));
  const manifest=planBodyRebuildManifest(latest,recovered.preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:latest.projectId,
    expectedFromRevision:latest.revision,
    expectedToRevision:recovered.preview.document.revision,
    bodyIds:['body.base','body.cover','body.gauge','body.brace'],
  });
  assert.deepEqual(Object.fromEntries(manifest.bodies.map((item)=>
    [item.bodyId,item.action])),{
    'body.base':'rebuild','body.cover':'rebuild',
    'body.gauge':'preserve_candidate','body.brace':'rebuild',
  });
});

test('overlapping edit, reused inverse event and feature retirement block entire recovery',()=>{
  const original=fixture(),captured=request(original);
  const cases=[
    commitEvent(original,{type:'feature.edit',eventId:'later.base.payload',
      featureId:'extrude.base',patch:{payload:{thicknessMm:18,clearanceMm:4}}}),
    commitEvent(original,{type:'feature.edit',
      eventId:'compensate.base.thickness',featureId:'extrude.gauge',
      patch:{payload:{thicknessMm:7}}}),
    commitEvent(original,{type:'feature.remove',eventId:'later.cover.remove',
      featureId:'extrude.cover'}),
  ];
  for(const latest of cases){
    const originalFence=serializeProject(latest);
    const result=recoverFeatureHistoryBatchSelection(latest,captured);
    assert.equal(result.status,'blocked');
    assert.match(result.reason,/changed|retired|already|identity|reused|event/i);
    assert.equal(result.candidateRequest,null);
    assert.equal(result.preview,null);
    assert.equal(serializeProject(latest),originalFence);
  }
});

test('equal-revision divergence, changed project and invalid original fence never rebase',()=>{
  const origin=fixture(),captured=request(origin);
  const diverged={...origin,journal:origin.journal.map(event=>
    event.eventId==='edit.gauge.independent'
      ? {...event,patch:{payload:{thicknessMm:7}}}:event)};
  assert.equal(diverged.revision,origin.revision);
  assert.throws(()=>recoverFeatureHistoryBatchSelection(diverged,captured),
    ProjectRevisionError);
  const another=commitEvent(newProject('project.other'),{
    type:'feature.create',eventId:'create.other',
    feature:{id:'sketch.other',kind:'sketch',dependsOn:[],
      writeTargets:['sketch.other'],payload:{widthMm:2}}});
  assert.throws(()=>recoverFeatureHistoryBatchSelection(another,captured),
    ProjectRevisionError);
  assert.throws(()=>recoverFeatureHistoryBatchSelection(origin,{
    ...captured,expectedDocumentFence:captured.expectedDocumentFence+' ',
  }),ProjectRevisionError);
});

test('previous unresolved permission is not carried into a recovered batch',()=>{
  let source=fixture();
  source=commitEvent(source,{type:'feature.create',eventId:'create.sketch.pending',
    feature:{id:'sketch.pending',kind:'sketch',dependsOn:['sketch.absent'],
      writeTargets:['sketch.pending'],payload:{widthMm:12}}});
  source=commitEvent(source,{type:'feature.edit',eventId:'edit.pending.repair',
    featureId:'sketch.pending',patch:{dependsOn:[]}});
  const selections=[request(source).selections[0],{
    kind:'fields',targetEventId:'edit.pending.repair',
    eventId:'compensate.pending.repair',selectedFields:['dependsOn']}];
  const captured=request(source,{
    selections,admission:'permit_unresolved',confirmUnresolved:true});
  const latest=commitEvent(source,{type:'feature.edit',
    eventId:'later.gauge.size',featureId:'extrude.gauge',
    patch:{payload:{thicknessMm:8}}});
  const recovered=recoverFeatureHistoryBatchSelection(latest,captured);
  assert.equal(recovered.status,'requires_unresolved_review');
  assert.ok(recovered.preview.regressedReadyFeatureIds.includes('sketch.pending'));
  assert.equal(recovered.candidateRequest.admission,'require_ready');
  assert.equal(recovered.candidateRequest.confirmUnresolved,false);
  assert.throws(()=>commitUndoableFeatureHistoryBatch(startUndoHistory(latest),
    recovered.candidateRequest),ProjectFormatError);
  const explicitlyApproved={
    ...recovered.candidateRequest,admission:'permit_unresolved',
    confirmUnresolved:true};
  const compensated=commitUndoableFeatureHistoryBatch(startUndoHistory(latest),
    explicitlyApproved);
  assert.equal(compensated.undoStack.length,1);
  assert.equal(planProject(compensated.document).features.find(item=>
    item.feature.id==='sketch.pending').status,'pending');
  assert.equal(find(compensated.document,'extrude.gauge').payload.thicknessMm,8);
});


test('already-pending historical choice requires consent without a ready regression',()=>{
  let doc=fixture();
  // An unsolved machining guide stays pending because its reference datum
  // does not exist. Reverting its authored width is meaningful model intent,
  // but cannot be silently represented as a fully admitted CAD edit.
  doc=commitEvent(doc,{type:'feature.create',eventId:'create.sketch.pending.guide',
    feature:{id:'sketch.pending.guide',kind:'sketch',
      dependsOn:['sketch.missing.datum'],
      writeTargets:['sketch.pending.guide'],payload:{widthMm:12}}});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.pending.guide.width',
    featureId:'sketch.pending.guide',patch:{payload:{widthMm:27}}});
  const selections=[
    request(doc).selections[0],
    {kind:'fields',targetEventId:'edit.pending.guide.width',
      eventId:'compensate.pending.guide.width',selectedFields:['payload']},
  ];
  const strict=request(doc,{selections});
  const permissive={...strict,admission:'permit_unresolved'};
  const before=serializeProject(doc);
  const history=startUndoHistory(doc);
  const initial=serializeUndoHistory(history);

  assert.equal(planProject(doc).features.find((row)=>
    row.feature.id==='sketch.pending.guide').status,'pending');
  assert.throws(()=>previewFeatureHistoryBatch(doc,strict),ProjectFormatError);
  // Previously this was admitted without consent because *no ready feature
  // regressed*. A pending selected feature itself needs review.
  assert.throws(()=>previewFeatureHistoryBatch(doc,permissive),
    /explicit confirmation required/);
  assert.throws(()=>commitUndoableFeatureHistoryBatch(history,permissive),
    ProjectFormatError);
  assert.equal(serializeUndoHistory(history),initial);
  assert.equal(serializeProject(doc),before);

  const approved={...permissive,confirmUnresolved:true};
  const preview=previewFeatureHistoryBatch(doc,approved);
  assert.deepEqual(preview.regressedReadyFeatureIds,[]);
  assert.deepEqual(preview.unresolvedSelectedFeatureIds,
    ['sketch.pending.guide']);
  assert.equal(preview.requiresUnresolvedConsent,true);
  assert.ok(preview.invalidatedBodyIds.includes('body.base'));
  assert.ok(preview.unaffectedReadyFeatureIds.includes('extrude.gauge'));
  let committed=commitUndoableFeatureHistoryBatch(history,approved);
  assert.equal(committed.undoStack.length,1);
  assert.equal(committed.undoStack[0].length,2);
  assert.equal(find(committed.document,'sketch.pending.guide').payload.widthMm,12);
  assert.equal(planProject(committed.document).features.find((row)=>
    row.feature.id==='sketch.pending.guide').status,'pending');
  assert.equal(find(committed.document,'extrude.gauge').payload.thicknessMm,5);
  committed=deserializeModelArchive(
    serializeModelArchive(createModelArchive(committed))).history;
  committed=undoTransaction(committed,['undo.pending.guide','undo.base.guide']);
  assert.equal(find(committed.document,'sketch.pending.guide').payload.widthMm,27);
  committed=redoTransaction(committed,['redo.base.guide','redo.pending.guide']);
  assert.equal(find(committed.document,'sketch.pending.guide').payload.widthMm,12);
});

test('pending selection recovery never transfers consent after unrelated authoring',()=>{
  let doc=fixture();
  doc=commitEvent(doc,{type:'feature.create',eventId:'create.sketch.pending.fixture',
    feature:{id:'sketch.pending.fixture',kind:'sketch',
      dependsOn:['sketch.nonexistent.fixture'],
      writeTargets:['sketch.pending.fixture'],payload:{widthMm:15}}});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.pending.fixture.width',
    featureId:'sketch.pending.fixture',patch:{payload:{widthMm:20}}});
  const selected=request(doc,{selections:[
    request(doc).selections[0],
    {kind:'fields',targetEventId:'edit.pending.fixture.width',
      eventId:'compensate.pending.fixture.width',selectedFields:['payload']},
  ],admission:'permit_unresolved',confirmUnresolved:true});
  const latest=commitEvent(doc,{type:'feature.edit',
    eventId:'edit.gauge.after.pending.review',featureId:'extrude.gauge',
    patch:{payload:{thicknessMm:8}}});
  const priorFence=serializeProject(latest);
  const result=recoverFeatureHistoryBatchSelection(latest,selected);
  assert.equal(result.status,'requires_unresolved_review');
  assert.equal(result.preview.requiresUnresolvedConsent,true);
  assert.deepEqual(result.preview.unresolvedSelectedFeatureIds,
    ['sketch.pending.fixture']);
  assert.deepEqual(result.preview.regressedReadyFeatureIds,[]);
  assert.equal(result.candidateRequest.admission,'require_ready');
  assert.equal(result.candidateRequest.confirmUnresolved,false);
  assert.throws(()=>commitUndoableFeatureHistoryBatch(startUndoHistory(latest),
    result.candidateRequest),ProjectFormatError);
  assert.throws(()=>commitUndoableFeatureHistoryBatch(startUndoHistory(latest),{
    ...result.candidateRequest,admission:'permit_unresolved',
  }),ProjectFormatError);
  const accepted=commitUndoableFeatureHistoryBatch(startUndoHistory(latest),{
    ...result.candidateRequest,admission:'permit_unresolved',
    confirmUnresolved:true,
  });
  assert.equal(find(accepted.document,'sketch.pending.fixture').payload.widthMm,15);
  assert.equal(find(accepted.document,'extrude.gauge').payload.thicknessMm,8);
  assert.equal(serializeProject(latest),priorFence);
});
