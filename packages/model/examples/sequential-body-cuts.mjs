/**
 * Executable semantic CAD history, NOT a physical B-rep, STEP or graphical test.
 *
 * A named plate is extruded; two sequential, explicitly ordered cuts target the
 * same body. Changing an older dimension invalidates only that body's feature
 * chain; undo, redo and archive reopening retain authored intent and IDs.
 *
 * node packages/model/examples/sequential-body-cuts.mjs
 */
import assert from 'node:assert/strict';
import {
  newProject, commitEvent, featuresOf, planProject,
} from '../src/index.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction,
  redoTransaction,
} from '../src/transactions.ts';
import { createModelArchive, serializeModelArchive, deserializeModelArchive }
  from '../src/archive.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  BODY_CUT_CHAIN_FORMAT, BODY_CUT_CHAIN_VERSION,
  inspectBodyCutChain, commitUndoableBodyCutAppend,
} from '../src/body-cut-chain.ts';

const create=(id,kind,dependsOn,writeTargets,payload)=>({
  eventId:'event.create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
let doc=newProject('project.mounting.plate');
doc=commitEvent(doc,create('sketch.plate','sketch',[],['sketch.plate.geometry'],
  {widthMm:120,heightMm:80,holes:[{id:'hole.one',xMm:25,yMm:40,radiusMm:4}]}));
doc=commitEvent(doc,create('sketch.slot','sketch',[],['sketch.slot.geometry'],
  {slotLengthMm:34,slotWidthMm:7}));
doc=commitEvent(doc,create('feature.extrude','extrude',
  ['sketch.plate'],['body.plate'],
  {sourceSketchId:'sketch.plate',thicknessMm:8}));
doc=commitEvent(doc,create('feature.cut.through','cut',
  ['feature.extrude','sketch.slot'],['body.plate'],
  {sourceSketchId:'sketch.slot',targetBodyId:'body.plate',throughAll:true}));
doc=commitEvent(doc,create('feature.independent','extrude',[],['body.fixture'],
  {thicknessMm:2}));
let session=startUndoHistory(doc);
const selected=inspectBodyCutChain(session.document,'body.plate');
assert.equal(selected.eligibleAfterWriterId,'feature.cut.through');
session=commitUndoableBodyCutAppend(session,{
  format:BODY_CUT_CHAIN_FORMAT,version:BODY_CUT_CHAIN_VERSION,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  eventId:'event.cut.pocket',cutFeatureId:'feature.cut.pocket',
  targetBodyId:'body.plate',afterBodyWriterId:selected.eligibleAfterWriterId,
  sourceSketchId:'sketch.slot',profileCandidateId:'cycle:mount.slot',
  extent:{kind:'blind',depthMm:3},admission:'require_ready',
});
const beforeEdit=session.document;
session=commitUndoableTransaction(session,[{
  eventId:'event.edit.width',type:'feature.edit',featureId:'sketch.plate',
  patch:{payload:{widthMm:150,heightMm:80,
    holes:[{id:'hole.one',xMm:25,yMm:40,radiusMm:4}]}},
}]);
const invalidation=planIncrementalEvaluation(beforeEdit,session.document);
assert.deepEqual(invalidation.readyToEvaluate,[
  'sketch.plate','feature.extrude','feature.cut.through','feature.cut.pocket',
]);
assert.ok(invalidation.unchangedReady.includes('feature.independent'));
session=deserializeModelArchive(
  serializeModelArchive(createModelArchive(session))).history;
assert.equal(featuresOf(session.document).find(f=>f.id==='sketch.plate')
  .payload.widthMm,150);
session=undoTransaction(session,['event.undo.width']);
session=redoTransaction(session,['event.redo.width']);
assert.equal(featuresOf(session.document).find(f=>f.id==='sketch.plate')
  .payload.widthMm,150);
assert.equal(planProject(session.document).features.find(f=>
  f.feature.id==='feature.cut.pocket').status,'ready');
console.log(JSON.stringify({
  modelAuthority:'semantic_only',
  projectId:session.document.projectId,revision:session.document.revision,
  bodyId:'body.plate',
  bodyWriters:inspectBodyCutChain(session.document,'body.plate').bodyWriterIds,
  widthMm:featuresOf(session.document).find(f=>f.id==='sketch.plate')
    .payload.widthMm,
  changedFeatures:invalidation.readyToEvaluate,
  preservedIndependentBody:invalidation.unchangedReady.includes('feature.independent'),
  geometryStatus:'not_evaluated',
  nativeStepStatus:'not_executed',
},null,2));
