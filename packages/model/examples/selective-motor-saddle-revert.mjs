/**
 * Modular motor saddle, datum-referenced clamp and independent gauge.
 * A past motor-sketch width edit is selectively reverted after an unrelated
 * gauge edit, preserving journal history and cross-body invalidation.
 * This is genuine SKETCH/FEATUREOPS/RUNTIME authoring, not exact B-rep/STEP.
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
import {BODY_CUT_CHAIN_FORMAT} from '@intuit3d/model/body-cut-chain';
import {SELECTED_EDGE_CUT_FORMAT,commitUndoableSelectedEdgeCut}
  from '@intuit3d/model/selected-edge-cut';
import {TOPOLOGY_REFERENCE_FORMAT} from '@intuit3d/model/topology';
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '@intuit3d/model/body-rebuild-manifest';
import {FEATURE_EDIT_REVERT_FORMAT,previewFeatureEditRevert,
  commitUndoableFeatureEditRevert} from '@intuit3d/model/feature-edit-revert';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const spec={
  motor:{widthMm:94,depthMm:52,thicknessMm:11,holes:[
    {id:'motor.left',xMm:-28,yMm:0,radiusMm:4},
    {id:'motor.right',xMm:28,yMm:0,radiusMm:4}]},
  clamp:{widthMm:68,depthMm:34,thicknessMm:7,holes:[
    {id:'clamp.left',xMm:-19,yMm:0,radiusMm:3},
    {id:'clamp.right',xMm:19,yMm:0,radiusMm:3}]},
  gauge:{widthMm:42,depthMm:14,thicknessMm:3,holes:[
    {id:'gauge.left',xMm:-14,yMm:0,radiusMm:2},
    {id:'gauge.right',xMm:14,yMm:0,radiusMm:2}]},
};
const find=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
const sketchFor=(s)=>featureops.mountingFlangeSketch({
  units:'mm',frame:'local_centered_xy',
  widthMm:s.widthMm,depthMm:s.depthMm,holes:s.holes,
},sketch,discovery).sketch;
function author(history,id){
  const s=spec[id];
  return featureops.authorMountingFlange(history,{
    format:featureops.FEATURE_OPS_FORMAT,version:1,
    eventId:'author.'+id,expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
    cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,
    thicknessMm:s.thicknessMm,
    spec:{units:'mm',frame:'local_centered_xy',
      widthMm:s.widthMm,depthMm:s.depthMm,holes:s.holes},
  },{runtime,model,sketch,discovery}).history;
}
export function runSelectiveMotorSaddleRevert(){
  let history=transactions.startUndoHistory(
    model.newProject('project.modular.motor.saddle'));
  for(const id of ['motor','clamp','gauge']) history=author(history,id);
  const authored=history.document;
  const profiles=discovery.discoverPlateProfiles(
    find(authored,'sketch.clamp').payload.sketch);
  assert.equal(profiles.status,'ready');
  assert.equal(profiles.candidates.length,1);
  history=commitUndoableSelectedEdgeCut(history,{
    format:SELECTED_EDGE_CUT_FORMAT,version:1,
    cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
      expectedProjectId:authored.projectId,expectedRevision:authored.revision,
      eventId:'create.cut.clamp.datum',cutFeatureId:'cut.clamp.datum',
      targetBodyId:'body.clamp',afterBodyWriterId:'cut.clamp',
      sourceSketchId:'sketch.clamp',profileCandidateId:profiles.candidates[0].id,
      extent:{kind:'blind',depthMm:4},admission:'require_ready'},
    origin:{bodyId:'body.motor',bodyWriterId:'cut.motor',
      reference:{format:TOPOLOGY_REFERENCE_FORMAT,version:1,
        projectId:authored.projectId,atRevision:authored.revision,
        anchor:{kind:'edge',featureId:'cut.motor',roleId:'edge.motor.datum'}}},
  });
  const originalMotor=find(history.document,'sketch.motor').payload;
  const expanded={...spec.motor,widthMm:108};
  const beforeWidthEdit=history.document;
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.motor.width',featureId:'sketch.motor',
    patch:{payload:{...originalMotor,sketch:sketchFor(expanded)}},
  }],beforeWidthEdit.revision);
  const beforeGaugeEdit=history.document;
  history=runtime.commit(history,[{
    type:'feature.edit',eventId:'edit.gauge.width',featureId:'sketch.gauge',
    patch:{payload:{
      ...find(beforeGaugeEdit,'sketch.gauge').payload,
      sketch:sketchFor({...spec.gauge,widthMm:50}),
    }},
  }],beforeGaugeEdit.revision);
  const prior=history.document;
  const req={
    format:FEATURE_EDIT_REVERT_FORMAT,version:1,
    expectedProjectId:prior.projectId,expectedRevision:prior.revision,
    expectedDocumentFence:model.serializeProject(prior),
    targetEventId:'edit.motor.width',eventId:'revert.motor.width',
    admission:'require_ready',confirmUnresolved:false,
  };
  const preview=previewFeatureEditRevert(prior,req);
  assert.deepEqual(preview.invalidatedBodyIds,['body.motor','body.clamp']);
  history=commitUndoableFeatureEditRevert(history,req);
  assert.deepEqual(find(history.document,'sketch.motor').payload,originalMotor);
  const manifest=planBodyRebuildManifest(prior,history.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:prior.projectId,
    expectedFromRevision:prior.revision,
    expectedToRevision:history.document.revision,
    bodyIds:['body.motor','body.clamp','body.gauge'],
  });
  const actions=manifest.bodies.map(x=>x.action);
  assert.deepEqual(actions,['rebuild','rebuild','preserve_candidate']);
  history=runtime.reopen(runtime.save(history));
  history=runtime.undo(history,['undo.motor.width.revert']);
  assert.deepEqual(find(history.document,'sketch.motor').payload.sketch,sketchFor(expanded));
  history=runtime.redo(history,['redo.motor.width.revert']);
  assert.deepEqual(find(history.document,'sketch.motor').payload,originalMotor);
  assert.deepEqual(find(history.document,'sketch.gauge').payload.sketch,
    sketchFor({...spec.gauge,widthMm:50}));
  return {
    format:'intuit3d.feature-edit-revert-demo',bodyActions:actions,
    revertedFeatureId:'sketch.motor',preservedIndependentEdit:true,
    archiveUndoRedo:true,requiresNativeRebuild:true,
    exactGeometryAuthority:false,nativeSTEP:'not_executed',
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runSelectiveMotorSaddleRevert(),null,2)+'\n');
