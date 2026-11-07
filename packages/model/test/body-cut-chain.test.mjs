import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject,
  ProjectFormatError, serializeProject,
} from '../src/index.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction,
  redoTransaction, serializeUndoHistory,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  BODY_CUT_CHAIN_FORMAT, BODY_CUT_CHAIN_VERSION,
  inspectBodyCutChain, previewBodyCutAppend, commitUndoableBodyCutAppend,
} from '../src/body-cut-chain.ts';

const make = (id, kind, dependsOn=[], writeTargets=[], payload={}) => ({
  eventId: 'event.create.' + id, type: 'feature.create',
  feature: { id, kind, dependsOn, writeTargets, payload },
});
function base() {
  let doc=newProject('project.two.slots');
  doc=commitEvent(doc,make('feature.plate.sketch','sketch',[],['sketch.plate'],{
    widthMm:120,heightMm:80,rectangleId:'profile.plate',
  }));
  doc=commitEvent(doc,make('feature.slot.sketch','sketch',[],['sketch.slot'],{
    slotLengthMm:42,slotWidthMm:8,
  }));
  doc=commitEvent(doc,make('feature.plate.extrude','extrude',
    ['feature.plate.sketch'],['body.plate'],{
      sourceSketchId:'feature.plate.sketch',thicknessMm:8,
  }));
  doc=commitEvent(doc,make('feature.cut.first','cut',
    ['feature.plate.extrude','feature.slot.sketch'],['body.plate'],{
      sourceSketchId:'feature.slot.sketch',targetBodyId:'body.plate',
      throughAll:true,
  }));
  doc=commitEvent(doc,make('feature.independent.extrude','extrude',
    [],['body.independent'],{thicknessMm:4}));
  assert.ok(planProject(doc).features.every(f=>f.status==='ready'));
  return doc;
}
const req=(doc, extra={})=>({
  format:BODY_CUT_CHAIN_FORMAT,version:BODY_CUT_CHAIN_VERSION,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  eventId:'event.append.second.cut',cutFeatureId:'feature.cut.second',
  targetBodyId:'body.plate',afterBodyWriterId:'feature.cut.first',
  sourceSketchId:'feature.slot.sketch',profileCandidateId:'cycle:slot.loop',
  extent:{kind:'blind',depthMm:3},admission:'require_ready',...extra,
});

test('two explicitly ordered same-body cuts are planner-ready without silently ordering body mutations',()=>{
  const before=base(), frozen=serializeProject(before);
  const inspected=inspectBodyCutChain(before,'body.plate');
  assert.deepEqual(inspected.bodyWriterIds,
    ['feature.plate.extrude','feature.cut.first']);
  assert.equal(inspected.eligibleAfterWriterId,'feature.cut.first');
  const preview=previewBodyCutAppend(before,req(before));
  assert.equal(preview.semanticStatus,'ready');
  assert.equal(preview.requiresNativeRebuild,true);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.deepEqual(preview.invalidation.readyToEvaluate,['feature.cut.second']);
  assert.ok(preview.invalidation.unchangedReady.includes('feature.independent.extrude'));
  const cut=featuresOf(preview.document).find(f=>f.id==='feature.cut.second');
  assert.deepEqual(cut.dependsOn,['feature.cut.first','feature.slot.sketch']);
  assert.deepEqual(cut.writeTargets,['body.plate']);
  assert.equal(cut.payload.targetBodyId,'body.plate');
  assert.equal(cut.payload.profileCandidateId,'cycle:slot.loop');
  assert.deepEqual([cut.payload.throughAll,cut.payload.depthMm],[false,3]);
  assert.deepEqual(planProject(preview.document).executableOrder.slice(-1),
    ['feature.cut.second']);
  assert.equal(inspectBodyCutChain(preview.document,'body.plate')
    .eligibleAfterWriterId,'feature.cut.second');
  // A third independent cut on the same body has a unique semantic writer tail.
  const third=previewBodyCutAppend(preview.document,req(preview.document,{
    eventId:'event.append.third.cut',cutFeatureId:'feature.cut.third',
    afterBodyWriterId:'feature.cut.second',extent:{kind:'through_all'},
  }));
  assert.equal(third.semanticStatus,'ready');
  assert.deepEqual(third.invalidation.readyToEvaluate,['feature.cut.third']);
  assert.equal(inspectBodyCutChain(third.document,'body.plate')
    .eligibleAfterWriterId,'feature.cut.third');
  assert.deepEqual(featuresOf(third.document).find(f=>f.id==='feature.cut.third')
    .dependsOn,['feature.cut.second','feature.slot.sketch']);
  assert.equal(serializeProject(before),frozen);
});

test('retrospective sketch resize rebuilds the plate and both cuts, not the independent body',()=>{
  let history=startUndoHistory(base());
  history=commitUndoableBodyCutAppend(history,req(history.document));
  assert.equal(history.undoStack.length,1);
  const before=history.document;
  history=commitUndoableTransaction(history,[{
    eventId:'event.resize.plate',type:'feature.edit',
    featureId:'feature.plate.sketch',
    patch:{payload:{widthMm:150,heightMm:80,rectangleId:'profile.plate'}},
  }]);
  const delta=planIncrementalEvaluation(before,history.document);
  assert.deepEqual(delta.readyToEvaluate,[
    'feature.plate.sketch','feature.plate.extrude',
    'feature.cut.first','feature.cut.second',
  ]);
  assert.ok(delta.unchangedReady.includes('feature.independent.extrude'));
  assert.ok(delta.unchangedReady.includes('feature.slot.sketch'));
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.plate.sketch')
    .payload.widthMm,150);
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.cut.second')
    .payload.targetBodyId,'body.plate');
  history=undoTransaction(history,['event.undo.width']);
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.plate.sketch')
    .payload.widthMm,120);
  history=redoTransaction(history,['event.redo.width']);
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.plate.sketch')
    .payload.widthMm,150);
});

test('the second cut is one undo frame and reopens with the same semantic ID',()=>{
  let history=startUndoHistory(base());
  history=commitUndoableBodyCutAppend(history,req(history.document,{
    extent:{kind:'through_all'},
  }));
  assert.equal(history.undoStack.length,1);
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.cut.second')
    .payload.throughAll,true);
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['event.undo.cut.second']);
  assert.equal(featuresOf(history.document).some(f=>f.id==='feature.cut.second'),false);
  assert.deepEqual(inspectBodyCutChain(history.document,'body.plate').bodyWriterIds,
    ['feature.plate.extrude','feature.cut.first']);
  history=redoTransaction(history,['event.redo.cut.second']);
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.cut.second')
    .payload.profileCandidateId,'cycle:slot.loop');
  assert.equal(planProject(history.document).features.find(f=>
    f.feature.id==='feature.cut.second').status,'ready');
});

test('future sketch may remain pending by explicit permission and recover once authored',()=>{
  const before=base();
  const permissive=req(before,{sourceSketchId:'feature.future.sketch',
    admission:'permit_unresolved'});
  assert.throws(()=>previewBodyCutAppend(before,
    {...permissive,admission:'require_ready'}),ProjectFormatError);
  const preview=previewBodyCutAppend(before,permissive);
  assert.equal(preview.semanticStatus,'pending');
  assert.deepEqual(preview.invalidation.unresolved.find(f=>
    f.featureId==='feature.cut.second').diagnosticCodes,['MISSING_REFERENCE']);
  const recovered=commitEvent(preview.document,make('feature.future.sketch',
    'sketch',[],['sketch.future'],{slotLengthMm:24,slotWidthMm:4}));
  assert.equal(planProject(recovered).features.find(f=>
    f.feature.id==='feature.cut.second').status,'ready');
  assert.ok(planIncrementalEvaluation(preview.document,recovered)
    .readyToEvaluate.includes('feature.cut.second'));
});

test('stale, ambiguous, malformed and mismatched body cut requests reject atomically',()=>{
  const doc=base(), history=startUndoHistory(doc), untouched=serializeUndoHistory(history);
  for(const edit of [
    {expectedProjectId:'project.wrong'},
    {expectedRevision:doc.revision-1},
    {afterBodyWriterId:'feature.plate.extrude'},
    {afterBodyWriterId:'feature.independent.extrude'},
    {sourceSketchId:'feature.plate.extrude'},
    {sourceSketchId:'feature.missing'},
    {cutFeatureId:'feature.cut.first'},
    {cutFeatureId:'feature.cut.second',eventId:'event.create.feature.cut.first'},
    {cutFeatureId:'body.plate'},
    {targetBodyId:'body.independent'},
    {extent:{kind:'blind',depthMm:0}},
    {extent:{kind:'blind',depthMm:NaN}},
    {extent:{kind:'through_all',depthMm:3}},
    {extent:{kind:'blind',depthMm:3,throughAll:true}},
    {profileCandidateId:'arbitrary'},
    {extra:'not part of the protocol'},
  ]) {
    assert.throws(()=>commitUndoableBodyCutAppend(history,req(doc,edit)),
      /body cut chain|stale|journal\[|reuses semantic feature ID/);
  }
  assert.equal(serializeUndoHistory(history),untouched);

  let unordered=commitEvent(doc,make('feature.cut.unordered','cut',[],
    ['body.plate'],{targetBodyId:'body.plate'}));
  assert.equal(inspectBodyCutChain(unordered,'body.plate').eligibleAfterWriterId,null);
  assert.throws(()=>previewBodyCutAppend(unordered,req(unordered)),ProjectFormatError);

  unordered=commitEvent(unordered,{eventId:'event.remove.unordered',
    type:'feature.remove',featureId:'feature.cut.unordered'});
  assert.equal(inspectBodyCutChain(unordered,'body.plate').eligibleAfterWriterId,
    'feature.cut.first');
});

test('public two-cut demonstration executes with semantic-only provenance',async()=>{
  await import('../examples/sequential-body-cuts.mjs');
});
