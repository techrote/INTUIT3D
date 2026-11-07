/**
 * A runnable model-only user action: swap two different profile cuts on an
 * existing plate, edit the earlier plate dimension, undo/redo and reopen.
 *
 * node packages/model/examples/resequence-plate-cuts.mjs
 *
 * No B-rep or STEP geometry is evaluated here. Consumers must run a new
 * revision-fenced native provider after swapping non-commutative Booleans.
 */
import assert from 'node:assert/strict';
import { newProject, commitEvent, featuresOf, planProject } from '../src/index.ts';
import { startUndoHistory, commitUndoableTransaction,
  undoTransaction, redoTransaction } from '../src/transactions.ts';
import { createModelArchive, serializeModelArchive,
  deserializeModelArchive } from '../src/archive.ts';
import { BODY_CUT_ORDER_FORMAT,
  previewBodyCutSwap, commitUndoableBodyCutSwap } from '../src/body-cut-order.ts';
import { inspectBodyCutChain } from '../src/body-cut-chain.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';

const create=(id,kind,dependsOn,writeTargets,payload)=>({
  type:'feature.create',eventId:'create.'+id,
  feature:{id,kind,dependsOn,writeTargets,payload},
});
let doc=newProject('project.lbracket.resequence');
for(const event of [
  create('sketch.plate','sketch',[],['sketch.plate'],{widthMm:120,heightMm:80}),
  create('sketch.slot','sketch',[],['sketch.slot'],{slotWidthMm:8,slotLengthMm:30}),
  create('sketch.pocket','sketch',[],['sketch.pocket'],{pocketWidthMm:20,pocketHeightMm:10}),
  create('extrude.plate','extrude',['sketch.plate'],['body.plate'],
    {sourceSketchId:'sketch.plate',thicknessMm:8}),
  create('cut.slot','cut',['extrude.plate','sketch.slot'],['body.plate'],
    {sourceSketchId:'sketch.slot',targetBodyId:'body.plate',
     profileCandidateId:'cycle:slot',throughAll:true}),
  create('cut.pocket','cut',['cut.slot','sketch.pocket'],['body.plate'],
    {sourceSketchId:'sketch.pocket',targetBodyId:'body.plate',
     profileCandidateId:'cycle:pocket',throughAll:false,depthMm:3}),
  create('extrude.spacer','extrude',[],['body.spacer'],
    {thicknessMm:2}),
]) doc=commitEvent(doc,event);

let history=startUndoHistory(doc);
const request={
  format:BODY_CUT_ORDER_FORMAT,version:1,expectedProjectId:doc.projectId,
  expectedRevision:doc.revision,targetBodyId:'body.plate',
  firstCutFeatureId:'cut.slot',secondCutFeatureId:'cut.pocket',
  eventIds:['reorder.pocket','reorder.slot'],
};
const swapped=previewBodyCutSwap(history.document,request);
assert.deepEqual(swapped.writerOrderAfter,['extrude.plate','cut.pocket','cut.slot']);
assert.equal(swapped.exactGeometryAuthority,false);
history=commitUndoableBodyCutSwap(history,request);
history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
history=undoTransaction(history,['undo.slot','undo.pocket']);
assert.equal(inspectBodyCutChain(history.document,'body.plate').eligibleAfterWriterId,'cut.pocket');
history=redoTransaction(history,['redo.pocket','redo.slot']);
assert.equal(inspectBodyCutChain(history.document,'body.plate').eligibleAfterWriterId,'cut.slot');
const beforeDimension=history.document;
history=commitUndoableTransaction(history,[{
  type:'feature.edit',eventId:'resize.plate',featureId:'sketch.plate',
  patch:{payload:{widthMm:150,heightMm:80}},
}]);
const replay=planIncrementalEvaluation(beforeDimension,history.document);
assert.ok(replay.unchangedReady.includes('extrude.spacer'));
assert.ok(replay.readyToEvaluate.includes('cut.pocket'));
assert.ok(replay.readyToEvaluate.includes('cut.slot'));
assert.equal(featuresOf(history.document).find(f=>f.id==='sketch.plate').payload.widthMm,150);
assert.ok(planProject(history.document).features.every(f=>f.status==='ready'));
console.log(JSON.stringify({
  format:'intuit3d.body-cut-order-demo',version:1,
  projectId:history.document.projectId,revision:history.document.revision,
  widthMm:150,bodyId:'body.plate',
  writerOrderBefore:swapped.writerOrderBefore,
  writerOrderAfter:swapped.writerOrderAfter,
  partialRebuild:replay.readyToEvaluate,
  independentBodyReusable:replay.unchangedReady.includes('extrude.spacer'),
  stableCutIds:['cut.slot','cut.pocket'],
  undoRedoAndArchivePassed:true,exactGeometryAuthority:false,
  nativeStepStatus:'not_executed',
},null,2));
