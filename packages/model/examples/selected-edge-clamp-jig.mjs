/**
 * Real SKETCH + FEATUREOPS + INTENT + RUNTIME dual-body clamp-jig authoring.
 * Selected edge is durable *intent*, not an observed kernel role. A physical
 * off-edge hole, B-rep validation and STEP still require provider admission.
 *
 * node --experimental-strip-types packages/model/examples/selected-edge-clamp-jig.mjs
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
  SELECTED_EDGE_CUT_FORMAT, commitUndoableSelectedEdgeCut,inspectSelectedEdgeCut,
} from '@intuit3d/model/selected-edge-cut';
import {BODY_CUT_CHAIN_FORMAT} from '@intuit3d/model/body-cut-chain';
import {TOPOLOGY_REFERENCE_FORMAT} from '@intuit3d/model/topology';
import {planIncrementalEvaluation} from '@intuit3d/model/incremental';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const hole=(id,xMm,yMm,radiusMm)=>({id,xMm,yMm,radiusMm});
function flange(history,id,widthMm,depthMm,thicknessMm,holes) {
  return featureops.authorMountingFlange(history,{
    format:featureops.FEATURE_OPS_FORMAT,version:1,
    eventId:'author.'+id,expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
    cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,thicknessMm,
    spec:{units:'mm',frame:'local_centered_xy',widthMm,depthMm,holes},
  },{runtime,model,sketch,discovery}).history;
}
export function runSelectedEdgeClampJig(){
  let history=transactions.startUndoHistory(model.newProject('project.clamp.jig.assembly'));
  history=flange(history,'clamp',108,62,12,[
    hole('bolt.left',-38,0,3),hole('bolt.right',38,0,3)]);
  history=flange(history,'datum',136,22,4,[
    hole('pin.left',-47,0,2.5),hole('pin.right',47,0,2.5)]);
  history=flange(history,'shim',28,16,2,[hole('pilot',0,0,1.5)]);
  const clampSketch=model.featuresOf(history.document)
    .find(f=>f.id==='sketch.clamp').payload.sketch;
  const candidates=discovery.discoverPlateProfiles(clampSketch);
  assert.equal(candidates.status,'ready');
  assert.equal(candidates.candidates.length,1);
  const ref={format:TOPOLOGY_REFERENCE_FORMAT,version:1,
    projectId:history.document.projectId,atRevision:history.document.revision,
    anchor:{featureId:'cut.datum',roleId:'edge.datum.outside',
      kind:'edge'}};
  history=commitUndoableSelectedEdgeCut(history,{
    format:SELECTED_EDGE_CUT_FORMAT,version:1,
    cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
      expectedProjectId:history.document.projectId,
      expectedRevision:history.document.revision,
      eventId:'cut.clamp.edge.create',cutFeatureId:'cut.clamp.edge',
      targetBodyId:'body.clamp',afterBodyWriterId:'cut.clamp',
      sourceSketchId:'sketch.clamp',
      profileCandidateId:candidates.candidates[0].id,
      extent:{kind:'blind',depthMm:5},admission:'require_ready'},
    origin:{bodyId:'body.datum',bodyWriterId:'cut.datum',reference:ref},
  });
  const chosen=inspectSelectedEdgeCut(history.document,'cut.clamp.edge','body.clamp');
  assert.equal(chosen.modelStatus,'ready');
  assert.equal(chosen.placementStatus,'pending_evidence');
  const report=runtime.inspect(history);
  assert.equal(report.features.find(x=>x.featureId==='sketch.clamp').status,
    'analytic_profile_only');
  assert.equal(report.features.find(x=>x.featureId==='extrude.clamp').status,
    'preview_only');
  // The source datum's cut is pending exact; downstream placement cannot
  // be advertised as a ready physical hole. This is an honest runtime gate.
  assert.notEqual(report.features.find(x=>x.featureId==='cut.clamp.edge').status,
    'preview_only');
  const before=history.document;
  history=runtime.commit(history,[{eventId:'retrospective.datum.width',
    type:'feature.edit',featureId:'sketch.datum',patch:{
      payload:{...model.featuresOf(history.document)
        .find(f=>f.id==='sketch.datum').payload,
        sketch:featureops.mountingFlangeSketch({
          units:'mm',frame:'local_centered_xy',widthMm:150,depthMm:22,
          holes:[hole('pin.left',-47,0,2.5),hole('pin.right',47,0,2.5)],
        },sketch,discovery).sketch},
    }}],history.document.revision);
  const delta=planIncrementalEvaluation(before,history.document);
  assert.ok(delta.invalidatedFeatureIds.includes('cut.clamp.edge'));
  assert.ok(delta.unchangedReady.includes('extrude.shim'));
  const reopened=runtime.reopen(runtime.save(history));
  assert.equal(inspectSelectedEdgeCut(reopened.document,
    'cut.clamp.edge','body.clamp').placementStatus,'pending_evidence');
  const undo=runtime.undo(reopened,['undo.datum.width']);
  const redo=runtime.redo(undo,['redo.datum.width']);
  assert.equal(model.featuresOf(redo.document).find(f=>f.id==='cut.clamp.edge')
    .payload.selectedEdge.anchor.roleId,'edge.datum.outside');
  return {
    projectId:redo.document.projectId,revision:redo.document.revision,
    independentBodies:['body.clamp','body.datum','body.shim'],
    changedSourceBody:'body.datum',dependentSelectedEdgeCut:'cut.clamp.edge',
    structuralInvalidation:delta.readyToEvaluate,
    stableSelection:true,archiveUndoRedo:true,sketchAdmitted:true,
    runtimeCutStatus:runtime.inspect(redo).features
      .find(x=>x.featureId==='cut.clamp.edge').status,
    topologyEvidence:'required',nativeExact:false,independentSTEP:false,
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runSelectedEdgeClampJig(),null,2)+'\n');
