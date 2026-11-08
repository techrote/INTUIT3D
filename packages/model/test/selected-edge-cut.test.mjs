import assert from 'node:assert/strict';
import test from 'node:test';
import {commitEvent, featuresOf, newProject, planProject, ProjectRevisionError,
  ProjectFormatError, serializeProject} from '../src/index.ts';
import {startUndoHistory, undoTransaction, redoTransaction} from '../src/transactions.ts';
import {createModelArchive, serializeModelArchive, deserializeModelArchive} from '../src/archive.ts';
import {planIncrementalEvaluation} from '../src/incremental.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {BODY_CUT_CHAIN_FORMAT} from '../src/body-cut-chain.ts';
import {
  SELECTED_EDGE_CUT_FORMAT, SELECTED_EDGE_CUT_REBIND_FORMAT,
  previewSelectedEdgeCut, previewSelectedEdgeCutRebind,
  inspectSelectedEdgeCut, commitUndoableSelectedEdgeCut,
  commitUndoableSelectedEdgeCutRebind,
} from '../src/selected-edge-cut.ts';

const make=(id,kind,dependsOn=[],writeTargets=[],payload={})=>({
  eventId:'create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
function fixture(){
  let doc=newProject('project.clamp.jig');
  for(const event of [
    make('sketch.bracket','sketch',[],[],{widthMm:92,depthMm:58}),
    make('sketch.guide','sketch',[],[],{widthMm:118,depthMm:18}),
    make('sketch.bore','sketch',[],[],{holeDiameterMm:6}),
    make('sketch.spacer','sketch',[],[],{widthMm:12,depthMm:8}),
    make('extrude.bracket','extrude',['sketch.bracket'],['body.bracket'],
      {sourceSketchId:'sketch.bracket',thicknessMm:10}),
    make('extrude.guide','extrude',['sketch.guide'],['body.guide'],
      {sourceSketchId:'sketch.guide',thicknessMm:3}),
    make('extrude.spacer','extrude',['sketch.spacer'],['body.spacer'],
      {sourceSketchId:'sketch.spacer',thicknessMm:2}),
    make('cut.bracket.mount','cut',['extrude.bracket','sketch.bore'],['body.bracket'],
      {sourceSketchId:'sketch.bore',targetBodyId:'body.bracket',throughAll:true}),
  ])doc=commitEvent(doc,event);
  return doc;
}
const anchor=(doc,writer='extrude.guide',body='body.guide',role='edge.datum')=>({
  bodyId:body,bodyWriterId:writer,
  reference:{format:TOPOLOGY_REFERENCE_FORMAT,version:1,
    projectId:doc.projectId,atRevision:doc.revision,
    anchor:{featureId:writer,roleId:role,kind:'edge'}},
});
const req=(doc,overrides={})=>({
  format:SELECTED_EDGE_CUT_FORMAT,version:1,
  cut:{format:BODY_CUT_CHAIN_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    eventId:'create.cut.edge',cutFeatureId:'cut.bracket.datum.bore',
    targetBodyId:'body.bracket',afterBodyWriterId:'cut.bracket.mount',
    sourceSketchId:'sketch.bore',profileCandidateId:'cycle:datum.bore',
    extent:{kind:'through_all'},admission:'require_ready'},
  origin:anchor(doc),...overrides,
});
const cut=doc=>featuresOf(doc).find(f=>f.id==='cut.bracket.datum.bore');
const rebind=(doc,source,overrides={})=>({
  format:SELECTED_EDGE_CUT_REBIND_FORMAT,version:1,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  eventId:'edit.cut.edge.source',cutFeatureId:'cut.bracket.datum.bore',
  targetBodyId:'body.bracket',expectedSourceBodyId:'body.guide',
  expectedSourceWriterId:'extrude.guide',
  expectedReference:cut(doc).payload.selectedEdge,
  origin:source,releasePreviousSourceDependency:true,
  admission:'require_ready',...overrides,
});

test('one authored edge-referenced hole cut connects two independent body DAGs without geometry guesses',()=>{
  const before=fixture(), frozen=serializeProject(before);
  const result=previewSelectedEdgeCut(before,req(before));
  assert.equal(result.semanticStatus,'ready');
  assert.equal(result.requiresEdgeEvidence,true);
  assert.equal(result.exactGeometryAuthority,false);
  assert.equal(result.events.length,1);
  assert.deepEqual(cut(result.document).dependsOn,
    ['cut.bracket.mount','sketch.bore','extrude.guide']);
  assert.deepEqual(cut(result.document).writeTargets,['body.bracket']);
  assert.equal(cut(result.document).payload.edgeSourceBodyId,'body.guide');
  assert.deepEqual(JSON.parse(JSON.stringify(cut(result.document).payload.selectedEdge)),anchor(before).reference);
  assert.deepEqual(result.invalidation.readyToEvaluate,['cut.bracket.datum.bore']);
  assert.ok(result.invalidation.unchangedReady.includes('extrude.spacer'));
  assert.equal(inspectSelectedEdgeCut(result.document,'cut.bracket.datum.bore',
    'body.bracket').placementStatus,'pending_evidence');
  assert.equal(serializeProject(before),frozen);
  assert.deepEqual(planProject(result.document).features.filter(f=>f.status!=='ready'),[]);
});
test('retrospective guide edit invalidates bracket hole only; unrelated spacer and pre-existing bracket remain reusable',()=>{
  const base=previewSelectedEdgeCut(fixture(),req(fixture())).document;
  const changed=commitEvent(base,{eventId:'edit.guide.width',type:'feature.edit',
    featureId:'sketch.guide',patch:{payload:{widthMm:135,depthMm:18}}});
  const delta=planIncrementalEvaluation(base,changed);
  assert.ok(delta.readyToEvaluate.includes('extrude.guide'));
  assert.ok(delta.readyToEvaluate.includes('cut.bracket.datum.bore'));
  for(const id of ['extrude.bracket','cut.bracket.mount','extrude.spacer'])
    assert.ok(delta.unchangedReady.includes(id),id);
});
test('explicit rebind transfers cross-body dependency without modifying the target body chain',()=>{
  const base=previewSelectedEdgeCut(fixture(),req(fixture())).document;
  const reb=previewSelectedEdgeCutRebind(base,rebind(base,
    anchor(base,'extrude.spacer','body.spacer','edge.spacer.datum')));
  assert.deepEqual(cut(reb.document).dependsOn,
    ['cut.bracket.mount','sketch.bore','extrude.spacer']);
  assert.equal(reb.semanticStatus,'ready');
  assert.equal(reb.events.length,1);
  assert.equal(reb.invalidation.changedFeatureIds.includes('cut.bracket.datum.bore'),true);
  const guideChange=commitEvent(reb.document,{eventId:'edit.guide',type:'feature.edit',
    featureId:'sketch.guide',patch:{payload:{widthMm:121,depthMm:18}}});
  assert.ok(!planIncrementalEvaluation(reb.document,guideChange)
    .invalidatedFeatureIds.includes('cut.bracket.datum.bore'));
  const spacerChange=commitEvent(reb.document,{eventId:'edit.spacer',type:'feature.edit',
    featureId:'sketch.spacer',patch:{payload:{widthMm:15,depthMm:8}}});
  assert.ok(planIncrementalEvaluation(reb.document,spacerChange)
    .readyToEvaluate.includes('cut.bracket.datum.bore'));
});
test('rebind without explicit release retains old dependency, including its later invalidation',()=>{
  const base=previewSelectedEdgeCut(fixture(),req(fixture())).document;
  const reb=previewSelectedEdgeCutRebind(base,rebind(base,
    anchor(base,'extrude.spacer','body.spacer','edge.spacer.datum'),{
    releasePreviousSourceDependency:false,
  }));
  assert.ok(cut(reb.document).dependsOn.includes('extrude.guide'));
  assert.ok(cut(reb.document).dependsOn.includes('extrude.spacer'));
});
test('one-step undo/redo and durable archive preserve cut ID, selected edge and source body',()=>{
  let history=startUndoHistory(fixture());
  history=commitUndoableSelectedEdgeCut(history,req(history.document));
  assert.equal(history.undoStack.length,1);
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  assert.equal(cut(history.document).payload.edgeSourceBodyId,'body.guide');
  history=undoTransaction(history,['undo.selected.edge']);
  assert.equal(cut(history.document),undefined);
  history=redoTransaction(history,['redo.selected.edge']);
  assert.equal(cut(history.document).payload.selectedEdge.anchor.roleId,'edge.datum');
  history=commitUndoableSelectedEdgeCutRebind(history,rebind(history.document,
    anchor(history.document,'extrude.spacer','body.spacer','edge.spacer.datum')));
  assert.equal(history.undoStack.length,2);
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  assert.equal(cut(history.document).payload.edgeSourceBodyId,'body.spacer');
  history=undoTransaction(history,['undo.selected.rebind']);
  assert.equal(cut(history.document).payload.edgeSourceBodyId,'body.guide');
  history=redoTransaction(history,['redo.selected.rebind']);
  assert.equal(cut(history.document).payload.edgeSourceBodyId,'body.spacer');
});
test('stale revisions, forged source body and missing historical source fail atomically',()=>{
  const base=fixture(), frozen=serializeProject(base);
  const wrong=[
    {cut:{...req(base).cut,expectedRevision:base.revision-1}},
    {cut:{...req(base).cut,afterBodyWriterId:'extrude.bracket'}},
    {origin:anchor(base,'extrude.guide','body.bracket')},
    {origin:anchor(base,'extrude.bracket','body.bracket','edge.wrong')},
    {origin:{...anchor(base),reference:{
      ...anchor(base).reference,atRevision:1,
    }}},
    {origin:{...anchor(base),reference:{
      ...anchor(base).reference,anchor:{...anchor(base).reference.anchor,kind:'face'},
    }}},
    {cut:{...req(base).cut,sourceSketchId:'extrude.guide'}},
  ];
  for(const changed of wrong){
    assert.throws(()=>previewSelectedEdgeCut(base,req(base,changed)),Error);
    assert.equal(serializeProject(base),frozen);
  }
  assert.throws(()=>previewSelectedEdgeCut(base,req(base,{
    cut:{...req(base).cut,expectedRevision:base.revision-1},
  })),ProjectRevisionError);
});
test('stale selected role, source changes and invalid current terminals refuse rebind',()=>{
  const base=previewSelectedEdgeCut(fixture(),req(fixture())).document;
  const newSource=anchor(base,'extrude.spacer','body.spacer','edge.spacer.datum');
  for(const bad of [
    {expectedRevision:base.revision-1},
    {expectedSourceBodyId:'body.spacer'},
    {expectedSourceWriterId:'extrude.spacer'},
    {expectedReference:anchor(base).reference},
    {origin:anchor(base,'extrude.guide','body.bracket')},
  ])assert.throws(()=>previewSelectedEdgeCutRebind(base,
    rebind(base,newSource,bad)),Error);
  assert.throws(()=>previewSelectedEdgeCutRebind(base,
    rebind(base,newSource,{expectedRevision:base.revision-1})),
    ProjectRevisionError);
  assert.throws(()=>previewSelectedEdgeCutRebind(base,
    rebind(base,anchor(base),{releasePreviousSourceDependency:true})),ProjectFormatError);
});
