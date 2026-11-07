
/** Authoritative journal demonstration only: not a B-rep/STEP execution.
 * node packages/model/examples/retrospective-pocket-depth.mjs
 */
import assert from 'node:assert/strict';
import {newProject,commitEvent,featuresOf,planProject} from '../src/index.ts';
import {startUndoHistory,undoTransaction,redoTransaction} from '../src/transactions.ts';
import {createModelArchive,serializeModelArchive,deserializeModelArchive} from '../src/archive.ts';
import {BODY_CUT_CHAIN_FORMAT,BODY_CUT_EXTENT_EDIT_FORMAT,commitUndoableBodyCutAppend,commitUndoableBodyCutExtentEdit,inspectBodyCutChain,inspectBodyCutExtent,previewBodyCutExtentEdit} from '../src/body-cut-chain.ts';
const create=(id,kind,dependsOn,writeTargets,payload)=>({eventId:'create.'+id,type:'feature.create',feature:{id,kind,dependsOn,writeTargets,payload}});
let doc=newProject('project.retro.pocket');
doc=commitEvent(doc,create('sketch.plate','sketch',[],['sketch.plate'],{widthMm:120,heightMm:80,holePitchMm:60}));
doc=commitEvent(doc,create('sketch.slot','sketch',[],['sketch.slot'],{lengthMm:35,widthMm:8}));
doc=commitEvent(doc,create('extrude.plate','extrude',['sketch.plate'],['body.plate'],{sourceSketchId:'sketch.plate',thicknessMm:8}));
doc=commitEvent(doc,create('cut.through','cut',['extrude.plate','sketch.slot'],['body.plate'],{sourceSketchId:'sketch.slot',targetBodyId:'body.plate',throughAll:true}));
doc=commitEvent(doc,create('extrude.fixture','extrude',[],['body.fixture'],{thicknessMm:2}));
let history=startUndoHistory(doc);
history=commitUndoableBodyCutAppend(history,{
 format:BODY_CUT_CHAIN_FORMAT,version:1,expectedProjectId:doc.projectId,
 expectedRevision:doc.revision,eventId:'create.pocket',cutFeatureId:'cut.pocket',
 targetBodyId:'body.plate',afterBodyWriterId:'cut.through',sourceSketchId:'sketch.slot',
 profileCandidateId:'cycle:slot',extent:{kind:'blind',depthMm:3},admission:'require_ready'
});
const request={
 format:BODY_CUT_EXTENT_EDIT_FORMAT,version:1,expectedProjectId:doc.projectId,
 expectedRevision:history.document.revision,eventId:'edit.early.cut',
 cutFeatureId:'cut.through',targetBodyId:'body.plate',
 fromExtent:{kind:'through_all'},toExtent:{kind:'blind',depthMm:4},
 admission:'require_ready'
};
const preview=previewBodyCutExtentEdit(history.document,request);
assert.deepEqual(preview.invalidation.readyToEvaluate,['cut.through','cut.pocket']);
assert.ok(preview.invalidation.unchangedReady.includes('extrude.fixture'));
history=commitUndoableBodyCutExtentEdit(history,request);
history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
assert.equal(inspectBodyCutExtent(history.document,'cut.through','body.plate').extent.depthMm,4);
history=undoTransaction(history,['undo.early.cut']);
assert.deepEqual(inspectBodyCutExtent(history.document,'cut.through','body.plate').extent,{kind:'through_all'});
history=redoTransaction(history,['redo.early.cut']);
assert.equal(inspectBodyCutExtent(history.document,'cut.through','body.plate').extent.depthMm,4);
assert.equal(featuresOf(history.document).find(f=>f.id==='cut.pocket').payload.depthMm,3);
assert.equal(planProject(history.document).features.every(f=>f.status==='ready'),true);
console.log(JSON.stringify({
 modelAuthority:'semantic_only',projectId:history.document.projectId,
 revision:history.document.revision,bodyId:'body.plate',
 bodyWriters:inspectBodyCutChain(history.document,'body.plate').bodyWriterIds,
 previousExtent:{kind:'through_all'},newExtent:{kind:'blind',depthMm:4},
 invalidated:preview.invalidation.readyToEvaluate,
 independentBodyReused:preview.invalidation.unchangedReady.includes('extrude.fixture'),
 archiveUndoRedo:'passed',physicalBoolean:'not_executed',
 nativeStep:'not_executed',independentCad:'not_executed'
},null,2));
