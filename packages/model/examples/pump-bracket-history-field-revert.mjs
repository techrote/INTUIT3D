/**
 * A three-body pump bracket, datum-linked cover and independent inspection
 * gauge. Revert one historical thickness field from a multi-field edit without
 * replacing a later mechanical datum dependency. Actual SKETCH/FEATUREOPS/
 * RUNTIME authoring, archive, partial rebuild and undo/redo; no physical B-rep.
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
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '@intuit3d/model/body-rebuild-manifest';
import {
  FEATURE_EDIT_REVERT_FORMAT,previewFeatureEditRevert,
  FEATURE_EDIT_FIELD_REVERT_FORMAT,previewFeatureEditFieldRevert,
  commitUndoableFeatureEditFieldRevert,
} from '@intuit3d/model/feature-edit-revert';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
  archive,sketch,discovery});
const specs={
  base:{widthMm:110,depthMm:70,thicknessMm:11,holes:[
    {id:'base.left',xMm:-37,yMm:0,radiusMm:4},
    {id:'base.right',xMm:37,yMm:0,radiusMm:4}]},
  cover:{widthMm:86,depthMm:48,thicknessMm:6,holes:[
    {id:'cover.left',xMm:-25,yMm:0,radiusMm:3},
    {id:'cover.right',xMm:25,yMm:0,radiusMm:3}]},
  gauge:{widthMm:35,depthMm:16,thicknessMm:3,holes:[
    {id:'gauge.left',xMm:-12,yMm:0,radiusMm:2},
    {id:'gauge.right',xMm:12,yMm:0,radiusMm:2}]},
};
const find=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
function author(history,id){
  const s=specs[id];
  return featureops.authorMountingFlange(history,{
    format:featureops.FEATURE_OPS_FORMAT,version:1,
    eventId:'author.'+id,expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
    cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,thicknessMm:s.thicknessMm,
    spec:{units:'mm',frame:'local_centered_xy',
      widthMm:s.widthMm,depthMm:s.depthMm,holes:s.holes},
  },{runtime,model,sketch,discovery}).history;
}
export function runPumpBracketHistoryFieldRevert(){
  let history=transactions.startUndoHistory(
    model.newProject('project.pump.bracket.history'));
  for(const id of ['base','cover','gauge']) history=author(history,id);
  // The cover's authored dependency on the base makes it a rebuild consumer.
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.cover.base.link',
    featureId:'extrude.cover',
    patch:{dependsOn:['sketch.cover','cut.base']},
  }],history.document.revision);
  const original=find(history.document,'extrude.base').payload.thicknessMm;
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.base.compound',
    featureId:'extrude.base',patch:{
      payload:{...find(history.document,'extrude.base').payload,thicknessMm:18},
      dependsOn:['sketch.base','sketch.gauge'],
    },
  }],history.document.revision);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.base.later.datum',
    featureId:'extrude.base',
    patch:{dependsOn:['sketch.base','sketch.gauge','sketch.cover']},
  }],history.document.revision);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.gauge.independent',
    featureId:'extrude.gauge',
    patch:{payload:{...find(history.document,'extrude.gauge').payload,
      thicknessMm:4}},
  }],history.document.revision);
  const before=history.document;
  const common={
    expectedProjectId:before.projectId,expectedRevision:before.revision,
    expectedDocumentFence:model.serializeProject(before),
    targetEventId:'edit.base.compound',eventId:'revert.base.thickness',
    admission:'require_ready',confirmUnresolved:false,
  };
  assert.throws(()=>previewFeatureEditRevert(before,{
    ...common,format:FEATURE_EDIT_REVERT_FORMAT,version:1,
  }),model.ProjectRevisionError);
  const req={...common,format:FEATURE_EDIT_FIELD_REVERT_FORMAT,
    version:1,selectedFields:['payload']};
  const preview=previewFeatureEditFieldRevert(before,req);
  assert.deepEqual(preview.revertedFields,['payload']);
  assert.deepEqual(preview.invalidatedBodyIds,['body.base','body.cover']);
  history=commitUndoableFeatureEditFieldRevert(history,req);
  assert.equal(find(history.document,'extrude.base').payload.thicknessMm,original);
  assert.deepEqual(find(history.document,'extrude.base').dependsOn,
    ['sketch.base','sketch.gauge','sketch.cover']);
  assert.equal(find(history.document,'extrude.gauge').payload.thicknessMm,4);
  const manifest=planBodyRebuildManifest(before,history.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:before.projectId,expectedFromRevision:before.revision,
    expectedToRevision:history.document.revision,
    bodyIds:['body.base','body.cover','body.gauge'],
  });
  const actions=manifest.bodies.map(row=>row.action);
  assert.deepEqual(actions,['rebuild','rebuild','preserve_candidate']);
  history=runtime.reopen(runtime.save(history));
  history=runtime.undo(history,['undo.pump.fields']);
  assert.equal(find(history.document,'extrude.base').payload.thicknessMm,18);
  history=runtime.redo(history,['redo.pump.fields']);
  assert.equal(find(history.document,'extrude.base').payload.thicknessMm,original);
  assert.deepEqual(find(history.document,'extrude.base').dependsOn,
    ['sketch.base','sketch.gauge','sketch.cover']);
  return {format:'intuit3d.feature-edit-field-revert-demo',
    bodyActions:actions,archiveUndoRedo:true,
    preservedLaterDatum:true,exactGeometryAuthority:false,
    nativeSTEP:'not_executed'};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runPumpBracketHistoryFieldRevert(),null,2)+'\n');
