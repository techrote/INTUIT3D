/**
 * Hydraulic manifold and separate saddle/gauge, authored through real
 * SKETCH, FEATUREOPS and RUNTIME public contracts. Relocates the mounting
 * hole cut past two oil-channel cuts in ONE model-owned undo frame, then
 * retires cross-body provider candidates without inventing exact B-reps.
 *
 * node --experimental-strip-types packages/model/examples/hydraulic-manifold-cut-relocate.mjs
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
  BODY_CUT_CHAIN_FORMAT,commitUndoableBodyCutAppend,
  inspectBodyCutChain,
} from '@intuit3d/model/body-cut-chain';
import {
  SELECTED_EDGE_CUT_FORMAT,commitUndoableSelectedEdgeCut,
  inspectSelectedEdgeCut,
} from '@intuit3d/model/selected-edge-cut';
import {
  BODY_CUT_RELOCATE_FORMAT,previewBodyCutRelocate,
  commitUndoableBodyCutRelocate,
} from '@intuit3d/model/body-cut-relocate';
import {
  BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest,
} from '@intuit3d/model/body-rebuild-manifest';
import {TOPOLOGY_REFERENCE_FORMAT} from '@intuit3d/model/topology';
import {planIncrementalEvaluation} from '@intuit3d/model/incremental';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const hole=(id,xMm,yMm,radiusMm)=>({id,xMm,yMm,radiusMm});
function flange(history,id,widthMm,depthMm,thicknessMm,holes){
  return featureops.authorMountingFlange(history,{
    format:featureops.FEATURE_OPS_FORMAT,version:1,
    eventId:'author.'+id,expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
    cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,thicknessMm,
    spec:{units:'mm',frame:'local_centered_xy',widthMm,depthMm,holes},
  },{runtime,model,sketch,discovery}).history;
}
const find=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
const traceWriters=(doc,bodyId)=>inspectBodyCutChain(doc,bodyId);
const boreSpec={
  oil:{widthMm:104,depthMm:54,holes:[hole('inlet.port',-26,0,4)]},
  valve:{widthMm:104,depthMm:54,holes:[hole('spool.port',5,0,5)]},
  drain:{widthMm:104,depthMm:54,holes:[hole('drain.port',31,0,3)]},
};

/** Three distinct, solver-admitted authored sketch sources and cut extents. */
function appendBore(history,id,extent){
  const authored=featureops.mountingFlangeSketch({
    units:'mm',frame:'local_centered_xy',...boreSpec[id],
  },sketch,discovery);
  const profiles=discovery.discoverPlateProfiles(authored.sketch);
  assert.equal(profiles.status,'ready');
  assert.equal(profiles.candidates.length,1);
  history=runtime.commit(history,[{
    type:'feature.create',eventId:'create.sketch.'+id,
    feature:{id:'sketch.'+id,kind:'sketch',dependsOn:[],
      writeTargets:['sketch.'+id+'.geometry'],payload:{sketch:authored.sketch}},
  }],history.document.revision);
  const terminal=traceWriters(history.document,'body.manifold');
  assert.equal(terminal.status,'ready');
  history=commitUndoableBodyCutAppend(history,{
    format:BODY_CUT_CHAIN_FORMAT,version:1,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'create.cut.'+id,cutFeatureId:'cut.'+id,
    targetBodyId:'body.manifold',
    afterBodyWriterId:terminal.eligibleAfterWriterId,
    sourceSketchId:'sketch.'+id,
    profileCandidateId:profiles.candidates[0].id,extent,
    admission:'require_ready',
  });
  return history;
}

export function runHydraulicManifoldCutRelocate(){
  let history=transactions.startUndoHistory(
    model.newProject('project.hydraulic.valve.manifold'));
  const mountingHoles=[
    hole('mount.near',-39,-18,3),
    hole('mount.far',39,18,3),
  ];
  history=flange(history,'manifold',104,54,18,mountingHoles);
  history=flange(history,'saddle',128,34,8,[
    hole('saddle.left',-42,0,3),hole('saddle.right',42,0,3)]);
  history=flange(history,'gauge',52,16,3,[
    hole('gauge.left',-16,0,2),hole('gauge.right',16,0,2)]);
  const baseProfiles=discovery.discoverPlateProfiles(
    find(history.document,'sketch.manifold').payload.sketch);
  assert.equal(baseProfiles.status,'ready');
  assert.equal(baseProfiles.candidates.length,1);
  history=appendBore(history,'oil',{kind:'through_all'});
  history=appendBore(history,'valve',{kind:'blind',depthMm:7});
  history=appendBore(history,'drain',{kind:'through_all'});

  // Saddle placement depends on a named manifold writer and remains pending
  // topology observation rather than claiming a located physical edge.
  const source=history.document;
  const saddleProfiles=discovery.discoverPlateProfiles(
    find(source,'sketch.saddle').payload.sketch);
  assert.equal(saddleProfiles.status,'ready');
  history=commitUndoableSelectedEdgeCut(history,{
    format:SELECTED_EDGE_CUT_FORMAT,version:1,
    cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
      expectedProjectId:source.projectId,expectedRevision:source.revision,
      eventId:'create.cut.saddle.reference',cutFeatureId:'cut.saddle.reference',
      targetBodyId:'body.saddle',afterBodyWriterId:'cut.saddle',
      sourceSketchId:'sketch.saddle',
      profileCandidateId:saddleProfiles.candidates[0].id,
      extent:{kind:'blind',depthMm:6},admission:'require_ready'},
    origin:{bodyId:'body.manifold',bodyWriterId:'cut.drain',
      reference:{format:TOPOLOGY_REFERENCE_FORMAT,version:1,
        projectId:source.projectId,atRevision:source.revision,
        anchor:{kind:'edge',featureId:'cut.drain',roleId:'edge.drain.outlet'}}},
  });
  const before=history.document;
  const request={
    format:BODY_CUT_RELOCATE_FORMAT,version:1,
    expectedProjectId:before.projectId,expectedRevision:before.revision,
    targetBodyId:'body.manifold',cutFeatureId:'cut.manifold',
    afterBodyWriterId:'cut.valve',
    eventIds:['move.cut.oil','move.cut.manifold','move.cut.drain'],
  };
  const preview=previewBodyCutRelocate(before,request);
  assert.deepEqual(preview.writerOrderBefore,
    ['extrude.manifold','cut.manifold','cut.oil','cut.valve','cut.drain']);
  assert.deepEqual(preview.writerOrderAfter,
    ['extrude.manifold','cut.oil','cut.valve','cut.manifold','cut.drain']);
  assert.deepEqual(preview.invalidatedBodyIds,
    ['body.manifold','body.saddle']);
  history=commitUndoableBodyCutRelocate(history,request);
  const after=history.document;
  const manifest=planBodyRebuildManifest(before,after,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:before.projectId,
    expectedFromRevision:before.revision,
    expectedToRevision:after.revision,
    bodyIds:['body.manifold','body.saddle','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(x=>x.action),
    ['rebuild','rebuild','preserve_candidate']);
  assert.equal(manifest.exactGeometryAuthority,false);

  const reopened=runtime.reopen(runtime.save(history));
  const undone=runtime.undo(reopened,[
    'undo.move.drain','undo.move.manifold','undo.move.oil',
  ]);
  for(const id of ['cut.manifold','cut.oil','cut.valve','cut.drain']){
    assert.deepEqual(find(undone.document,id).dependsOn,
      find(before,id).dependsOn);
  }
  history=runtime.redo(undone,[
    'redo.move.oil','redo.move.manifold','redo.move.drain',
  ]);
  for(const id of ['cut.manifold','cut.oil','cut.valve','cut.drain']){
    assert.deepEqual(find(history.document,id).dependsOn,
      find(after,id).dependsOn);
  }
  assert.equal(inspectSelectedEdgeCut(history.document,
    'cut.saddle.reference','body.saddle').placementStatus,'pending_evidence');

  // A real retrospective sketch revision must invalidate both the changed
  // manifold's chain and the dependent saddle, but not the inspection gauge.
  const original=history.document;
  history=runtime.commit(history,[{
    eventId:'edit.manifold.width',type:'feature.edit',
    featureId:'sketch.manifold',patch:{payload:{
      ...find(original,'sketch.manifold').payload,
      sketch:featureops.mountingFlangeSketch({
        units:'mm',frame:'local_centered_xy',
        widthMm:114,depthMm:54,holes:mountingHoles,
      },sketch,discovery).sketch,
    }},
  }],original.revision);
  const delta=planIncrementalEvaluation(original,history.document);
  assert.ok(delta.readyToEvaluate.includes('cut.drain'));
  assert.ok(delta.readyToEvaluate.includes('cut.saddle.reference'));
  assert.ok(delta.unchangedReady.includes('cut.gauge'));
  const reopenedEdit=runtime.reopen(runtime.save(history));
  const runtimeStatus=runtime.inspect(reopenedEdit).features
    .find(f=>f.featureId==='cut.saddle.reference').status;

  return {
    format:'intuit3d.body-cut-relocate-demo',version:1,
    projectId:after.projectId,revision:after.revision,
    admittedSketchProfiles:4,
    writerOrderBefore:preview.writerOrderBefore,
    writerOrderAfter:preview.writerOrderAfter,
    rewiredWriterIds:preview.rewiredWriterIds,
    bodyActions:manifest.bodies.map(row=>row.action),
    invalidatedBodies:preview.invalidatedBodyIds,
    retrospectiveEditReplay:delta.readyToEvaluate,
    independentGaugeCandidate:true,archiveUndoRedo:true,
    selectedEdgeRuntimeStatus:runtimeStatus,
    exactGeometryAuthority:false,nativeSTEP:'not_executed',
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runHydraulicManifoldCutRelocate(),null,2)+'\n');
