/**
 * Two-arm clevis/rail CAD authoring through accepted SKETCH, FEATUREOPS,
 * RUNTIME and INTENT contracts. Both arm bore cuts originally refer to the
 * datum rail's named edge. Replace that reference with an auxiliary setup
 * rail in ONE explicit, revision-fenced and undoable model edit; then edit
 * the new rail's width and verify selective multi-body replay.
 *
 * These are authored edge roles, NOT discovered geometric edge coordinates.
 * Native placement, Boolean solids and independent STEP remain unqualified.
 *
 * node --experimental-strip-types packages/model/examples/dual-arm-datum-recovery.mjs
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
  inspectSelectedEdgeCut,
} from '@intuit3d/model/selected-edge-cut';
import {BODY_CUT_CHAIN_FORMAT} from '@intuit3d/model/body-cut-chain';
import {TOPOLOGY_REFERENCE_FORMAT} from '@intuit3d/model/topology';
import {
  SELECTED_EDGE_BATCH_REBIND_FORMAT, previewSelectedEdgeBatchRebind,
  commitUndoableSelectedEdgeBatchRebind,
} from '@intuit3d/model/selected-edge-batch-rebind';
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
function edgeReference(doc,writer,role){
  return {format:TOPOLOGY_REFERENCE_FORMAT,version:1,
    projectId:doc.projectId,atRevision:doc.revision,
    anchor:{featureId:writer,roleId:role,kind:'edge'}};
}
function selectedCut(doc,arm){
  return model.featuresOf(doc).find(f=>f.id==='cut.'+arm+'.edge');
}
export function runDualArmDatumRecovery(){
  let history=transactions.startUndoHistory(
    model.newProject('project.dual.arm.clevis'));
  history=flange(history,'left',86,28,12,[
    hole('pivot.left',-27,0,3),hole('mount.left',27,0,3)]);
  history=flange(history,'right',86,28,12,[
    hole('pivot.right',-27,0,3),hole('mount.right',27,0,3)]);
  history=flange(history,'datum',138,20,4,[
    hole('pin.datum.left',-52,0,2),hole('pin.datum.right',52,0,2)]);
  history=flange(history,'auxiliary.rail',144,22,4,[
    hole('pin.aux.left',-55,0,2),hole('pin.aux.right',55,0,2)]);

  let admittedProfiles=0;
  for(const arm of ['left','right']){
    const authoredSketch=model.featuresOf(history.document)
      .find(f=>f.id==='sketch.'+arm).payload.sketch;
    const profiles=discovery.discoverPlateProfiles(authoredSketch);
    assert.equal(profiles.status,'ready');
    assert.equal(profiles.candidates.length,1);
    admittedProfiles++;
    history=commitUndoableSelectedEdgeCut(history,{
      format:SELECTED_EDGE_CUT_FORMAT,version:1,
      cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
        expectedProjectId:history.document.projectId,
        expectedRevision:history.document.revision,
        eventId:'create.cut.'+arm+'.edge',
        cutFeatureId:'cut.'+arm+'.edge',targetBodyId:'body.'+arm,
        afterBodyWriterId:'cut.'+arm,sourceSketchId:'sketch.'+arm,
        profileCandidateId:profiles.candidates[0].id,
        extent:{kind:'blind',depthMm:6},admission:'require_ready'},
      origin:{bodyId:'body.datum',bodyWriterId:'cut.datum',
        reference:edgeReference(history.document,'cut.datum',
          'edge.datum.outboard')},
    });
  }

  const before=history.document;
  const actionFor=(arm)=>({
    eventId:'rebind.cut.'+arm+'.edge',
    cutFeatureId:'cut.'+arm+'.edge',targetBodyId:'body.'+arm,
    expectedSourceBodyId:'body.datum',expectedSourceWriterId:'cut.datum',
    expectedReference:selectedCut(before,arm).payload.selectedEdge,
    origin:{bodyId:'body.auxiliary.rail',bodyWriterId:'cut.auxiliary.rail',
      reference:edgeReference(before,'cut.auxiliary.rail',
        'edge.auxiliary.outboard')},
    releasePreviousSourceDependency:true,admission:'require_ready',
  });
  const request={format:SELECTED_EDGE_BATCH_REBIND_FORMAT,version:1,
    expectedProjectId:before.projectId,expectedRevision:before.revision,
    actions:['left','right'].map(actionFor)};
  const staged=previewSelectedEdgeBatchRebind(before,request);
  assert.equal(staged.exactGeometryAuthority,false);
  history=commitUndoableSelectedEdgeBatchRebind(history,request);
  const rebased=history.document;
  assert.deepEqual(history.document.journal.slice(before.revision),staged.events);
  assert.deepEqual(staged.invalidation.readyToEvaluate,
    ['cut.left.edge','cut.right.edge']);

  const saved=runtime.reopen(runtime.save(history));
  const undone=runtime.undo(saved,['undo.rebind.right','undo.rebind.left']);
  for(const arm of ['left','right'])
    assert.equal(selectedCut(undone.document,arm).payload.edgeSourceBodyId,
      'body.datum');
  history=runtime.redo(undone,['redo.rebind.left','redo.rebind.right']);
  for(const arm of ['left','right']){
    assert.equal(selectedCut(history.document,arm).payload.edgeSourceBodyId,
      'body.auxiliary.rail');
    assert.equal(inspectSelectedEdgeCut(history.document,
      'cut.'+arm+'.edge','body.'+arm).placementStatus,'pending_evidence');
  }

  const former=history.document;
  const oldEdited=runtime.commit(history,[{
    eventId:'edit.original.datum.width',type:'feature.edit',
    featureId:'sketch.datum',patch:{payload:{
      ...model.featuresOf(former).find(f=>f.id==='sketch.datum').payload,
      sketch:featureops.mountingFlangeSketch({
        units:'mm',frame:'local_centered_xy',widthMm:152,depthMm:20,
        holes:[hole('pin.datum.left',-52,0,2),hole('pin.datum.right',52,0,2)],
      },sketch,discovery).sketch,
    }},
  }],former.revision);
  const oldDelta=planIncrementalEvaluation(former,oldEdited.document);
  assert.ok(!oldDelta.invalidatedFeatureIds.includes('cut.left.edge'));
  assert.ok(!oldDelta.invalidatedFeatureIds.includes('cut.right.edge'));

  const source=history.document;
  history=runtime.commit(history,[{
    eventId:'edit.auxiliary.rail.width',type:'feature.edit',
    featureId:'sketch.auxiliary.rail',patch:{payload:{
      ...model.featuresOf(source).find(f=>f.id==='sketch.auxiliary.rail').payload,
      sketch:featureops.mountingFlangeSketch({
        units:'mm',frame:'local_centered_xy',widthMm:162,depthMm:22,
        holes:[hole('pin.aux.left',-55,0,2),hole('pin.aux.right',55,0,2)],
      },sketch,discovery).sketch,
    }},
  }],source.revision);
  const changed=planIncrementalEvaluation(source,history.document);
  for(const arm of ['left','right'])
    assert.ok(changed.readyToEvaluate.includes('cut.'+arm+'.edge'));
  assert.ok(changed.unchangedReady.includes('cut.datum'));
  const reopened=runtime.reopen(runtime.save(history));
  const runtimeCutStatuses=['left','right'].map(arm=>runtime.inspect(reopened)
    .features.find(f=>f.featureId==='cut.'+arm+'.edge').status);

  return {
    projectId:reopened.document.projectId,
    revision:reopened.document.revision,admittedProfiles,
    distinctBodies:['body.left','body.right','body.datum','body.auxiliary.rail'],
    changedSource:'body.auxiliary.rail',
    reboundCuts:staged.changedCutIds,
    replayAfterRebind:staged.invalidation.readyToEvaluate,
    invalidatedAfterDatumEdit:changed.readyToEvaluate,
    oldSourceDoesNotInvalidate:true,
    archiveUndoRedo:true, runtimeCutStatuses,
    edgeEvidence:'pending',nativeExact:false,independentSTEP:false,
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runDualArmDatumRecovery(),null,2)+'\n');
