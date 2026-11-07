/** Runnable model-owned plate/cut timeline move + history + partial rebuild fixture. */
import assert from 'node:assert/strict';
import { newProject, commitEvent, featuresOf, planProject } from '../src/index.ts';
import { moveHistoryFeature } from '../src/history-move.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';

const make = (id, kind, dependsOn, writeTargets, payload) => ({
  eventId: 'event.create.' + id, type: 'feature.create',
  feature: { id, kind, dependsOn, writeTargets, payload },
});
let document = newProject('project.plate.holes.timeline');
document = commitEvent(document, make('parameter.thickness','parameter',[],[],
  { thicknessMm: 8 }));
document = commitEvent(document, make('feature.sketch','sketch',[],['sketch.plate'],
  { widthMm: 120,heightMm: 80,holeCentersMm:[[30,40],[90,40]],holeRadiusMm: 6 }));
document = commitEvent(document, make('feature.cut','cut',['feature.extrude'],
  ['body.plate'],{ holeCount:2,throughAll:true }));
document = commitEvent(document, make('feature.extrude','extrude',
  ['parameter.thickness','feature.sketch'],['body.plate'],
  { selectedProfile:'sketch.plate', targetBody:'body.plate' }));
document = commitEvent(document, make('feature.annotation','annotation',[],
  ['annotation.note'],{text:'sample'}));

let session = startUndoHistory(document);
const moved = moveHistoryFeature(session, {
  eventId:'event.move.cut',featureId:'feature.cut',
  afterFeatureId:'feature.extrude',
  expectedProjectId:document.projectId,expectedRevision:document.revision,
});
session = moved.history;
assert.equal(moved.structuralInvalidation.readyToEvaluate.length,0);
assert.deepEqual(planProject(session.document).executableOrder, [
  'parameter.thickness','feature.sketch','feature.extrude','feature.cut','feature.annotation',
]);
session = commitUndoableTransaction(session,[{
  eventId:'event.edit.thickness',type:'feature.edit',
  featureId:'parameter.thickness',patch:{payload:{thicknessMm:12}},
}]);
const delta = planIncrementalEvaluation(moved.history.document,session.document);
assert.deepEqual(delta.readyToEvaluate,[
  'parameter.thickness','feature.extrude','feature.cut',
]);
assert.deepEqual(delta.unchangedReady,['feature.sketch','feature.annotation']);
session = undoTransaction(session,['event.undo.thickness']);
assert.equal(featuresOf(session.document)[0].payload.thicknessMm,8);
session = redoTransaction(session,['event.redo.thickness']);
assert.equal(featuresOf(session.document)[0].payload.thicknessMm,12);
session = deserializeModelArchive(
  serializeModelArchive(createModelArchive(session))
).history;
assert.deepEqual(planProject(session.document).authoredOrder.slice(2,4),
  ['feature.extrude','feature.cut']);
console.log(JSON.stringify({
  projectId:session.document.projectId,revision:session.document.revision,
  authoredOrder:planProject(session.document).authoredOrder,
  executableOrder:planProject(session.document).executableOrder,
  editedThicknessMm:featuresOf(session.document)[0].payload.thicknessMm,
  readyToEvaluateAfterThicknessEdit:delta.readyToEvaluate,
  unchangedReadyAfterThicknessEdit:delta.unchangedReady,
  geometryProvenance:'model-intent-only; native STEP not executed',
},null,2));
