/**
 * Servo gearbox mounting plate with an intentional two-operation machining
 * block, retained across cross-body source references and journal undo/reopen.
 * Uses accepted SKETCH, FEATUREOPS and RUNTIME APIs. Model-ready does not
 * prove a physical Boolean or a native STEP file.
 *
 * node --experimental-strip-types packages/model/examples/servo-mount-cut-block-relocate.mjs
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
  BODY_CUT_CHAIN_FORMAT, commitUndoableBodyCutAppend, inspectBodyCutChain,
} from '@intuit3d/model/body-cut-chain';
import {
  SELECTED_EDGE_CUT_FORMAT, commitUndoableSelectedEdgeCut,
} from '@intuit3d/model/selected-edge-cut';
import {TOPOLOGY_REFERENCE_FORMAT} from '@intuit3d/model/topology';
import {
  BODY_CUT_BLOCK_RELOCATE_FORMAT, previewBodyCutBlockRelocate,
  commitUndoableBodyCutBlockRelocate, inspectBodyCutBlockDestinations,
} from '@intuit3d/model/body-cut-block-relocate';
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '@intuit3d/model/body-rebuild-manifest';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const hole=(id,xMm,yMm,radiusMm)=>({id,xMm,yMm,radiusMm});
const find=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
const specs={
  mount:{widthMm:92,depthMm:64,thicknessMm:14,holes:[
    hole('mount.top.left',-34,-23,3),hole('mount.top.right',34,-23,3),
    hole('mount.bottom.left',-34,23,3),hole('mount.bottom.right',34,23,3),
  ]},
  bracket:{widthMm:110,depthMm:34,thicknessMm:8,holes:[
    hole('bracket.left',-38,0,3),hole('bracket.right',38,0,3),
  ]},
  gauge:{widthMm:44,depthMm:12,thicknessMm:3,holes:[
    hole('gauge.left',-14,0,2),hole('gauge.right',14,0,2),
  ]},
};
function author(history,id,spec){
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
const bores=[
  {id:'shaft',xMm:0,yMm:0,radiusMm:11,extent:{kind:'through_all'}},
  {id:'counterbore',xMm:0,yMm:0,radiusMm:14,extent:{kind:'blind',depthMm:3}},
  {id:'cable',xMm:28,yMm:0,radiusMm:6,extent:{kind:'through_all'}},
  {id:'relief',xMm:-25,yMm:0,radiusMm:7,extent:{kind:'blind',depthMm:8}},
];
function appendCut(history,bore){
  const authored=featureops.mountingFlangeSketch({
    units:'mm',frame:'local_centered_xy',
    widthMm:92,depthMm:64,holes:[hole('profile.'+bore.id,bore.xMm,bore.yMm,bore.radiusMm)],
  },sketch,discovery);
  const profiles=discovery.discoverPlateProfiles(authored.sketch);
  assert.equal(profiles.status,'ready');
  assert.equal(profiles.candidates.length,1);
  history=runtime.commit(history,[{
    type:'feature.create',eventId:'create.sketch.'+bore.id,
    feature:{id:'sketch.'+bore.id,kind:'sketch',dependsOn:[],
      writeTargets:['sketch.'+bore.id+'.geometry'],
      payload:{sketch:authored.sketch}},
  }],history.document.revision);
  const terminal=inspectBodyCutChain(history.document,'body.mount');
  assert.equal(terminal.status,'ready');
  return commitUndoableBodyCutAppend(history,{
    format:BODY_CUT_CHAIN_FORMAT,version:1,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'create.cut.'+bore.id,cutFeatureId:'cut.'+bore.id,
    targetBodyId:'body.mount',afterBodyWriterId:terminal.eligibleAfterWriterId,
    sourceSketchId:'sketch.'+bore.id,
    profileCandidateId:profiles.candidates[0].id,
    extent:bore.extent,admission:'require_ready',
  });
}
export function runServoMountCutBlockRelocate(){
  let history=transactions.startUndoHistory(
    model.newProject('project.servo.gearbox.mount'));
  for(const id of ['mount','bracket','gauge'])
    history=author(history,id,specs[id]);
  for(const bore of bores) history=appendCut(history,bore);
  const sourced=history.document;
  const bracketProfiles=discovery.discoverPlateProfiles(
    find(sourced,'sketch.bracket').payload.sketch);
  assert.equal(bracketProfiles.status,'ready');
  history=commitUndoableSelectedEdgeCut(history,{
    format:SELECTED_EDGE_CUT_FORMAT,version:1,
    cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
      expectedProjectId:sourced.projectId,expectedRevision:sourced.revision,
      eventId:'create.cut.bracket.datum',cutFeatureId:'cut.bracket.datum',
      targetBodyId:'body.bracket',afterBodyWriterId:'cut.bracket',
      sourceSketchId:'sketch.bracket',
      profileCandidateId:bracketProfiles.candidates[0].id,
      extent:{kind:'blind',depthMm:5},admission:'require_ready'},
    origin:{bodyId:'body.mount',bodyWriterId:'cut.relief',
      reference:{format:TOPOLOGY_REFERENCE_FORMAT,version:1,
        projectId:sourced.projectId,atRevision:sourced.revision,
        anchor:{kind:'edge',featureId:'cut.relief',roleId:'edge.mount.relief'}}},
  });
  const before=history.document;
  const selection={
    format:BODY_CUT_BLOCK_RELOCATE_FORMAT,version:1,
    expectedProjectId:before.projectId,expectedRevision:before.revision,
    expectedDocumentFence:model.serializeProject(before),
    targetBodyId:'body.mount',cutFeatureIds:['cut.shaft','cut.counterbore'],
  };
  const choices=inspectBodyCutBlockDestinations(before,{
    ...selection,offset:0,limit:16,
  });
  const destination=choices.destinations.find(row=>
    row.afterBodyWriterId==='cut.relief');
  assert.equal(destination.eligibility,'available');
  assert.equal(destination.requiredEventIds,2);
  const request={
    ...selection,afterBodyWriterId:destination.afterBodyWriterId,
    eventIds:['move.cut.cable','move.cut.shaft'],
  };
  const preview=previewBodyCutBlockRelocate(before,request);
  assert.deepEqual(preview.writerOrderAfter,[
    'extrude.mount','cut.mount','cut.cable','cut.relief',
    'cut.shaft','cut.counterbore',
  ]);
  assert.deepEqual(preview.invalidatedBodyIds,['body.mount','body.bracket']);
  history=commitUndoableBodyCutBlockRelocate(history,request);
  const after=history.document;
  const manifest=planBodyRebuildManifest(before,after,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:before.projectId,expectedFromRevision:before.revision,
    expectedToRevision:after.revision,
    bodyIds:['body.mount','body.bracket','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(row=>row.action),
    ['rebuild','rebuild','preserve_candidate']);
  const reopened=runtime.reopen(runtime.save(history));
  const undone=runtime.undo(reopened,['undo.move.shaft','undo.move.cable']);
  for(const id of ['cut.shaft','cut.counterbore','cut.cable','cut.relief']){
    assert.deepEqual(find(undone.document,id).dependsOn,
      find(before,id).dependsOn);
  }
  history=runtime.redo(undone,['redo.move.cable','redo.move.shaft']);
  for(const id of ['cut.shaft','cut.counterbore','cut.cable','cut.relief']){
    assert.deepEqual(find(history.document,id).dependsOn,
      find(after,id).dependsOn);
  }
  const current=history.document;
  const updated={...specs.mount,widthMm:102};
  history=runtime.commit(history,[{
    eventId:'edit.mount.width',type:'feature.edit',featureId:'sketch.mount',
    patch:{payload:{
      ...find(current,'sketch.mount').payload,
      sketch:featureops.mountingFlangeSketch({
        units:'mm',frame:'local_centered_xy',
        widthMm:updated.widthMm,depthMm:updated.depthMm,holes:updated.holes,
      },sketch,discovery).sketch,
    }},
  }],current.revision);
  const replay=planBodyRebuildManifest(current,history.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:current.projectId,expectedFromRevision:current.revision,
    expectedToRevision:history.document.revision,
    bodyIds:['body.mount','body.bracket','body.gauge'],
  });
  assert.deepEqual(replay.bodies.map(row=>row.action),
    ['rebuild','rebuild','preserve_candidate']);
  return {
    format:'intuit3d.body-cut-block-relocate-demo',version:1,
    movedCutIds:selection.cutFeatureIds,
    writerOrderBefore:preview.writerOrderBefore,
    writerOrderAfter:preview.writerOrderAfter,
    invalidatedBodyIds:preview.invalidatedBodyIds,
    bodyActions:manifest.bodies.map(row=>row.action),
    retrospectiveRebuild:replay.bodies.map(row=>row.action),
    archiveUndoRedo:true,exactGeometryAuthority:false,
    nativeSTEP:'not_executed',
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runServoMountCutBlockRelocate(),null,2)+'\n');
