
import assert from 'node:assert/strict';
import test from 'node:test';
import {commitEvent,featuresOf,newProject,planProject,ProjectFormatError,ProjectRevisionError,serializeProject} from '../src/index.ts';
import {startUndoHistory,undoTransaction,redoTransaction,serializeUndoHistory} from '../src/transactions.ts';
import {createModelArchive,serializeModelArchive,deserializeModelArchive} from '../src/archive.ts';
import {BODY_CUT_CHAIN_FORMAT,BODY_CUT_EXTENT_EDIT_FORMAT,commitUndoableBodyCutAppend,commitUndoableBodyCutExtentEdit,inspectBodyCutExtent,previewBodyCutExtentEdit} from '../src/body-cut-chain.ts';
const create=(id,kind,dependsOn,writeTargets,payload={})=>({eventId:'create.'+id,type:'feature.create',feature:{id,kind,dependsOn,writeTargets,payload}});
function fixture(){
 let doc=newProject('project.pocket.depth');
 doc=commitEvent(doc,create('sketch.plate','sketch',[],['sketch.plate'],{widthMm:120,heightMm:80}));
 doc=commitEvent(doc,create('sketch.slot','sketch',[],['sketch.slot'],{lengthMm:35,widthMm:8}));
 doc=commitEvent(doc,create('extrude.plate','extrude',['sketch.plate'],['body.plate'],{thicknessMm:8,sourceSketchId:'sketch.plate'}));
 doc=commitEvent(doc,create('cut.through','cut',['extrude.plate','sketch.slot'],['body.plate'],{sourceSketchId:'sketch.slot',targetBodyId:'body.plate',throughAll:true}));
 doc=commitEvent(doc,create('extrude.fixture','extrude',[],['body.fixture'],{thicknessMm:2}));
 let history=startUndoHistory(doc);
 history=commitUndoableBodyCutAppend(history,{format:BODY_CUT_CHAIN_FORMAT,version:1,eventId:'add.pocket',cutFeatureId:'cut.pocket',expectedProjectId:doc.projectId,expectedRevision:doc.revision,targetBodyId:'body.plate',afterBodyWriterId:'cut.through',sourceSketchId:'sketch.slot',profileCandidateId:'cycle:slot',extent:{kind:'blind',depthMm:3},admission:'require_ready'});
 return history;
}
function req(doc,changes={}) {
 return {format:BODY_CUT_EXTENT_EDIT_FORMAT,version:1,expectedProjectId:doc.projectId,expectedRevision:doc.revision,eventId:'edit.depth',cutFeatureId:'cut.through',targetBodyId:'body.plate',fromExtent:{kind:'through_all'},toExtent:{kind:'blind',depthMm:4},admission:'require_ready',...changes};
}
test('early through cut becomes blind while downstream pocket invalidates and independent solid stays reusable',()=>{
 const history=fixture(), frozen=serializeProject(history.document);
 const preview=previewBodyCutExtentEdit(history.document,req(history.document));
 assert.equal(preview.semanticStatus,'ready');
 assert.equal(preview.exactGeometryAuthority,false);
 assert.equal(preview.requiresNativeRebuild,true);
 assert.deepEqual(preview.invalidation.readyToEvaluate,['cut.through','cut.pocket']);
 for(const id of ['sketch.plate','sketch.slot','extrude.plate','extrude.fixture']) assert.ok(preview.invalidation.unchangedReady.includes(id));
 assert.equal(serializeProject(history.document),frozen);
 const cut=featuresOf(preview.document).find(f=>f.id==='cut.through');
 assert.equal(cut.payload.throughAll,false);
 assert.equal(cut.payload.depthMm,4);
 assert.equal(cut.payload.targetBodyId,'body.plate');
 assert.deepEqual(cut.dependsOn,['extrude.plate','sketch.slot']);
});
test('pocket depth can be edited, archived, undone, redone and switched to through_all without stale depth',()=>{
 let history=fixture();
 history=commitUndoableBodyCutExtentEdit(history,req(history.document,{eventId:'edit.pocket',cutFeatureId:'cut.pocket',fromExtent:{kind:'blind',depthMm:3},toExtent:{kind:'blind',depthMm:5}}));
 assert.equal(inspectBodyCutExtent(history.document,'cut.pocket','body.plate').extent.depthMm,5);
 history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
 history=undoTransaction(history,['undo.depth']);
 assert.equal(inspectBodyCutExtent(history.document,'cut.pocket','body.plate').extent.depthMm,3);
 history=redoTransaction(history,['redo.depth']);
 assert.equal(inspectBodyCutExtent(history.document,'cut.pocket','body.plate').extent.depthMm,5);
 history=commitUndoableBodyCutExtentEdit(history,req(history.document,{eventId:'to.through',cutFeatureId:'cut.pocket',fromExtent:{kind:'blind',depthMm:5},toExtent:{kind:'through_all'}}));
 const cut=featuresOf(history.document).find(f=>f.id==='cut.pocket');
 assert.equal(cut.payload.throughAll,true);
 assert.equal(Object.hasOwn(cut.payload,'depthMm'),false);
 assert.equal(cut.payload.profileCandidateId,'cycle:slot');
 assert.equal(planProject(history.document).features.every(f=>f.status==='ready'),true);
});
test('stale/invalid/wrong body, reused events, no-ops reject without changing journal or history',()=>{
 const history=fixture(), frozen=serializeUndoHistory(history);
 for(const change of [
  {cutFeatureId:'extrude.plate'}, {targetBodyId:'body.fixture'}, {fromExtent:{kind:'blind',depthMm:2}},
  {toExtent:{kind:'through_all'}}, {toExtent:{kind:'blind',depthMm:0}},
  {toExtent:{kind:'blind',depthMm:NaN}}, {toExtent:{kind:'through_all',depthMm:4}},
  {eventId:'create.cut.through'}, {unsupported:true}
 ]) assert.throws(()=>commitUndoableBodyCutExtentEdit(history,req(history.document,change)),ProjectFormatError);
 assert.throws(()=>commitUndoableBodyCutExtentEdit(history,req(history.document,{expectedRevision:0})),ProjectRevisionError);
 assert.equal(serializeUndoHistory(history),frozen);
});
test('pending cut remains pending in explicitly permissive mode; strict mode refuses',()=>{
 let doc=fixture().document;
 doc=commitEvent(doc,create('cut.future','cut',['cut.pocket','sketch.future'],['body.plate'],{targetBodyId:'body.plate',sourceSketchId:'sketch.future',throughAll:false,depthMm:2}));
 const edit=req(doc,{cutFeatureId:'cut.future',eventId:'edit.future',fromExtent:{kind:'blind',depthMm:2},toExtent:{kind:'blind',depthMm:5}});
 assert.throws(()=>previewBodyCutExtentEdit(doc,edit),ProjectFormatError);
 const staged=previewBodyCutExtentEdit(doc,{...edit,admission:'permit_unresolved'});
 assert.equal(staged.semanticStatus,'pending');
 assert.equal(staged.invalidation.readyToEvaluate.length,0);
 assert.ok(staged.invalidation.unresolved.some(row=>row.featureId==='cut.future'));
});
test('public demonstration runs',async()=>{await import('../examples/retrospective-pocket-depth.mjs');});
