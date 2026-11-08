/** One authoritative SKETCH -> INTENT -> RUNTIME structural authoring path. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createClosedContour,editClosedContourVertices} from '@intuit3d/sketch/closed-contour-authoring/v1';
import {createWorkflowRuntime,CLOSED_CONTOUR_TRANSACTION_FORMAT} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const empty=()=>sketch.validateSketch({version:1,units:'mm',
  points:[],lines:[],circles:[],constraints:[]});
const create=(id,feature)=>({eventId:id,type:'feature.create',feature});
const initial=(sketchDoc=empty(),eventPrefix='seed')=>runtime.commit(
  transactions.startUndoHistory(model.newProject('runtime.contour.journey')),[
    create(eventPrefix+'.sketch',{id:'sketch.plate',kind:'sketch',
      dependsOn:[],writeTargets:[],payload:{sketch:sketchDoc}}),
    create(eventPrefix+'.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create(eventPrefix+'.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
const source=h=>model.featuresOf(h.document).find(f=>f.id==='sketch.plate').payload.sketch;
const rect=(x=0,y=0)=>[{x,y},{x:x+120,y},{x:x+120,y:y+80},{x,y:y+80}];
const author=(h,{operation='create',contourId='drawn',vertices=rect(),
    changes,selection,acceptance,command}={})=>{
  const doc=source(h),signature=sketch.serializeSketch(doc);
  const skCommand=command??(operation==='create'
    ?{kind:'create-closed-contour',version:1,sourceSignature:signature,contourId,vertices}
    :{kind:'edit-closed-contour-vertices',version:1,sourceSignature:signature,contourId,changes});
  const accepted=acceptance??(operation==='create'
    ?createClosedContour(doc,skCommand)
    :editClosedContourVertices(doc,selection,skCommand));
  return {skCommand,accepted,request:{
    format:CLOSED_CONTOUR_TRANSACTION_FORMAT,version:1,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    expectedArchive:runtime.save(h),expectedSketchSignature:signature,
    sketchFeatureId:'sketch.plate',eventId:'contour.'+h.document.revision,
    operation,command:skCommand,acceptance:accepted,
    ...(operation==='create'?{}:{selection}),
  }};
};
const sessionOn=initialHistory=>{
  let current=initialHistory,nativeCalls=0;
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
    publishHistory:h=>{current=h;},evaluateImpl:async()=>{
      nativeCalls++;throw Error('native evaluation must not run for semantic tests');
    }});
  return {session,get history(){return current;},
    get nativeCalls(){return nativeCalls;}};
};
const submit=(session,request)=>session.applyCommand({
  kind:'sketch.contour/v1',projectId:request.expectedProjectId,
  expectedRevision:request.expectedRevision,
  request:Object.fromEntries(Object.entries(request).filter(([k])=>
    k!=='expectedProjectId'&&k!=='expectedRevision')),
});

test('empty sketch to solved selected contour, dependent extrude/cut, retrospective edit, one-frame undo/redo and archive replay',()=>{
  const user=sessionOn(initial()),before=user.session.save();
  const first=author(user.history);
  assert.equal(first.accepted.kind,'accepted',JSON.stringify(first.accepted));
  const firstCommitted=submit(user.session,first.request);
  assert.equal(firstCommitted.kind,'committed');
  assert.equal(firstCommitted.contourReceipt.selection.sourceSignature,
    first.accepted.nextSourceSignature);
  assert.equal(firstCommitted.contourReceipt.exactAuthority,false);
  assert.equal(user.history.document.revision,4);
  assert.equal(user.session.currentStep(),null);
  assert.equal(user.session.refresh().stepAvailability,'unavailable');
  assert.equal(runtime.inspect(user.history).features.find(f=>f.featureId==='plate').status,'preview_only');
  assert.equal(runtime.inspect(user.history).features.find(f=>f.featureId==='cut').status,'pending_exact_provider');
  assert.equal(source(user.history).lines.length,4);
  const selected=first.accepted.selection;
  const edit=author(user.history,{operation:'edit',contourId:'drawn',
    selection:{...selected,sourceSignature:sketch.serializeSketch(source(user.history))},
    changes:[{index:1,xMm:150,yMm:0},{index:2,xMm:150,yMm:80}]});
  assert.equal(edit.accepted.kind,'accepted',JSON.stringify(edit.accepted));
  const next=submit(user.session,edit.request);
  assert.equal(next.kind,'committed',JSON.stringify(next));
  assert.deepEqual(next.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(next.contourReceipt.selection.candidateId,edit.accepted.selection.candidateId);
  assert.equal(next.contourReceipt.nextSketchSignature,edit.accepted.nextSourceSignature);
  assert.equal(next.report.exactGeometryAvailable,false);
  assert.equal(user.session.currentStep(),null);
  const edited=runtime.save(user.history);
  const reopened=runtime.reopen(edited);
  assert.equal(runtime.save(reopened),edited);
  assert.equal(sketch.serializeSketch(source(reopened)),edit.accepted.nextSourceSignature);
  const undo=runtime.undo(reopened,['undo.contour.edit']);
  assert.equal(sketch.serializeSketch(source(undo)),first.accepted.nextSourceSignature);
  const redo=runtime.redo(undo,['redo.contour.edit']);
  assert.equal(sketch.serializeSketch(source(redo)),edit.accepted.nextSourceSignature);
  assert.notEqual(runtime.save(user.history),before);
  assert.equal(user.nativeCalls,0);
  user.session.cancel();
});

test('same-revision divergent archive, stale sketch, forged selection and entity loss refuse with no journal publication',()=>{
  const user=sessionOn(initial()),draft=author(user.history),baseline=user.session.save();
  const divergence=initial(empty(),'alternative');
  assert.equal(divergence.document.revision,user.history.document.revision);
  assert.notEqual(runtime.save(divergence),baseline);
  assert.equal(runtime.commitClosedContour(divergence,draft.request).code,'stale_source');
  assert.equal(submit(user.session,{...draft.request,expectedSketchSignature:'forged'}).code,'stale_sketch');
  assert.equal(submit(user.session,{...draft.request,
    acceptance:{...draft.accepted,
      selection:{...draft.accepted.selection,candidateId:'wrong'}}}).code,'changed_acceptance');
  assert.equal(submit(user.session,{...draft.request,
    acceptance:{...draft.accepted,
      sketch:{...draft.accepted.sketch,lines:[]}}}).code,'changed_acceptance');
  assert.equal(user.session.save(),baseline);
  assert.equal(user.history.document.revision,3);
  assert.equal(user.nativeCalls,0);
  user.session.cancel();
});

test('crossing contour, stale follow-up and wrong edited selection refuse; unrelated holes survive a separately admitted contour',()=>{
  const user=sessionOn(initial(sketch.plateSketchFixture()));
  const holes=source(user.history).circles.map(c=>c.id);
  const valid=author(user.history,{contourId:'outside',vertices:rect(250,200)});
  assert.equal(valid.accepted.kind,'accepted',JSON.stringify(valid.accepted));
  // The SKETCH selected proposal is valid, but a second contour makes a
  // single-profile physical plate export ambiguous. Explicitly retain intent.
  const blocked=submit(user.session,valid.request);
  assert.equal(blocked.code,'inadmissible_sketch');
  assert.equal(user.history.document.revision,3);
  const accepted=submit(user.session,{...valid.request,admission:'preserve_unresolved'});
  assert.equal(accepted.kind,'committed',JSON.stringify(accepted));
  assert.deepEqual(source(user.history).circles.map(c=>c.id),holes);
  assert.equal(accepted.report.features.find(f=>f.featureId==='sketch.plate').status,'invalid_profile');
  assert.equal(submit(user.session,valid.request).code,'stale_revision');
  const archiveNow=user.session.save(),signature=sketch.serializeSketch(source(user.history));
  const badCommand={kind:'create-closed-contour',version:1,sourceSignature:signature,
    contourId:'crossing',vertices:rect(110,70)};
  const bad=author(user.history,{command:badCommand,acceptance:valid.accepted});
  assert.equal(submit(user.session,bad.request).code,'sketch_refused');
  const changed=author(user.history,{operation:'edit',contourId:'outside',
    selection:{candidateId:'not-a-contour',sourceSignature:signature},
    changes:[{index:1,xMm:380,yMm:200}],acceptance:valid.accepted});
  assert.equal(submit(user.session,changed.request).code,'sketch_refused');
  assert.equal(user.session.save(),archiveNow);
  assert.equal(user.session.currentStep(),null);
  assert.equal(user.nativeCalls,0);
  user.session.cancel();
});
