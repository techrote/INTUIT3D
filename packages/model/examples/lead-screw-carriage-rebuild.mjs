/**
 * Distinct authored lead-screw carriage / end-stop / inspection gauge. The
 * carriage bore references a semantic edge of the end-stop body, so editing
 * the end-stop sketch invalidates TWO bodies while leaving the gauge alone.
 * Uses accepted SKETCH, FEATUREOPS and RUNTIME typed contracts. This is a
 * semantic replay demo, NOT a kernel edge-placement or STEP validation.
 *
 * node packages/model/examples/lead-screw-carriage-rebuild.mjs
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
  SELECTED_EDGE_CUT_FORMAT, commitUndoableSelectedEdgeCut,
} from '@intuit3d/model/selected-edge-cut';
import {BODY_CUT_CHAIN_FORMAT} from '@intuit3d/model/body-cut-chain';
import {TOPOLOGY_REFERENCE_FORMAT} from '@intuit3d/model/topology';
import {
  BODY_REBUILD_MANIFEST_FORMAT, planBodyRebuildManifest,
} from '@intuit3d/model/body-rebuild-manifest';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const hole=(id,xMm,yMm,radiusMm)=>({id,xMm,yMm,radiusMm});
const parts={
  carriage:{widthMm:94,depthMm:36,thicknessMm:12,
    holes:[hole('carriage.left',-28,0,3),hole('carriage.right',28,0,3)]},
  endstop:{widthMm:42,depthMm:32,thicknessMm:8,
    holes:[hole('stop.mount',0,0,3)]},
  gauge:{widthMm:68,depthMm:14,thicknessMm:3,
    holes:[hole('gauge.left',-20,0,2),hole('gauge.right',20,0,2)]},
};
const flange=(history,id,spec)=>featureops.authorMountingFlange(history,{
  format:featureops.FEATURE_OPS_FORMAT,version:1,
  eventId:'author.'+id,expectedRevision:history.document.revision,
  sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
  cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,
  thicknessMm:spec.thicknessMm,
  spec:{units:'mm',frame:'local_centered_xy',
    widthMm:spec.widthMm,depthMm:spec.depthMm,holes:spec.holes},
},{runtime,model,sketch,discovery}).history;
const feature=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
const reference=(doc)=>({
  format:TOPOLOGY_REFERENCE_FORMAT,version:1,
  projectId:doc.projectId,atRevision:doc.revision,
  anchor:{featureId:'cut.endstop',roleId:'edge.endstop.outer',kind:'edge'},
});
const request=(before,after)=>({
  format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
  expectedProjectId:before.projectId,
  expectedFromRevision:before.revision,expectedToRevision:after.revision,
  bodyIds:['body.carriage','body.endstop','body.gauge'],
});

export function runLeadScrewCarriageRebuild(){
  let history=transactions.startUndoHistory(
    model.newProject('project.lead.screw.carriage'));
  for(const id of ['carriage','endstop','gauge'])
    history=flange(history,id,parts[id]);
  const doc=history.document;
  const profiles=discovery.discoverPlateProfiles(feature(doc,'sketch.carriage')
    .payload.sketch);
  assert.equal(profiles.status,'ready');
  assert.equal(profiles.candidates.length,1);
  history=commitUndoableSelectedEdgeCut(history,{
    format:SELECTED_EDGE_CUT_FORMAT,version:1,
    cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
      expectedProjectId:doc.projectId,expectedRevision:doc.revision,
      eventId:'create.cut.carriage.stop',
      cutFeatureId:'cut.carriage.stop',targetBodyId:'body.carriage',
      afterBodyWriterId:'cut.carriage',sourceSketchId:'sketch.carriage',
      profileCandidateId:profiles.candidates[0].id,
      extent:{kind:'blind',depthMm:5},admission:'require_ready'},
    origin:{bodyId:'body.endstop',bodyWriterId:'cut.endstop',
      reference:reference(doc)},
  });
  const before=history.document;
  const nextSpec={...parts.endstop,widthMm:52};
  history=runtime.commit(history,[{
    eventId:'edit.endstop.width',type:'feature.edit',
    featureId:'sketch.endstop',patch:{payload:{
      ...feature(before,'sketch.endstop').payload,
      sketch:featureops.mountingFlangeSketch({
        units:'mm',frame:'local_centered_xy',
        widthMm:nextSpec.widthMm,depthMm:nextSpec.depthMm,
        holes:nextSpec.holes,
      },sketch,discovery).sketch,
    }},
  }],before.revision);
  const after=history.document;
  const manifest=planBodyRebuildManifest(before,after,request(before,after));
  assert.deepEqual(manifest.bodies.map(b=>b.action),
    ['rebuild','rebuild','preserve_candidate']);
  const carriage=manifest.bodies[0];
  assert.ok(carriage.externalInputFeatureIds.includes('cut.endstop'));
  assert.ok(carriage.invalidatedExternalInputIds.includes('cut.endstop'));
  assert.ok(carriage.invalidatedWriterIds.includes('cut.carriage.stop'));
  assert.ok(!carriage.invalidatedWriterIds.includes('cut.carriage'));
  assert.equal(manifest.exactGeometryAuthority,false);

  const reopened=runtime.reopen(runtime.save(history));
  const undone=runtime.undo(reopened,['undo.endstop.width']);
  assert.deepEqual(model.featuresOf(undone.document)
    .find(f=>f.id==='sketch.endstop').payload,
    feature(before,'sketch.endstop').payload);
  const redone=runtime.redo(undone,['redo.endstop.width']);
  assert.deepEqual(feature(redone.document,'sketch.endstop').payload,
    feature(after,'sketch.endstop').payload);
  return {
    projectId:after.projectId,fromRevision:before.revision,
    toRevision:after.revision,
    actions:manifest.bodies.map(b=>[b.bodyId,b.action]),
    carriageDirty:carriage.invalidatedWriterIds,
    selectedEdgeNeedsProvider:true,
    archiveUndoRedo:true,exactGeometryAuthority:false,
    independentSTEP:false,
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runLeadScrewCarriageRebuild(),null,2)+'\n');
