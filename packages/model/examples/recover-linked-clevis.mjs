/**
 * Linked clevis with a cross-body selected-edge mounting cut, repaired from
 * tombstoned semantic ancestors in one user-confirmed transaction.
 *
 * Executable real SKETCH / FEATUREOPS / RUNTIME contracts, not a native
 * edge placement, physical Boolean, geometric topology or STEP proof.
 *
 * node --experimental-strip-types packages/model/examples/recover-linked-clevis.mjs
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
import { SELECTED_EDGE_CUT_FORMAT, commitUndoableSelectedEdgeCut }
  from '@intuit3d/model/selected-edge-cut';
import { BODY_CUT_CHAIN_FORMAT } from '@intuit3d/model/body-cut-chain';
import { TOPOLOGY_REFERENCE_FORMAT } from '@intuit3d/model/topology';
import {
  FEATURE_LIFECYCLE_FORMAT, inspectFeatureRemoval, commitUndoableFeatureRemoval,
} from '@intuit3d/model/feature-lifecycle';
import {
  FEATURE_RECOVERY_CLOSURE_FORMAT, inspectFeatureRecoveryClosure,
  commitUndoableFeatureRecoveryClosure,
} from '@intuit3d/model/feature-recovery-closure';
import {
  BODY_REBUILD_MANIFEST_FORMAT, planBodyRebuildManifest,
} from '@intuit3d/model/body-rebuild-manifest';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const partSpecs={
  lug:{widthMm:98,depthMm:44,thicknessMm:12,
    holes:[{id:'lug.left',xMm:-30,yMm:0,radiusMm:4},{id:'lug.right',xMm:30,yMm:0,radiusMm:4}]},
  datum:{widthMm:46,depthMm:28,thicknessMm:9,
    holes:[{id:'datum.locate',xMm:0,yMm:0,radiusMm:3}]},
  shim:{widthMm:54,depthMm:16,thicknessMm:3,
    holes:[{id:'shim.left',xMm:-14,yMm:0,radiusMm:2},{id:'shim.right',xMm:14,yMm:0,radiusMm:2}]},
};
function author(history,id,spec) {
  return featureops.authorMountingFlange(history,{
    format:featureops.FEATURE_OPS_FORMAT,version:1,
    eventId:'author.'+id,expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
    cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,
    thicknessMm:spec.thicknessMm,
    spec:{units:'mm',frame:'local_centered_xy',
      widthMm:spec.widthMm,depthMm:spec.depthMm,holes:spec.holes},
  },{runtime,model,sketch,discovery}).history;
}
const feature=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
const documentFence=(doc)=>model.serializeProject(doc);

export function runRecoveryClevis() {
  let history=transactions.startUndoHistory(
    model.newProject('project.linked.clevis.recovery'));
  for(const id of ['lug','datum','shim']) history=author(history,id,partSpecs[id]);
  const base=history.document;
  const candidates=discovery.discoverPlateProfiles(feature(base,'sketch.lug').payload.sketch);
  assert.equal(candidates.status,'ready');
  assert.equal(candidates.candidates.length,1);
  history=commitUndoableSelectedEdgeCut(history,{
    format:SELECTED_EDGE_CUT_FORMAT,version:1,
    cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
      expectedProjectId:base.projectId,expectedRevision:base.revision,
      eventId:'create.cut.lug.datum',cutFeatureId:'cut.lug.datum',
      targetBodyId:'body.lug',afterBodyWriterId:'cut.lug',
      sourceSketchId:'sketch.lug',profileCandidateId:candidates.candidates[0].id,
      extent:{kind:'blind',depthMm:6},admission:'require_ready'},
    origin:{bodyId:'body.datum',bodyWriterId:'cut.datum',
      reference:{format:TOPOLOGY_REFERENCE_FORMAT,version:1,
        projectId:base.projectId,atRevision:base.revision,
        anchor:{featureId:'cut.datum',roleId:'edge.datum.outer',kind:'edge'}}},
  });
  const beforeRemoval=history.document;
  const impact=inspectFeatureRemoval(beforeRemoval,'extrude.datum');
  assert.ok(impact.transitiveDependents.includes('cut.datum'));
  assert.ok(impact.transitiveDependents.includes('cut.lug.datum'));
  history=commitUndoableFeatureRemoval(history,{
    format:FEATURE_LIFECYCLE_FORMAT,version:1,action:'remove',
    expectedProjectId:beforeRemoval.projectId,expectedRevision:beforeRemoval.revision,
    featureId:'extrude.datum',mode:'cascade_descendants',confirmCascade:true,
    eventIds:impact.cascadeIds.map((_,i)=>'delete.datum.'+i),
  });
  const deleted=history.document;
  const selection=['cut.lug.datum'];
  const inspect={
    format:FEATURE_RECOVERY_CLOSURE_FORMAT,version:1,
    expectedProjectId:deleted.projectId,expectedRevision:deleted.revision,
    expectedDocumentFence:documentFence(deleted),selectedFeatureIds:selection,
  };
  const inventory=inspectFeatureRecoveryClosure(deleted,inspect);
  assert.deepEqual(inventory.requiredFeatureIds,
    ['extrude.datum','cut.datum','cut.lug.datum']);
  assert.equal(inventory.canRequireReady,true);
  history=commitUndoableFeatureRecoveryClosure(history,{
    ...inspect,
    eventIds:inventory.requiredFeatureIds.map((_,i)=>'recover.datum.'+i),
    admission:'require_ready',confirmAncestorRestore:true,confirmUnresolved:false,
  });
  assert.ok(model.planProject(history.document).features.every(row=>row.status==='ready'));
  let reopened=runtime.reopen(runtime.save(history));
  assert.deepEqual(model.featuresOf(reopened.document).find(f=>f.id==='cut.lug.datum').payload,
    feature(beforeRemoval,'cut.lug.datum').payload);
  reopened=runtime.undo(reopened,
    ['undo.cut.lug.datum','undo.cut.datum','undo.extrude.datum']);
  assert.ok(!model.featuresOf(reopened.document).some(f=>f.id==='cut.lug.datum'));
  reopened=runtime.redo(reopened,
    ['redo.extrude.datum','redo.cut.datum','redo.cut.lug.datum']);
  assert.ok(model.featuresOf(reopened.document).some(f=>f.id==='cut.lug.datum'));
  const beforeEdit=reopened.document;
  const edited={...partSpecs.datum,widthMm:52};
  reopened=runtime.commit(reopened,[{
    eventId:'edit.datum.sketch.width',type:'feature.edit',
    featureId:'sketch.datum',patch:{payload:{
      ...feature(beforeEdit,'sketch.datum').payload,
      sketch:featureops.mountingFlangeSketch({
        units:'mm',frame:'local_centered_xy',
        widthMm:edited.widthMm,depthMm:edited.depthMm,holes:edited.holes,
      },sketch,discovery).sketch,
    }},
  }],beforeEdit.revision);
  const current=reopened.document;
  const manifest=planBodyRebuildManifest(beforeEdit,current,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:beforeEdit.projectId,expectedFromRevision:beforeEdit.revision,
    expectedToRevision:current.revision,
    bodyIds:['body.lug','body.datum','body.shim'],
  });
  const actions=Object.fromEntries(manifest.bodies.map(row=>[row.bodyId,row.action]));
  assert.deepEqual(actions,{
    'body.lug':'rebuild','body.datum':'rebuild','body.shim':'preserve_candidate',
  });
  return {
    restoredFeatureIds:inventory.requiredFeatureIds,
    recoveredReady:model.planProject(history.document).features.every(row=>row.status==='ready'),
    bodyActions:actions,archiveUndoRedo:true,
    selectedEdgeRequiresProvider:true,exactGeometryAuthority:false,
    independentSTEP:false,
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runRecoveryClevis(),null,2)+'\n');
