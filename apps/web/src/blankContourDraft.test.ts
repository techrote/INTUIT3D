import test from 'node:test';
import assert from 'node:assert/strict';
import * as sketch from '@intuit3d/sketch';
import {createClosedContour} from '@intuit3d/sketch/closed-contour-authoring/v1';
import {createLivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
import {
  createModelExtrusion,inspectModelSession,modelCurrentSketch,
  modelFeatureTimeline,modelSketchHasPlateDimensions,modelSketchIsEmpty,
  newModelEmptySketchSession,reopenModelSession,redoModelSession,runtime,
  serializeModelSession,undoModelSession,
} from './runtimeSession.ts';
import {
  appendBlankContourPoint,canCloseBlankContour,undoBlankContourVertex,
} from './blankContourDraft.ts';
import {
  commitModelBlankContour,startModelBlankContour,structuralContourRuntimeAvailable,
} from './closedContourBridge.ts';

const rectangle=[{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}];
function draw(history:ReturnType<typeof newModelEmptySketchSession>,points=rectangle){
  let draft=startModelBlankContour(history);
  for(const point of points){
    const step=appendBlankContourPoint(draft,point);
    assert.equal(step.kind,'added',step.kind==='refused'?step.reason:'');
    if(step.kind!=='added')throw Error('invalid drawing fixture');
    draft=step.draft;
  }
  return draft;
}
test('a genuinely empty project has no template vertices, circles or undoable seed',()=>{
  const h=newModelEmptySketchSession('workbench.blank.test');
  assert.equal(modelSketchIsEmpty(h),true);
  assert.equal(modelSketchHasPlateDimensions(h),false);
  assert.equal(modelCurrentSketch(h).lines.length,0);
  assert.equal(modelCurrentSketch(h).circles.length,0);
  assert.deepEqual(modelFeatureTimeline(h).map(f=>f.featureId),['sketch.plate']);
  assert.equal(h.undoStack.length,0);
  assert.equal(inspectModelSession(h).features[0].status!=='analytic_profile_only',true);
  const reopened=reopenModelSession(serializeModelSession(h));
  assert.equal(modelSketchIsEmpty(reopened),true);
  assert.equal(serializeModelSession(reopened),serializeModelSession(h));
});
test('pointer clicks are ephemeral; duplicate, nonfinite and too-many vertices refuse',()=>{
  const h=newModelEmptySketchSession('workbench.blank.draft');
  let draft=startModelBlankContour(h);
  assert.equal(canCloseBlankContour(draft),false);
  let first=appendBlankContourPoint(draft,{x:0,y:0});
  assert.equal(first.kind,'added');
  if(first.kind!=='added')return;
  draft=first.draft;
  assert.equal(appendBlankContourPoint(draft,{x:0,y:0}).kind,'refused');
  assert.equal(appendBlankContourPoint(draft,{x:Infinity,y:2}).kind,'refused');
  draft=undoBlankContourVertex(draft);
  assert.equal(draft.vertices.length,0);
  assert.equal(serializeModelSession(h),draft.expectedArchive);
  assert.equal(h.undoStack.length,0);
  const many=draw(h,Array.from({length:12},(_,i)=>({x:i*10,y:0})));
  assert.equal(appendBlankContourPoint(many,{x:120,y:0}).kind,'refused');
});
test('real SKETCH accepts rectangular click sequence and refuses a crossing polygon',()=>{
  const h=newModelEmptySketchSession('workbench.blank.geometry');
  const valid=draw(h);
  assert.equal(canCloseBlankContour(valid),true);
  const source=modelCurrentSketch(h);
  const build=(d:typeof valid)=>createClosedContour(source,{
    kind:'create-closed-contour',version:1,
    sourceSignature:sketch.serializeSketch(source),
    contourId:d.contourId,vertices:d.vertices.map(p=>({...p})),
  });
  const accepted=build(valid);
  assert.equal(accepted.kind,'accepted',JSON.stringify(accepted));
  if(accepted.kind==='accepted'){
    assert.equal(accepted.profile.nativeExact,false);
    assert.equal(accepted.sketch.lines.length,4);
  }
  assert.equal(build(draw(h,[{x:0,y:0},{x:120,y:80},{x:0,y:80},{x:120,y:0}])).kind,'refused');
  assert.equal(modelSketchIsEmpty(h),true,'SKETCH proposals never write the model');
});
test('from-empty committed contour uses the only live RUNTIME journal, then undo/reopen/redo',()=>{
  // #319 is accepted on main. A missing structural transaction is now an
  // integration regression, never a reason to silently skip the CAD journey.
  assert.equal(structuralContourRuntimeAvailable(),true,
    'accepted RUNTIME structural contour contract must be available');
  let current=newModelEmptySketchSession('workbench.blank.runtime');
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
    publishHistory:next=>{current=next;}});
  const draft=draw(current);
  const receipt=commitModelBlankContour(current,session,draft);
  assert.equal(receipt.kind,'committed',JSON.stringify(receipt));
  if(receipt.kind!=='committed')return;
  assert.equal(current.document.revision,draft.revision+1);
  assert.equal(modelSketchIsEmpty(current),false);
  assert.equal(receipt.selection.sourceSignature,sketch.serializeSketch(modelCurrentSketch(current)));
  assert.equal(session.currentStep(),null);
  const extruded=createModelExtrusion(current,8);
  assert.equal(inspectModelSession(extruded).features.find(f=>f.featureId==='plate')?.status,'preview_only');
  const reopened=reopenModelSession(serializeModelSession(extruded));
  assert.equal(serializeModelSession(reopened),serializeModelSession(extruded));
  const undo=undoModelSession(reopened);
  assert.equal(modelFeatureTimeline(undo).some(f=>f.featureId==='plate'&&f.active),false);
  const undoneOutline=undoModelSession(undo);
  assert.equal(modelSketchIsEmpty(undoneOutline),true);
  const redone=redoModelSession(redoModelSession(undoneOutline));
  assert.equal(modelSketchIsEmpty(redone),false);
  assert.equal(inspectModelSession(redone).features.find(f=>f.featureId==='plate')?.status,'preview_only');
});
test('equal revision divergent canonical source cannot reuse reviewed clicks',()=>{
  const source=newModelEmptySketchSession('workbench.blank.source');
  const draft=draw(source);
  const divergent=newModelEmptySketchSession('workbench.blank.diverged');
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>divergent,
    publishHistory:()=>{throw Error('no mutation allowed');}});
  const refusal=commitModelBlankContour(divergent,session,draft);
  assert.equal(refusal.kind,'refused');
  if(refusal.kind==='refused')assert.equal(refusal.code,'stale_source');
  assert.equal(modelSketchIsEmpty(divergent),true);
});
