import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, ProjectFormatError,
  ProjectRevisionError, serializeProject,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import {planIncrementalEvaluation} from '../src/incremental.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {BODY_CUT_CHAIN_FORMAT} from '../src/body-cut-chain.ts';
import {
  SELECTED_EDGE_CUT_FORMAT, previewSelectedEdgeCut, inspectSelectedEdgeCut,
} from '../src/selected-edge-cut.ts';
import {
  SELECTED_EDGE_BATCH_REBIND_FORMAT, previewSelectedEdgeBatchRebind,
  commitUndoableSelectedEdgeBatchRebind,
} from '../src/selected-edge-batch-rebind.ts';
import {runDualArmDatumRecovery} from '../examples/dual-arm-datum-recovery.mjs';

const author=(id,kind,dependsOn=[],writeTargets=[],payload={})=>({
  type:'feature.create',eventId:'create.'+id,
  feature:{id,kind,dependsOn,writeTargets,payload},
});
const selected=(doc,id)=>featuresOf(doc).find(f=>f.id===id);
function reference(doc,writer,role='edge.rail'){
  return {format:TOPOLOGY_REFERENCE_FORMAT,version:1,
    projectId:doc.projectId,atRevision:doc.revision,
    anchor:{featureId:writer,roleId:role,kind:'edge'}};
}
function prepared(){
  let doc=newProject('project.dual.arm.fixture');
  for (const event of [
    author('sketch.left','sketch',[],[],{widthMm:75}),
    author('sketch.right','sketch',[],[],{widthMm:75}),
    author('sketch.guide','sketch',[],[],{widthMm:100}),
    author('sketch.aux','sketch',[],[],{widthMm:125}),
    author('sketch.bore','sketch',[],[],{diameterMm:5}),
    author('extrude.left','extrude',['sketch.left'],['body.left'],
      {sourceSketchId:'sketch.left',thicknessMm:8}),
    author('extrude.right','extrude',['sketch.right'],['body.right'],
      {sourceSketchId:'sketch.right',thicknessMm:8}),
    author('extrude.guide','extrude',['sketch.guide'],['body.guide'],
      {sourceSketchId:'sketch.guide',thicknessMm:3}),
    author('extrude.aux','extrude',['sketch.aux'],['body.aux'],
      {sourceSketchId:'sketch.aux',thicknessMm:3}),
    author('cut.left.mount','cut',['extrude.left','sketch.bore'],['body.left'],
      {sourceSketchId:'sketch.bore',targetBodyId:'body.left',throughAll:true}),
    author('cut.right.mount','cut',['extrude.right','sketch.bore'],['body.right'],
      {sourceSketchId:'sketch.bore',targetBodyId:'body.right',throughAll:true}),
  ])doc=commitEvent(doc,event);
  for(const arm of ['left','right']){
    doc=previewSelectedEdgeCut(doc,{
      format:SELECTED_EDGE_CUT_FORMAT,version:1,
      cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
        expectedProjectId:doc.projectId,expectedRevision:doc.revision,
        eventId:'create.cut.'+arm+'.edge',
        cutFeatureId:'cut.'+arm+'.edge',targetBodyId:'body.'+arm,
        afterBodyWriterId:'cut.'+arm+'.mount',sourceSketchId:'sketch.bore',
        profileCandidateId:'cycle:datum.'+arm,
        extent:{kind:'through_all'},admission:'require_ready'},
      origin:{bodyId:'body.guide',bodyWriterId:'extrude.guide',
        reference:reference(doc,'extrude.guide')},
    }).document;
  }
  return doc;
}
function request(doc){
  return {format:SELECTED_EDGE_BATCH_REBIND_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    actions:['left','right'].map((arm)=>({
      eventId:'rebind.'+arm+'.datum',
      cutFeatureId:'cut.'+arm+'.edge',targetBodyId:'body.'+arm,
      expectedSourceBodyId:'body.guide',
      expectedSourceWriterId:'extrude.guide',
      expectedReference:selected(doc,'cut.'+arm+'.edge').payload.selectedEdge,
      origin:{bodyId:'body.aux',bodyWriterId:'extrude.aux',
        reference:reference(doc,'extrude.aux','edge.aux.datum')},
      releasePreviousSourceDependency:true,admission:'require_ready',
    })),
  };
}

test('atomic rebind transfers two independent arm cuts to one new datum with one model preview',()=>{
  const base=prepared(), frozen=serializeProject(base);
  const staged=previewSelectedEdgeBatchRebind(base,request(base));
  assert.equal(staged.events.length,2);
  assert.equal(staged.toRevision,base.revision+2);
  assert.deepEqual(staged.changedCutIds,['cut.left.edge','cut.right.edge']);
  assert.deepEqual(staged.sourceBodyIds,['body.aux']);
  assert.deepEqual(staged.targetBodyIds,['body.left','body.right']);
  assert.equal(staged.exactGeometryAuthority,false);
  assert.equal(staged.requiresEdgeEvidence,true);
  assert.equal(serializeProject(base),frozen);
  for(const arm of ['left','right']){
    const edge=selected(staged.document,'cut.'+arm+'.edge');
    assert.deepEqual(edge.dependsOn,
      ['cut.'+arm+'.mount','sketch.bore','extrude.aux']);
    assert.equal(edge.payload.edgeSourceBodyId,'body.aux');
    assert.equal(inspectSelectedEdgeCut(staged.document,
      'cut.'+arm+'.edge','body.'+arm).placementStatus,'pending_evidence');
    assert.ok(staged.invalidation.readyToEvaluate.includes('cut.'+arm+'.edge'));
  }
  for(const unchanged of ['extrude.left','extrude.right',
    'cut.left.mount','cut.right.mount','extrude.guide','extrude.aux']){
    assert.ok(staged.invalidation.unchangedReady.includes(unchanged),unchanged);
  }
});
test('downstream invalidation follows reassigned source, not detached historical datum',()=>{
  const original=prepared();
  const doc=previewSelectedEdgeBatchRebind(original,request(original)).document;
  const old=commitEvent(doc,{eventId:'edit.old.datum',type:'feature.edit',
    featureId:'sketch.guide',patch:{payload:{widthMm:105}}});
  const oldDelta=planIncrementalEvaluation(doc,old);
  assert.equal(oldDelta.invalidatedFeatureIds.includes('cut.left.edge'),false);
  assert.equal(oldDelta.invalidatedFeatureIds.includes('cut.right.edge'),false);
  const updated=commitEvent(doc,{eventId:'edit.new.datum',type:'feature.edit',
    featureId:'sketch.aux',patch:{payload:{widthMm:140}}});
  const newDelta=planIncrementalEvaluation(doc,updated);
  assert.ok(newDelta.readyToEvaluate.includes('cut.left.edge'));
  assert.ok(newDelta.readyToEvaluate.includes('cut.right.edge'));
  assert.ok(newDelta.unchangedReady.includes('extrude.guide'));
  assert.ok(newDelta.unchangedReady.includes('cut.left.mount'));
});
test('batch is one durable undo frame, survives save/reopen, and reverses both links together',()=>{
  const original=prepared();
  let history=startUndoHistory(original);
  history=commitUndoableSelectedEdgeBatchRebind(history,request(original));
  assert.equal(history.undoStack.length,1);
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  for(const arm of ['left','right'])
    assert.equal(selected(history.document,'cut.'+arm+'.edge')
      .payload.edgeSourceBodyId,'body.aux');
  history=undoTransaction(history,['undo.right.link','undo.left.link']);
  for(const arm of ['left','right'])
    assert.equal(selected(history.document,'cut.'+arm+'.edge')
      .payload.edgeSourceBodyId,'body.guide');
  history=redoTransaction(history,['redo.left.link','redo.right.link']);
  for(const arm of ['left','right'])
    assert.equal(selected(history.document,'cut.'+arm+'.edge')
      .payload.edgeSourceBodyId,'body.aux');
});
test('stale revisions, wrong project and changed source selections refuse the entire operation',()=>{
  const doc=prepared(), original=serializeProject(doc), req=request(doc);
  assert.throws(()=>previewSelectedEdgeBatchRebind(doc,
    {...req,expectedRevision:doc.revision-1}),ProjectRevisionError);
  assert.throws(()=>previewSelectedEdgeBatchRebind(doc,
    {...req,expectedProjectId:'project.other'}),ProjectRevisionError);
  assert.throws(()=>previewSelectedEdgeBatchRebind(doc,{
    ...req,actions:[req.actions[0],{...req.actions[1],
      expectedSourceWriterId:'extrude.aux'}],
  }),Error);
  const concurrent=commitEvent(doc,{eventId:'edit.concurrent.aux',type:'feature.edit',
    featureId:'sketch.aux',patch:{payload:{widthMm:132}}});
  assert.throws(()=>commitUndoableSelectedEdgeBatchRebind(
    startUndoHistory(concurrent),req),ProjectRevisionError);
  assert.equal(serializeProject(doc),original);
});
test('invalid second action, duplicate events/cuts and unsupported fields never partially commit',()=>{
  const doc=prepared(), original=serializeProject(doc), req=request(doc);
  for(const actions of [
    [req.actions[0],{...req.actions[1],eventId:req.actions[0].eventId}],
    [req.actions[0],{...req.actions[1],cutFeatureId:req.actions[0].cutFeatureId}],
    [req.actions[0],{...req.actions[1],origin:{
      ...req.actions[1].origin,bodyId:'body.left'}}],
    [req.actions[0],{...req.actions[1],expectedReference:{
      ...req.actions[1].expectedReference,atRevision:1}}],
    [req.actions[0],{...req.actions[1],unsupported:'silently ignored'}],
  ]){
    assert.throws(()=>previewSelectedEdgeBatchRebind(doc,{...req,actions}),Error);
    assert.equal(serializeProject(doc),original);
  }
  for(const actions of [[],[req.actions[0]],Array(65).fill(req.actions[0])]){
    assert.throws(()=>previewSelectedEdgeBatchRebind(doc,{...req,actions}),
      ProjectFormatError);
  }
});
test('retain-old-dependency is an explicit choice and still invalidates on old datum edit',()=>{
  const doc=prepared(),req=request(doc);
  const staged=previewSelectedEdgeBatchRebind(doc,{
    ...req,actions:req.actions.map(action=>({
      ...action,releasePreviousSourceDependency:false,
    })),
  });
  const left=selected(staged.document,'cut.left.edge');
  assert.ok(left.dependsOn.includes('extrude.guide'));
  assert.ok(left.dependsOn.includes('extrude.aux'));
  const changed=commitEvent(staged.document,{eventId:'edit.guide.retained',
    type:'feature.edit',featureId:'sketch.guide',
    patch:{payload:{widthMm:200}}});
  assert.ok(planIncrementalEvaluation(staged.document,changed)
    .invalidatedFeatureIds.includes('cut.left.edge'));
});
test('real SKETCH + FEATUREOPS + RUNTIME dual-arm recovery remains pending physical placement',()=>{
  const result=runDualArmDatumRecovery();
  assert.equal(result.admittedProfiles,2);
  assert.equal(result.changedSource,'body.auxiliary.rail');
  assert.deepEqual(result.reboundCuts,['cut.left.edge','cut.right.edge']);
  assert.equal(result.archiveUndoRedo,true);
  assert.equal(result.nativeExact,false);
  assert.equal(result.independentSTEP,false);
  assert.ok(result.invalidatedAfterDatumEdit.includes('cut.left.edge'));
  assert.ok(result.invalidatedAfterDatumEdit.includes('cut.right.edge'));
});
