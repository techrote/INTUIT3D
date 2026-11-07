/**
 * A user repairs the authored cut when its original extrusion was removed and
 * replaced. The new 12 mm plate and original cut/fillet keep their semantic IDs.
 * This is a MODEL-only demonstration; it makes no physical B-rep/STEP claim.
 */
import assert from 'node:assert/strict';
import {commitEvent,newProject,featuresOf,planProject} from '../src/index.ts';
import {startUndoHistory,undoTransaction,redoTransaction,
  commitUndoableTransaction} from '../src/transactions.ts';
import {createModelArchive,serializeModelArchive,
  deserializeModelArchive} from '../src/archive.ts';
import {planIncrementalEvaluation} from '../src/incremental.ts';
import {
  CUT_REATTACHMENT_FORMAT,CUT_REATTACHMENT_VERSION,
  inspectCutReattachment,commitUndoableCutReattachment,
} from '../src/cut-reattachment.ts';

const make=(id,kind,dependsOn,writeTargets,payload)=>({
  eventId:'event.create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
let doc=newProject('project.repaired.mounting.plate');
doc=commitEvent(doc,make('feature.sketch','sketch',[],['sketch.plate'],
  {widthMm:120,heightMm:80,holes:[{id:'hole.a',x:30,y:40,r:5},
    {id:'hole.b',x:90,y:40,r:5}]}));
doc=commitEvent(doc,make('feature.extrude.old','extrude',['feature.sketch'],
  ['body.plate'],{sourceSketchId:'feature.sketch',thicknessMm:8}));
doc=commitEvent(doc,make('feature.cut','cut',['feature.extrude.old'],
  ['body.plate'],{targetBodyId:'body.plate',throughAll:true}));
doc=commitEvent(doc,make('feature.fillet','fillet',['feature.cut'],
  ['body.plate'],{radiusMm:2}));
doc=commitEvent(doc,make('feature.unrelated','extrude',[],['body.mount'],
  {thicknessMm:3}));
doc=commitEvent(doc,{eventId:'event.remove.old',type:'feature.remove',
  featureId:'feature.extrude.old'});
doc=commitEvent(doc,make('feature.extrude.new','extrude',['feature.sketch'],
  ['body.plate'],{sourceSketchId:'feature.sketch',thicknessMm:12}));
const offered=inspectCutReattachment(doc,'feature.cut');
assert.deepEqual(offered.removedProducerIds,['feature.extrude.old']);
assert.deepEqual(offered.activeReplacementIds,['feature.extrude.new']);
let history=startUndoHistory(doc);
history=commitUndoableCutReattachment(history,{
  format:CUT_REATTACHMENT_FORMAT,version:CUT_REATTACHMENT_VERSION,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  cutFeatureId:'feature.cut',removedProducerId:'feature.extrude.old',
  replacementProducerId:'feature.extrude.new',bodyId:'body.plate',
  eventId:'event.reattach',admission:'require_ready',
});
assert.equal(planProject(history.document).features
  .find(x=>x.feature.id==='feature.cut').status,'ready');
history=deserializeModelArchive(serializeModelArchive(
  createModelArchive(history))).history;
history=undoTransaction(history,['event.undo.repair']);
history=redoTransaction(history,['event.redo.repair']);
const before=history.document;
history=commitUndoableTransaction(history,[{
  type:'feature.edit',eventId:'event.edit.width',
  featureId:'feature.sketch',
  patch:{payload:{widthMm:150,heightMm:80,
    holes:[{id:'hole.a',x:30,y:40,r:5},{id:'hole.b',x:90,y:40,r:5}]}},
}]);
const rebuild=planIncrementalEvaluation(before,history.document);
assert.deepEqual(rebuild.readyToEvaluate,[
  'feature.sketch','feature.extrude.new','feature.cut','feature.fillet']);
assert.deepEqual(rebuild.unchangedReady,['feature.unrelated']);
history=deserializeModelArchive(serializeModelArchive(
  createModelArchive(history))).history;
assert.equal(featuresOf(history.document).find(f=>f.id==='feature.cut')
  .payload.targetBodyId,'body.plate');
console.log(JSON.stringify({
  revision:history.document.revision,
  originalExtrusion:'removed journal tombstone (not physical shape)',
  replacement:'feature.extrude.new',
  targetBody:'body.plate',
  recoveredCut:'feature.cut',
  widthMm:150,
  undoRedoAndArchive:true,
  changedBranch:rebuild.readyToEvaluate,
  unrelatedReusable:rebuild.unchangedReady,
  geometricAuthority:'semantic intent only; native rebuild and external STEP required',
},null,2));
