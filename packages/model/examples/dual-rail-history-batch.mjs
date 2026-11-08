/**
 * Two edited structural rail flanges and an untouched inspection gauge.
 * One user decision compensates prior base and cover dimensions together,
 * retaining a later base datum and independent gauge. SKETCH, FEATUREOPS and
 * RUNTIME are real package contracts; physical B-rep/STEP is not executed.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as featureops from '@intuit3d/feature-ops';
import { createWorkflowRuntime } from '@intuit3d/workflow-runtime';
import {
  FEATURE_HISTORY_BATCH_FORMAT, previewFeatureHistoryBatch,
  commitUndoableFeatureHistoryBatch, recoverFeatureHistoryBatchSelection,
} from '@intuit3d/model/feature-history-batch';
import {
  BODY_REBUILD_MANIFEST_FORMAT, planBodyRebuildManifest,
} from '@intuit3d/model/body-rebuild-manifest';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,
  archive,sketch,discovery});
const specs={
  base:{widthMm:120,depthMm:38,thicknessMm:10,holes:[
    {id:'rail.base.left',xMm:-43,yMm:0,radiusMm:3},
    {id:'rail.base.right',xMm:43,yMm:0,radiusMm:3}]},
  cover:{widthMm:95,depthMm:28,thicknessMm:6,holes:[
    {id:'rail.cover.left',xMm:-35,yMm:0,radiusMm:2},
    {id:'rail.cover.right',xMm:35,yMm:0,radiusMm:2}]},
  gauge:{widthMm:35,depthMm:18,thicknessMm:3,holes:[
    {id:'rail.gauge.left',xMm:-12,yMm:0,radiusMm:2},
    {id:'rail.gauge.right',xMm:12,yMm:0,radiusMm:2}]},
};
const find=(doc,id)=>model.featuresOf(doc).find((feature)=>feature.id===id);
function author(history,id) {
  const spec=specs[id];
  return featureops.authorMountingFlange(history,{
    format:featureops.FEATURE_OPS_FORMAT,version:1,
    eventId:'author.rail.'+id,expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.rail.'+id,
    extrudeFeatureId:'extrude.rail.'+id,
    cutFeatureId:'cut.rail.'+id,
    targetBodyId:'body.rail.'+id,thicknessMm:spec.thicknessMm,
    spec:{units:'mm',frame:'local_centered_xy',
      widthMm:spec.widthMm,depthMm:spec.depthMm,holes:spec.holes},
  },{runtime,model,sketch,discovery}).history;
}
export function runDualRailHistoryBatch() {
  let history=transactions.startUndoHistory(
    model.newProject('project.dual.rail.history.compensation'));
  for(const id of ['base','cover','gauge']) history=author(history,id);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'link.rail.cover.to.base',
    featureId:'extrude.rail.cover',
    patch:{dependsOn:['sketch.rail.cover','cut.rail.base']},
  }],history.document.revision);
  const oldBase=find(history.document,'extrude.rail.base').payload.thicknessMm;
  const oldCover=find(history.document,'extrude.rail.cover').payload.thicknessMm;
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'history.rail.base.compound',
    featureId:'extrude.rail.base',
    patch:{payload:{...find(history.document,'extrude.rail.base').payload,
      thicknessMm:17,clearanceMm:5}},
  }],history.document.revision);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'history.rail.cover.thickness',
    featureId:'extrude.rail.cover',
    patch:{payload:{...find(history.document,'extrude.rail.cover').payload,
      thicknessMm:9}},
  }],history.document.revision);
  // Same-feature later work on another semantic field remains authored.
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'history.rail.base.later.datum',
    featureId:'extrude.rail.base',
    patch:{dependsOn:['sketch.rail.base','sketch.rail.gauge']},
  }],history.document.revision);
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'history.rail.gauge.independent',
    featureId:'extrude.rail.gauge',
    patch:{payload:{...find(history.document,'extrude.rail.gauge').payload,
      thicknessMm:4}},
  }],history.document.revision);
  // Capture two selected historical edits, then continue real authoring.
  // The inspector must recover the selection from the canonical old journal,
  // rather than discard it or silently transfer an old source fence/consent.
  const inspected=history.document;
  const request={
    format:FEATURE_HISTORY_BATCH_FORMAT,version:1,
    expectedProjectId:inspected.projectId,expectedRevision:inspected.revision,
    expectedDocumentFence:model.serializeProject(inspected),
    admission:'require_ready',confirmUnresolved:false,
    selections:[
      {kind:'scalars',targetEventId:'history.rail.base.compound',
        eventId:'compensate.rail.base.scalar',selectedFields:['thicknessMm']},
      {kind:'fields',targetEventId:'history.rail.cover.thickness',
        eventId:'compensate.rail.cover.payload',selectedFields:['payload']},
    ],
  };
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'history.rail.gauge.after.selection',
    featureId:'extrude.rail.gauge',
    patch:{payload:{...find(history.document,'extrude.rail.gauge').payload,
      thicknessMm:5}},
  }],history.document.revision);
  const before=history.document;
  const oldFrames=history.undoStack.length;
  const recovered=recoverFeatureHistoryBatchSelection(before,request);
  assert.equal(recovered.status,'ready');
  assert.equal(recovered.appendedEventCount,1);
  assert.deepEqual(recovered.newlyInvalidatedBodyIds,[]);
  const preview=recovered.preview;
  assert.deepEqual(preview.invalidatedBodyIds,
    ['body.rail.base','body.rail.cover']);
  history=commitUndoableFeatureHistoryBatch(history,recovered.candidateRequest);
  const singleUndoFrame=history.undoStack.length===oldFrames+1 &&
    history.undoStack[history.undoStack.length-1].length===2;
  assert.equal(singleUndoFrame,true);
  assert.equal(find(history.document,'extrude.rail.base').payload.thicknessMm,
    oldBase);
  assert.equal(find(history.document,'extrude.rail.base').payload.clearanceMm,5);
  assert.equal(find(history.document,'extrude.rail.cover').payload.thicknessMm,
    oldCover);
  assert.deepEqual(find(history.document,'extrude.rail.base').dependsOn,
    ['sketch.rail.base','sketch.rail.gauge']);
  assert.equal(find(history.document,'extrude.rail.gauge').payload.thicknessMm,5);
  const manifest=planBodyRebuildManifest(before,history.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:before.projectId,
    expectedFromRevision:before.revision,
    expectedToRevision:history.document.revision,
    bodyIds:['body.rail.base','body.rail.cover','body.rail.gauge'],
  });
  const bodyActions=manifest.bodies.map((entry)=>entry.action);
  assert.deepEqual(bodyActions,['rebuild','rebuild','preserve_candidate']);
  history=runtime.reopen(runtime.save(history));
  history=runtime.undo(history,['undo.rail.cover','undo.rail.base']);
  assert.equal(find(history.document,'extrude.rail.base').payload.thicknessMm,17);
  assert.equal(find(history.document,'extrude.rail.cover').payload.thicknessMm,9);
  history=runtime.redo(history,['redo.rail.base','redo.rail.cover']);
  assert.equal(find(history.document,'extrude.rail.base').payload.thicknessMm,oldBase);
  assert.equal(find(history.document,'extrude.rail.cover').payload.thicknessMm,oldCover);
  assert.equal(find(history.document,'extrude.rail.gauge').payload.thicknessMm,5);
  return {
    format:'intuit3d.feature-history-batch-example',
    bodyActions,singleUndoFrame,archiveUndoRedo:true,
    recoveredSelectionAfterRuntimeEdit:true,
    preservedLaterDatum:true,preservedGauge:true,
    requiresNativeRebuild:preview.requiresNativeRebuild,
    exactGeometryAuthority:false,nativeSTEP:'not_executed',
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runDualRailHistoryBatch(),null,2)+'\n');
