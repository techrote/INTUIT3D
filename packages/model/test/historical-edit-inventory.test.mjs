import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  commitEvent, featuresOf, newProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  HISTORICAL_EDIT_INVENTORY_FORMAT, inspectHistoricalFeatureEdits,
} from '../src/historical-edit-inventory.ts';
import {
  FEATURE_EDIT_REVERT_FORMAT, previewFeatureEditRevert,
  commitUndoableFeatureEditRevert,
} from '../src/feature-edit-revert.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';

const feature=(id,kind,dependsOn,writeTargets,payload)=>({
  id,kind,dependsOn,writeTargets,payload,
});
const find=(doc,id)=>featuresOf(doc).find(f=>f.id===id);
function baseline() {
  let doc=newProject('project.history.choice.motor.jig');
  const parts=[
    feature('sketch.motor','sketch',[],['sketch.motor'],{widthMm:90}),
    feature('extrude.motor','extrude',['sketch.motor'],['body.motor'],{thicknessMm:9}),
    feature('cut.motor','cut',['extrude.motor','sketch.motor'],['body.motor'],
      {targetBodyId:'body.motor',depthMm:3}),
    feature('sketch.gauge','sketch',[],['sketch.gauge'],{widthMm:30}),
    feature('extrude.gauge','extrude',['sketch.gauge'],['body.gauge'],{thicknessMm:2}),
  ];
  for (const f of parts)
    doc=commitEvent(doc,{type:'feature.create',eventId:'create.'+f.id,feature:f});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.motor.thickness',
    featureId:'extrude.motor',patch:{payload:{thicknessMm:13}}});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.gauge.width',
    featureId:'sketch.gauge',patch:{payload:{widthMm:41}}});
  assert.ok(planProject(doc).features.every(x=>x.status==='ready'));
  return doc;
}
function inventoryRequest(doc,overrides={}) {
  return {
    format:HISTORICAL_EDIT_INVENTORY_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    probeEventId:'probe.history.edit.inventory',
    cursor:null,limit:16,...overrides,
  };
}
function revertRequest(doc,row,eventId) {
  return {
    format:FEATURE_EDIT_REVERT_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    targetEventId:row.targetEventId,eventId,
    admission:row.admission,confirmUnresolved:row.confirmUnresolved,
  };
}
test('history menu exposes two independently reversible machining edits and exact body impact',()=>{
  const doc=baseline(),snapshot=serializeProject(doc);
  const inventory=inspectHistoricalFeatureEdits(doc,inventoryRequest(doc));
  assert.equal(inventory.format,HISTORICAL_EDIT_INVENTORY_FORMAT);
  assert.equal(inventory.rows.length,2);
  assert.deepEqual(inventory.rows.map(row=>row.targetEventId),
    ['edit.gauge.width','edit.motor.thickness']);
  assert.deepEqual(inventory.rows.map(row=>row.status),['available','available']);
  assert.deepEqual(inventory.rows[1].originallyEditedFields,['payload']);
  assert.deepEqual(inventory.rows[1].invalidatedBodyIds,['body.motor']);
  assert.deepEqual(inventory.rows[0].invalidatedBodyIds,['body.gauge']);
  assert.equal(inventory.rows[1].admission,'require_ready');
  assert.equal(inventory.rows[1].confirmUnresolved,false);
  assert.equal(inventory.rows[1].resultingTargetStatus,'ready');
  assert.equal(inventory.nextCursor,null);
  assert.equal(inventory.exactGeometryAuthority,false);
  assert.equal(serializeProject(doc),snapshot);
});
test('selected history choice commits atomically after unrelated later edit; archive and undo/redo',()=>{
  const original=baseline();
  const inventory=inspectHistoricalFeatureEdits(original,inventoryRequest(original));
  const selected=inventory.rows.find(row=>row.targetEventId==='edit.motor.thickness');
  assert.ok(selected);
  const request=revertRequest(original,selected,'revert.motor.from.menu');
  const preview=previewFeatureEditRevert(original,request);
  assert.deepEqual(preview.invalidatedBodyIds,selected.invalidatedBodyIds);
  let history=commitUndoableFeatureEditRevert(startUndoHistory(original),request);
  assert.equal(find(history.document,'extrude.motor').payload.thicknessMm,9);
  assert.equal(find(history.document,'sketch.gauge').payload.widthMm,41);
  assert.equal(history.undoStack.length,1);
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['undo.motor.menu']);
  assert.equal(find(history.document,'extrude.motor').payload.thicknessMm,13);
  assert.equal(find(history.document,'sketch.gauge').payload.widthMm,41);
  history=redoTransaction(history,['redo.motor.menu']);
  assert.equal(find(history.document,'extrude.motor').payload.thicknessMm,9);
  assert.equal(find(history.document,'sketch.gauge').payload.widthMm,41);
  assert.throws(()=>inspectHistoricalFeatureEdits(history.document,
    inventoryRequest(original)),ProjectRevisionError);
});
test('later changes to the same feature block only its older history choices',()=>{
  let doc=baseline();
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.gauge.latest',
    featureId:'sketch.gauge',patch:{payload:{widthMm:47}}});
  doc=commitEvent(doc,{type:'feature.move',eventId:'move.motor.visual',
    featureId:'extrude.motor',afterFeatureId:'sketch.motor'});
  const rows=inspectHistoricalFeatureEdits(doc,inventoryRequest(doc)).rows;
  assert.deepEqual(rows.map(row=>row.targetEventId),
    ['edit.gauge.latest','edit.gauge.width','edit.motor.thickness']);
  assert.equal(rows[0].status,'available');
  assert.equal(rows[1].status,'blocked');
  assert.match(rows[1].reason,/subsequently changed|retired/);
  assert.equal(rows[1].admission,null);
  assert.equal(rows[2].status,'available');
});
test('history menu distinguishes explicit consent from unresolved admission',()=>{
  let doc=newProject('project.pending.history.menu');
  doc=commitEvent(doc,{eventId:'create.extrude.pending',type:'feature.create',
    feature:feature('extrude.pending','extrude',['sketch.absent'],
      ['body.pending'],{thicknessMm:4})});
  doc=commitEvent(doc,{eventId:'create.sketch.good',type:'feature.create',
    feature:feature('sketch.good','sketch',[],['sketch.good'],{})});
  doc=commitEvent(doc,{eventId:'edit.pending.dep',type:'feature.edit',
    featureId:'extrude.pending',patch:{dependsOn:['sketch.good']}});
  const row=inspectHistoricalFeatureEdits(doc,inventoryRequest(doc)).rows[0];
  assert.equal(row.status,'requires_confirmation');
  assert.equal(row.admission,'permit_unresolved');
  assert.equal(row.confirmUnresolved,true);
  assert.deepEqual(row.regressedReadyFeatureIds,['extrude.pending']);
  assert.equal(row.resultingTargetStatus,'pending');
  assert.throws(()=>previewFeatureEditRevert(doc,revertRequest(doc,row,
    'revert.pending.without.consent').confirmUnresolved===true
      ? {...revertRequest(doc,row,'revert.pending.without.consent'),confirmUnresolved:false}
      : revertRequest(doc,row,'revert.pending.without.consent')),ProjectFormatError);
  const preview=previewFeatureEditRevert(doc,revertRequest(doc,row,'revert.pending.consented'));
  assert.equal(preview.plan.features.find(x=>x.feature.id==='extrude.pending').status,'pending');

  let unresolved=newProject('project.unresolved.history.menu');
  unresolved=commitEvent(unresolved,{eventId:'create.extrude.unresolved',type:'feature.create',
    feature:feature('extrude.unresolved','extrude',['sketch.absent'],
      ['body.unresolved'],{thicknessMm:4})});
  unresolved=commitEvent(unresolved,{eventId:'edit.unresolved.thickness',type:'feature.edit',
    featureId:'extrude.unresolved',patch:{payload:{thicknessMm:8}}});
  const other=inspectHistoricalFeatureEdits(unresolved,inventoryRequest(unresolved)).rows[0];
  assert.equal(other.status,'requires_unresolved_admission');
  assert.equal(other.confirmUnresolved,false);
  assert.equal(other.admission,'permit_unresolved');
});
test('no-op edits are shown blocked rather than being silently hidden',()=>{
  let doc=baseline();
  doc=commitEvent(doc,{eventId:'edit.motor.noop',type:'feature.edit',
    featureId:'extrude.motor',patch:{payload:{thicknessMm:13}}});
  const rows=inspectHistoricalFeatureEdits(doc,inventoryRequest(doc)).rows;
  assert.equal(rows[0].targetEventId,'edit.motor.noop');
  assert.equal(rows[0].status,'blocked');
  assert.match(rows[0].reason,/no remaining authored change/);
});
test('cursor pages authored edits newest-first and never advances stale revision',()=>{
  const doc=baseline();
  const first=inspectHistoricalFeatureEdits(doc,inventoryRequest(doc,{limit:1}));
  assert.equal(first.rows.length,1);
  assert.equal(first.rows[0].targetEventId,'edit.gauge.width');
  assert.ok(first.nextCursor !== null);
  const second=inspectHistoricalFeatureEdits(doc,inventoryRequest(doc,
    {limit:1,cursor:first.nextCursor}));
  assert.equal(second.rows[0].targetEventId,'edit.motor.thickness');
  assert.equal(second.nextCursor,null);
  assert.deepEqual([
    ...first.rows.map(x=>x.targetEventId),...second.rows.map(x=>x.targetEventId)],
    inspectHistoricalFeatureEdits(doc,inventoryRequest(doc)).rows.map(x=>x.targetEventId));
  const newDoc=commitEvent(doc,{eventId:'edit.gauge.newest',type:'feature.edit',
    featureId:'sketch.gauge',patch:{payload:{widthMm:43}}});
  assert.throws(()=>inspectHistoricalFeatureEdits(newDoc,
    inventoryRequest(doc,{cursor:first.nextCursor})),ProjectRevisionError);
});
test('reject wrong project, divergent equal-revision history and unsafe probe identity',()=>{
  const doc=baseline(),fence=serializeProject(doc);
  const fork={...doc,journal:doc.journal.map(e=>e.eventId==='edit.gauge.width'?
    {...e,patch:{payload:{widthMm:42}}}:e)};
  assert.equal(fork.revision,doc.revision);
  assert.notEqual(serializeProject(fork),fence);
  assert.throws(()=>inspectHistoricalFeatureEdits(doc,inventoryRequest(doc,{
    expectedDocumentFence:serializeProject(fork),
  })),ProjectRevisionError);
  assert.throws(()=>inspectHistoricalFeatureEdits(fork,inventoryRequest(doc)),
    ProjectRevisionError);
  assert.throws(()=>inspectHistoricalFeatureEdits(doc,inventoryRequest(doc,{
    expectedProjectId:'project.another',
  })),ProjectRevisionError);
  assert.throws(()=>inspectHistoricalFeatureEdits(doc,inventoryRequest(doc,{
    probeEventId:'edit.motor.thickness',
  })),ProjectFormatError);
  for(const changes of [
    {limit:0},{limit:17},{cursor:-1},{cursor:doc.revision+1},
    {cursor:1.5},{probeEventId:'bad id'},{unexpected:true},
  ]) assert.throws(()=>inspectHistoricalFeatureEdits(doc,inventoryRequest(doc,changes)),
    ProjectFormatError);
  assert.equal(serializeProject(doc),fence);
});
test('connected SKETCH FEATUREOPS RUNTIME motor saddle authoring exercises the menu',()=>{
  const path=fileURLToPath(new URL('../examples/selective-motor-saddle-revert.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',path],
    {encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const evidence=JSON.parse(run.stdout);
  assert.equal(evidence.format,'intuit3d.feature-edit-revert-demo');
  assert.equal(evidence.historicalEditChoice,'available');
  assert.deepEqual(evidence.historyChoiceInvalidatedBodies,['body.motor','body.clamp']);
  assert.equal(evidence.archiveUndoRedo,true);
  assert.equal(evidence.exactGeometryAuthority,false);
});
