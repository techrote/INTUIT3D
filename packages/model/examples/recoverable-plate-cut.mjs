/** User-driven deletion/recovery of a parametric plate cut; no native authority. */
import assert from 'node:assert/strict';
import { commitEvent, newProject, featuresOf, planProject } from '../src/index.ts';
import { startUndoHistory, undoTransaction, redoTransaction,
  commitUndoableTransaction } from '../src/transactions.ts';
import {
  inspectFeatureRemoval, commitUndoableFeatureRemoval,
  commitUndoableFeatureRestoration,
  FEATURE_LIFECYCLE_FORMAT, FEATURE_LIFECYCLE_VERSION,
} from '../src/feature-lifecycle.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import { createModelArchive, deserializeModelArchive,
  serializeModelArchive } from '../src/archive.ts';

const make = (id, kind, dependsOn, writeTargets, payload) => ({
  type:'feature.create',eventId:'event.create.'+id,
  feature:{id,kind,dependsOn,writeTargets,payload},
});
let doc = newProject('project.recoverable.plate');
doc = commitEvent(doc, make('feature.sketch','sketch',[],['sketch.plate'],
  {widthMm:120,heightMm:80,holeCentersMm:[[30,40],[90,40]],holeRadiusMm:6}));
doc = commitEvent(doc, make('feature.extrude','extrude',['feature.sketch'],
  ['body.plate'],{thicknessMm:8,selectedProfileId:'sketch.plate'}));
doc = commitEvent(doc, make('feature.cut','cut',['feature.extrude'],
  ['body.plate'],{throughAll:true,targetBodyId:'body.plate'}));
doc = commitEvent(doc, make('feature.annotation','annotation',[],
  ['annotation.label'],{text:'plate'}));
const initial = doc;
const impact = inspectFeatureRemoval(doc,'feature.extrude');
assert.deepEqual(impact.transitiveDependents,['feature.cut']);
let session = startUndoHistory(doc);
// User explicitly chooses to retain the cut for later recovery, not to
// invent a new body or silently promote a stale preview.
session = commitUndoableFeatureRemoval(session,{
  format:FEATURE_LIFECYCLE_FORMAT,version:FEATURE_LIFECYCLE_VERSION,action:'remove',
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  featureId:'feature.extrude',mode:'keep_dependents_pending',
  confirmCascade:false,eventIds:['event.remove.extrude'],
});
assert.equal(planProject(session.document).features.find(
  item=>item.feature.id==='feature.cut').status,'pending');
session = deserializeModelArchive(serializeModelArchive(createModelArchive(session))).history;
session = commitUndoableFeatureRestoration(session,{
  format:FEATURE_LIFECYCLE_FORMAT,version:FEATURE_LIFECYCLE_VERSION,action:'restore',
  expectedProjectId:doc.projectId,expectedRevision:session.document.revision,
  featureIds:['feature.extrude'],eventIds:['event.restore.extrude'],
  admission:'require_ready',
});
const recovered = session.document;
assert.deepEqual(planProject(recovered).executableOrder,planProject(initial).executableOrder);
session = commitUndoableTransaction(session,[{
  type:'feature.edit',eventId:'event.edit.early.width',
  featureId:'feature.sketch',
  patch:{payload:{widthMm:150,heightMm:80,
    holeCentersMm:[[30,40],[90,40]],holeRadiusMm:6}},
}]);
const delta = planIncrementalEvaluation(recovered,session.document);
assert.deepEqual(delta.readyToEvaluate,
  ['feature.sketch','feature.extrude','feature.cut']);
assert.deepEqual(delta.unchangedReady,['feature.annotation']);
session = undoTransaction(session,['event.undo.width']);
session = redoTransaction(session,['event.redo.width']);
session = deserializeModelArchive(serializeModelArchive(createModelArchive(session))).history;
assert.equal(featuresOf(session.document).find(f=>f.id==='feature.sketch').payload.widthMm,150);
console.log(JSON.stringify({
  projectId:doc.projectId,revision:session.document.revision,
  deletionImpact:impact.transitiveDependents,
  cutOnRemovedExtrude:'pending, no current geometry asserted',
  restoredBodyId:'body.plate',
  revisedWidthMm:150,
  downstreamRebuild:delta.readyToEvaluate,
  reusableUnaffected:delta.unchangedReady,
  authority:'semantic model only — exact kernel and independent STEP not executed',
},null,2));
