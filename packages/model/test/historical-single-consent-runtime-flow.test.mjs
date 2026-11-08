/**
 * One real three-body mechanical project, authored with FEATUREOPS / SKETCH /
 * RUNTIME, then edited while an intentionally unmade datum is unresolved.
 * Exercise the source-fenced INTENT historical editor without claiming B-rep.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as featureops from '@intuit3d/feature-ops';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {
  FEATURE_EDIT_REVERT_FORMAT, FEATURE_EDIT_FIELD_REVERT_FORMAT,
  previewFeatureEditRevert, previewFeatureEditFieldRevert,
  commitUndoableFeatureEditRevert,
} from '../src/feature-edit-revert.ts';
import {
  FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT,
  previewFeaturePayloadScalarRevert,
  commitUndoableFeaturePayloadScalarRevert,
} from '../src/feature-payload-scalar-revert.ts';
import {
  HISTORICAL_EDIT_INVENTORY_FORMAT, inspectHistoricalFeatureEdits,
} from '../src/historical-edit-inventory.ts';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const specs={
  mount:{widthMm:118,depthMm:78,thicknessMm:10,holes:[
    {id:'mount.left',xMm:-35,yMm:0,radiusMm:4},
    {id:'mount.right',xMm:35,yMm:0,radiusMm:4}]},
  guard:{widthMm:88,depthMm:54,thicknessMm:5,holes:[
    {id:'guard.left',xMm:-25,yMm:0,radiusMm:3},
    {id:'guard.right',xMm:25,yMm:0,radiusMm:3}]},
  gauge:{widthMm:36,depthMm:20,thicknessMm:3,holes:[
    {id:'gauge.left',xMm:-10,yMm:0,radiusMm:2},
    {id:'gauge.right',xMm:10,yMm:0,radiusMm:2}]},
};
const feature=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
function authoredPendingFixture(){
  let h=transactions.startUndoHistory(model.newProject(
    'project.history.unmade.guard.datum'));
  for(const id of ['mount','guard','gauge']){
    const s=specs[id];
    h=featureops.authorMountingFlange(h,{
      format:featureops.FEATURE_OPS_FORMAT,version:1,
      eventId:'author.'+id,expectedRevision:h.document.revision,
      sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
      cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,
      thicknessMm:s.thicknessMm,
      spec:{units:'mm',frame:'local_centered_xy',
        widthMm:s.widthMm,depthMm:s.depthMm,holes:s.holes},
    },{runtime,model,sketch,discovery}).history;
  }
  assert.ok(model.planProject(h.document).features.every(x=>x.status==='ready'));
  const extrude=feature(h.document,'extrude.guard');
  h=runtime.commit(h,[{
    type:'feature.edit',eventId:'edit.guard.thickness',
    featureId:'extrude.guard',
    patch:{payload:{...extrude.payload,thicknessMm:14}},
  }],h.document.revision);
  const changed=feature(h.document,'extrude.guard');
  // A user later authors a dependency on a cross-body mount datum that is
  // not yet present. Preserve that impossible intent, do not fix it silently.
  // MODEL accepts the append-only event even though the resulting DAG is pending.
  const doc=model.commitEvent(h.document,{
    type:'feature.edit',eventId:'edit.guard.unmade.datum',
    featureId:'extrude.guard',
    patch:{dependsOn:[...changed.dependsOn,
      'cut.mount','sketch.unmade.guard.datum']},
  });
  const states=new Map(model.planProject(doc).features.map(x=>
    [x.feature.id,x.status]));
  assert.equal(states.get('extrude.guard'),'pending');
  assert.equal(states.get('extrude.gauge'),'ready');
  assert.equal(states.get('cut.mount'),'ready');
  return doc;
}
function common(doc,format,eventId){
  return {
    format,version:1,expectedProjectId:doc.projectId,
    expectedRevision:doc.revision,
    expectedDocumentFence:model.serializeProject(doc),
    targetEventId:'edit.guard.thickness',eventId,
    admission:'require_ready',confirmUnresolved:false,
  };
}
test('real multi-body historical history menu requests renewed consent for pending selected intent',()=>{
  const doc=authoredPendingFixture();
  const original=model.serializeProject(doc);
  const menu=inspectHistoricalFeatureEdits(doc,{
    format:HISTORICAL_EDIT_INVENTORY_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:original,probeEventId:'probe.guard.consent',
    cursor:null,limit:16,
  });
  const row=menu.rows.find(x=>x.targetEventId==='edit.guard.thickness');
  assert.ok(row);
  assert.equal(row.status,'requires_unresolved_admission');
  assert.equal(row.confirmUnresolved,true);
  assert.equal(row.fieldChoices.find(x=>x.field==='payload').confirmUnresolved,true);
  assert.equal(row.scalarChoices.find(x=>x.field==='thicknessMm').confirmUnresolved,true);
  assert.equal(row.scalarChoices.find(x=>x.field==='thicknessMm').status,
    'requires_unresolved_admission');

  const whole=common(doc,FEATURE_EDIT_REVERT_FORMAT,'revert.guard.whole');
  const field={...common(doc,FEATURE_EDIT_FIELD_REVERT_FORMAT,
    'revert.guard.field'),selectedFields:['payload']};
  const scalar={...common(doc,FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT,
    'revert.guard.scalar'),selectedFields:['thicknessMm']};
  for(const [preview,request] of [
    [previewFeatureEditRevert,whole],
    [previewFeatureEditFieldRevert,field],
    [previewFeaturePayloadScalarRevert,scalar],
  ]){
    assert.throws(()=>preview(doc,request),model.ProjectFormatError);
    assert.throws(()=>preview(doc,{...request,admission:'permit_unresolved'}),
      /explicit confirmation required/);
    const approved=preview(doc,{...request,
      admission:'permit_unresolved',confirmUnresolved:true});
    assert.deepEqual(approved.regressedReadyFeatureIds,[]);
    assert.deepEqual(approved.unresolvedSelectedFeatureIds,['extrude.guard']);
    assert.equal(approved.requiresUnresolvedConsent,true);
    assert.ok(approved.invalidatedBodyIds.includes('body.guard'));
    assert.ok(!approved.invalidatedBodyIds.includes('body.gauge'));
    assert.equal(approved.invalidation.unchangedReady.includes('extrude.gauge'),true);
    assert.equal(feature(approved.document,'extrude.guard').payload.thicknessMm,5);
    assert.equal(feature(approved.document,'extrude.gauge').payload.thicknessMm,3);
  }
  // A failed or unconfirmed command must not append any journal entry.
  const history=transactions.startUndoHistory(doc);
  const snapshot=transactions.serializeUndoHistory(history);
  assert.throws(()=>commitUndoableFeatureEditRevert(history,{
    ...whole,admission:'permit_unresolved',
  }),model.ProjectFormatError);
  assert.equal(transactions.serializeUndoHistory(history),snapshot);

  let accepted=commitUndoableFeatureEditRevert(history,{
    ...whole,admission:'permit_unresolved',confirmUnresolved:true,
  });
  assert.equal(accepted.undoStack.length,1);
  assert.equal(feature(accepted.document,'extrude.guard').payload.thicknessMm,5);
  accepted=archive.deserializeModelArchive(archive.serializeModelArchive(
    archive.createModelArchive(accepted))).history;
  accepted=transactions.undoTransaction(accepted,['undo.guard.reversion']);
  assert.equal(feature(accepted.document,'extrude.guard').payload.thicknessMm,14);
  accepted=transactions.redoTransaction(accepted,['redo.guard.reversion']);
  assert.equal(feature(accepted.document,'extrude.guard').payload.thicknessMm,5);
  assert.equal(model.planProject(accepted.document).features.find(x=>
    x.feature.id==='extrude.guard').status,'pending');
  assert.equal(model.serializeProject(doc),original);
});
test('scalar historical compensation does not transfer pending consent to a divergent source',()=>{
  const doc=authoredPendingFixture();
  const request=common(doc,FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT,
    'revert.guard.scalar.next');
  const scalar={...request,selectedFields:['thicknessMm'],
    admission:'permit_unresolved',confirmUnresolved:true};
  let h=commitUndoableFeaturePayloadScalarRevert(
    transactions.startUndoHistory(doc),scalar);
  assert.equal(feature(h.document,'extrude.guard').payload.thicknessMm,5);
  h=archive.deserializeModelArchive(archive.serializeModelArchive(
    archive.createModelArchive(h))).history;
  h=transactions.undoTransaction(h,['undo.scalar.guard']);
  assert.equal(feature(h.document,'extrude.guard').payload.thicknessMm,14);
  h=transactions.redoTransaction(h,['redo.scalar.guard']);
  assert.equal(feature(h.document,'extrude.guard').payload.thicknessMm,5);

  const divergent={...doc,journal:doc.journal.map(event=>
    event.eventId==='edit.guard.thickness'
      ? {...event,patch:{payload:{...event.patch.payload,thicknessMm:15}}}
      : event)};
  assert.equal(divergent.revision,doc.revision);
  assert.notEqual(model.serializeProject(divergent),model.serializeProject(doc));
  assert.throws(()=>previewFeaturePayloadScalarRevert(divergent,scalar),
    model.ProjectRevisionError);
  assert.throws(()=>previewFeatureEditRevert(divergent,
    {...common(doc,FEATURE_EDIT_REVERT_FORMAT,'revert.divergent.guard'),
      admission:'permit_unresolved',confirmUnresolved:true}),
    model.ProjectRevisionError);
});
