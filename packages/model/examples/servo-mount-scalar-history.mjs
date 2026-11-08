/**
 * A servo-drive mounting plate, dependent guard and independent gauge.
 * Exercise actual SKETCH analytic-flange authoring through FEATUREOPS/RUNTIME,
 * then selectively restore an earlier real extrude thickness without
 * discarding its coauthored auxiliary clearance or a later datum dependency.
 * Clearance is kept as user-authored intent; it is NOT claimed to be executed
 * by the native provider. This demonstration does not produce physical STEP.
 */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
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
  HISTORICAL_EDIT_INVENTORY_FORMAT, inspectHistoricalFeatureEdits,
} from '@intuit3d/model/historical-edit-inventory';
import {
  FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT, previewFeaturePayloadScalarRevert,
  commitUndoableFeaturePayloadScalarRevert,
} from '@intuit3d/model/feature-payload-scalar-revert';

const runtime=createWorkflowRuntime({model,transactions,bindings,
  dimensions,archive,sketch,discovery});
const part={
  mount:{widthMm:125,depthMm:90,thicknessMm:9,holes:[
    {id:'mount.left',xMm:-44,yMm:0,radiusMm:4},
    {id:'mount.right',xMm:44,yMm:0,radiusMm:4}]},
  guard:{widthMm:95,depthMm:60,thicknessMm:5,holes:[
    {id:'guard.left',xMm:-32,yMm:0,radiusMm:3},
    {id:'guard.right',xMm:32,yMm:0,radiusMm:3}]},
  gauge:{widthMm:36,depthMm:18,thicknessMm:3,holes:[
    {id:'gauge.left',xMm:-12,yMm:0,radiusMm:2},
    {id:'gauge.right',xMm:12,yMm:0,radiusMm:2}]},
};
const get=(doc,id)=>model.featuresOf(doc).find(x=>x.id===id);
function author(h,id){
  const s=part[id];
  return featureops.authorMountingFlange(h,{
    format:featureops.FEATURE_OPS_FORMAT,version:1,
    eventId:'author.'+id,expectedRevision:h.document.revision,
    sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
    cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,
    thicknessMm:s.thicknessMm,spec:{units:'mm',frame:'local_centered_xy',
      widthMm:s.widthMm,depthMm:s.depthMm,holes:s.holes},
  },{runtime,model,sketch,discovery}).history;
}
export function runServoMountScalarHistory(){
  let history=transactions.startUndoHistory(
    model.newProject('project.servo.mount.history'));
  for(const id of ['mount','guard','gauge']) history=author(history,id);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.guard.mount.datum',
    featureId:'extrude.guard',
    patch:{dependsOn:['sketch.guard','cut.mount']},
  }],history.document.revision);
  // The mount author explicitly stores an auxiliary clearance dimension.
  // Only thicknessMm enters the currently admitted runtime extrusion.
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.mount.clearance.initial',
    featureId:'extrude.mount',
    patch:{payload:{...get(history.document,'extrude.mount').payload,
      clearanceMm:1.5}},
  }],history.document.revision);
  const originalThickness=get(history.document,'extrude.mount').payload.thicknessMm;
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.mount.compound',
    featureId:'extrude.mount',patch:{
      payload:{...get(history.document,'extrude.mount').payload,
        thicknessMm:16,clearanceMm:2.5},
      dependsOn:['sketch.mount','sketch.gauge'],
    },
  }],history.document.revision);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.mount.datum.later',
    featureId:'extrude.mount',
    patch:{dependsOn:['sketch.gauge','sketch.mount']},
  }],history.document.revision);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.gauge.later',
    featureId:'extrude.gauge',
    patch:{payload:{...get(history.document,'extrude.gauge').payload,
      thicknessMm:4}},
  }],history.document.revision);
  const before=history.document;
  const menu=inspectHistoricalFeatureEdits(before,{
    format:HISTORICAL_EDIT_INVENTORY_FORMAT,version:1,
    expectedProjectId:before.projectId,expectedRevision:before.revision,
    expectedDocumentFence:model.serializeProject(before),
    probeEventId:'probe.servo.scalar.history',cursor:null,limit:16,
  });
  const row=menu.rows.find(x=>x.targetEventId==='edit.mount.compound');
  const choice=row?.scalarChoices.find(x=>x.field==='thicknessMm');
  assert.equal(choice?.status,'available');
  assert.equal(choice?.before,originalThickness);
  assert.equal(choice?.authored,16);
  assert.deepEqual(choice?.invalidatedBodyIds,['body.mount','body.guard']);
  const request={
    format:FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT,version:1,
    expectedProjectId:before.projectId,expectedRevision:before.revision,
    expectedDocumentFence:model.serializeProject(before),
    targetEventId:row.targetEventId,eventId:'revert.servo.mount.thickness',
    selectedFields:[choice.field],admission:choice.admission,
    confirmUnresolved:choice.confirmUnresolved,
  };
  const preview=previewFeaturePayloadScalarRevert(before,request);
  assert.equal(get(preview.document,'extrude.mount').payload.thicknessMm,
    originalThickness);
  assert.equal(get(preview.document,'extrude.mount').payload.clearanceMm,2.5);
  assert.deepEqual(get(preview.document,'extrude.mount').dependsOn,
    ['sketch.gauge','sketch.mount']);
  assert.equal(get(preview.document,'extrude.gauge').payload.thicknessMm,4);
  assert.equal(preview.requiresNativeRebuild,true);
  history=commitUndoableFeaturePayloadScalarRevert(history,request);
  assert.equal(get(history.document,'extrude.mount').payload.thicknessMm,
    originalThickness);
  history=archive.deserializeModelArchive(archive.serializeModelArchive(
    archive.createModelArchive(history))).history;
  history=transactions.undoTransaction(history,['undo.servo.scalar']);
  assert.equal(get(history.document,'extrude.mount').payload.thicknessMm,16);
  history=transactions.redoTransaction(history,['redo.servo.scalar']);
  assert.equal(get(history.document,'extrude.mount').payload.thicknessMm,
    originalThickness);
  const result={
    format:'intuit3d.servo-mount-scalar-history',
    selectedHistoricalThicknessRestored:true,
    preservedLaterAuthoring:
      get(history.document,'extrude.mount').payload.clearanceMm===2.5 &&
      get(history.document,'extrude.gauge').payload.thicknessMm===4 &&
      get(history.document,'extrude.mount').dependsOn[0]==='sketch.gauge',
    invalidatedBodyIds:preview.invalidatedBodyIds,
    archiveUndoRedo:true,exactGeometryAuthority:false,
  };
  assert.equal(result.preservedLaterAuthoring,true);
  return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(runServoMountScalarHistory()));
