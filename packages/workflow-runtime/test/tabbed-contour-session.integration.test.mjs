/** SKETCH #342 → RUNTIME #338: one source-owned tab through the INTENT journal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createClosedContour} from '@intuit3d/sketch/closed-contour-authoring/v1';
import {insertClosedContourTab,editTabbedContourVertex,inspectTabbedClosedContour}
  from '@intuit3d/sketch/closed-contour-insertion/v1';
import {createWorkflowRuntime,CLOSED_CONTOUR_TRANSACTION_FORMAT,
  TABBED_CONTOUR_TRANSACTION_FORMAT} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const empty=()=>sketch.validateSketch({version:1,units:'mm',
  points:[],lines:[],circles:[],constraints:[]});
const feature=(id,kind,dependsOn,writeTargets,payload)=>({
  id,kind,dependsOn,writeTargets,payload});
const start=(prefix='seed')=>runtime.commit(
  transactions.startUndoHistory(model.newProject('runtime.tabbed.journey')),[
    {eventId:prefix+'.sketch',type:'feature.create',
      feature:feature('sketch.plate','sketch',[],[],{sketch:empty()})},
    {eventId:prefix+'.plate',type:'feature.create',
      feature:feature('plate','extrude',['sketch.plate'],['body.plate'],
        {sourceSketchId:'sketch.plate',thicknessMm:8})},
    {eventId:prefix+'.cut',type:'feature.create',
      feature:feature('cut','cut',['plate'],['body.plate'],
        {sourceSketchId:'sketch.plate',targetBodyId:'body.plate'})},
  ]);
const source=h=>model.featuresOf(h.document).find(f=>f.id==='sketch.plate').payload.sketch;
const outline=h=>{
  const doc=source(h),stamp=sketch.serializeSketch(doc);
  const command={kind:'create-closed-contour',version:1,
    sourceSignature:stamp,contourId:'panel',vertices:[
      {x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}]};
  const acceptance=createClosedContour(doc,command);
  assert.equal(acceptance.kind,'accepted',JSON.stringify(acceptance));
  const committed=runtime.commitClosedContour(h,{
    format:CLOSED_CONTOUR_TRANSACTION_FORMAT,version:1,
    expectedProjectId:h.document.projectId,
    expectedRevision:h.document.revision,expectedArchive:runtime.save(h),
    expectedSketchSignature:stamp,sketchFeatureId:'sketch.plate',
    eventId:'seed.contour',operation:'create',command,acceptance});
  assert.equal(committed.kind,'committed',JSON.stringify(committed));
  return committed;
};
const withHole=()=>{
  const closed=outline(start());
  const bore=runtime.editSelectedProfileHole(closed.history,{
    sketchFeatureId:'sketch.plate',eventId:'seed.bore',
    expectedRevision:closed.history.document.revision,
    selection:closed.selection,
    command:{kind:'add-hole',sourceSignature:sketch.serializeSketch(source(closed.history)),
      holeId:'bore',anchorPointId:'panel:vertex:2',
      xMm:85,yMm:45,radiusMm:5}});
  assert.equal(bore.kind,'committed',JSON.stringify(bore));
  return {history:bore.history,selection:bore.selection};
};
const tab=(h,selection,operation='insert',overrides={})=>{
  const doc=source(h),stamp=sketch.serializeSketch(doc);
  const command=operation==='insert'
    ?{kind:'insert-closed-contour-tab',version:1,sourceSignature:stamp,
      contourId:'panel',edgeId:'panel:edge:1',tabId:'panelTab',
      vertices:[{x:140,y:20},{x:140,y:60}]}
    :{kind:'edit-tabbed-contour-vertex',version:1,sourceSignature:stamp,
      contourId:'panel',tabId:'panelTab',
      handleId:'panel:handle:2',target:{x:125,y:85}};
  Object.assign(command,overrides.command||{});
  const acceptance=operation==='insert'
    ?insertClosedContourTab(doc,selection,command)
    :editTabbedContourVertex(doc,selection,command);
  return {command,acceptance,request:{
    format:TABBED_CONTOUR_TRANSACTION_FORMAT,version:1,
    expectedProjectId:h.document.projectId,
    expectedRevision:h.document.revision,expectedArchive:runtime.save(h),
    expectedSketchSignature:stamp,sketchFeatureId:'sketch.plate',
    eventId:operation+'.'+h.document.revision,operation,
    selection,command,acceptance,...(overrides.request||{})}};
};
const holder=h=>{
  let current=h,nativeCalls=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,publishHistory:next=>{current=next;},
    evaluateImpl:async()=>{nativeCalls++;throw Error('unexpected provider invocation');}});
  return {session,get history(){return current;},get nativeCalls(){return nativeCalls;}};
};
const send=(session,request)=>{
  const {expectedProjectId:projectId,expectedRevision,...rest}=request;
  return session.applyCommand({kind:'sketch.tabbed-contour/v1',
    projectId,expectedRevision,request:rest});
};

test('reviewed tab insertion, retrospective vertex/hole edit, dependent invalidation, undo/redo and archive replay',()=>{
  const original=withHole(),user=holder(original.history);
  const insertion=tab(user.history,original.selection);
  assert.equal(insertion.acceptance.kind,'accepted',JSON.stringify(insertion.acceptance));
  const inserted=send(user.session,insertion.request);
  assert.equal(inserted.kind,'committed',JSON.stringify(inserted));
  assert.deepEqual(inserted.contourReceipt.retiredEdgeIds,['panel:edge:1']);
  assert.equal(inserted.contourReceipt.tabId,'panelTab');
  assert.deepEqual(inserted.invalidation.invalidatedFeatureIds,
    ['sketch.plate','plate','cut']);
  assert.equal(source(user.history).lines.some(l=>l.id==='panel:edge:1'),false);
  assert.deepEqual(source(user.history).circles.map(x=>x.id),['bore']);
  assert.equal(user.session.currentStep(),null);
  assert.equal(user.session.refresh().stepAvailability,'unavailable');
  const afterInsertion=user.session.save();

  const edit=tab(user.history,inserted.contourReceipt.selection,'edit');
  assert.equal(edit.acceptance.kind,'accepted',JSON.stringify(edit.acceptance));
  const edited=send(user.session,edit.request);
  assert.equal(edited.kind,'committed',JSON.stringify(edited));
  assert.deepEqual(edit.acceptance.movedDependentHoles.map(x=>x.to),
    [{x:90,y:50}]);
  const saved=user.session.save(),reopened=runtime.reopen(saved);
  assert.equal(runtime.save(reopened),saved);
  const inspection=inspectTabbedClosedContour(source(reopened),
    edited.contourReceipt.selection,'panel','panelTab');
  assert.equal(inspection.kind,'tabbed_closed_contour');
  assert.equal(inspection.handles.length,6);
  const undone=runtime.undo(reopened,['undo.tab.vertex']);
  assert.equal(sketch.serializeSketch(source(undone)),
    sketch.serializeSketch(source(runtime.reopen(afterInsertion))));
  const redone=runtime.redo(undone,['redo.tab.vertex']);
  assert.equal(sketch.serializeSketch(source(redone)),
    edit.acceptance.nextSourceSignature);
  assert.equal(user.nativeCalls,0,'analytic journal is not physical STEP');
  console.log('RUNTIME_TABBED_CONTOUR_AUTHORITATIVE_JOURNAL_PASS');
});

test('equal-revision divergent source, wrong edge, forged acceptance and invalid tab refuse without publication',()=>{
  const original=withHole(),user=holder(original.history);
  const positive=tab(user.history,original.selection);
  assert.equal(positive.acceptance.kind,'accepted');
  const before=user.session.save();
  const other=start('alternate');
  assert.equal(other.document.projectId,user.history.document.projectId);
  assert.notEqual(runtime.save(other),before);
  // A different but equally numbered source cannot consume an older request.
  // The distinct empty source here also shows project/revision alone is insufficient.
  const different=runtime.commit(other,[
    {eventId:'alternate.contour',type:'feature.edit',featureId:'sketch.plate',
     patch:{payload:{sketch:source(user.history)}}},
    {eventId:'alternate.thickness',type:'feature.edit',featureId:'plate',
     patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:9}}},
  ],other.document.revision);
  assert.equal(different.document.revision,user.history.document.revision);
  assert.equal(runtime.commitTabbedContour(different,positive.request).code,'stale_source');

  const wrongEdge=tab(user.history,original.selection,'insert',
    {command:{edgeId:'panel:edge:absent'}});
  assert.equal(send(user.session,wrongEdge.request).code,'sketch_refused');
  const zero=tab(user.history,original.selection,'insert',
    {command:{vertices:[{x:120,y:20},{x:120,y:60}]}});
  assert.equal(send(user.session,zero.request).code,'sketch_refused');
  const forged={...positive.request,acceptance:{...positive.acceptance,
    sketch:{...positive.acceptance.sketch,lines:[]}}};
  assert.equal(send(user.session,forged).code,'changed_acceptance');
  assert.equal(send(user.session,{...positive.request,
    selection:{candidateId:'not-the-selected-contour',
      sourceSignature:positive.request.expectedSketchSignature}}).code,'sketch_refused');
  assert.equal(user.session.save(),before);
  assert.equal(user.nativeCalls,0);
});

test('an authored downstream reference to a retired edge refuses without changing the project',()=>{
  const original=withHole();
  const cut=model.featuresOf(original.history.document).find(f=>f.id==='cut');
  const referenced=runtime.commit(original.history,[{
    eventId:'cut.references.source.edge',type:'feature.edit',featureId:'cut',
    patch:{payload:{...cut.payload,sourceEdgeId:'panel:edge:1'}},
  }]);
  const user=holder(referenced),candidate=tab(user.history,original.selection);
  assert.equal(candidate.acceptance.kind,'accepted');
  const baseline=user.session.save();
  const result=send(user.session,candidate.request);
  assert.equal(result.kind,'refused');
  assert.equal(result.code,'retired_reference');
  assert.equal(user.session.save(),baseline);
  assert.equal(user.nativeCalls,0);
});
