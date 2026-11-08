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
  appendBlankContourPoint,canCloseBlankContour,placeBlankContourPointer,undoBlankContourVertex,
} from './blankContourDraft.ts';
import {
  commitModelBlankContour,startModelBlankContour,structuralContourRuntimeAvailable,
  inspectModelClosedContour,dragModelClosedContourVertex,
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

test('drawn vertex moves by selected semantic handle with one journal event, undo and archive reinspection',()=>{
  let current=newModelEmptySketchSession('workbench.blank.vertex');
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
    publishHistory:next=>{current=next;}});
  const initial=commitModelBlankContour(current,session,draw(current));
  assert.equal(initial.kind,'committed');
  if(initial.kind!=='committed')return;
  const inspected=inspectModelClosedContour(current,initial.selection);
  assert.equal(inspected?.kind,'closed_contour');
  assert.equal(inspected?.handles.length,4);
  const chosen=inspected!.handles[2];
  assert.deepEqual(chosen.position,{x:120,y:80});
  const sourceArchive=serializeModelSession(current);
  const oldRevision=current.document.revision;
  const moved=dragModelClosedContourVertex(current,session,initial.selection,
    chosen.handleId,{x:135,y:90},sourceArchive);
  assert.equal(moved.kind,'committed',JSON.stringify(moved));
  if(moved.kind!=='committed')return;
  assert.equal(current.document.revision,oldRevision+1);
  const after=inspectModelClosedContour(current,moved.selection);
  assert.deepEqual(after?.handles[2].position,{x:135,y:90});
  assert.deepEqual(after?.handles.map(h=>h.pointId),inspected?.handles.map(h=>h.pointId));
  assert.equal(serializeModelSession(reopenModelSession(serializeModelSession(current))),
    serializeModelSession(current));
  const undone=undoModelSession(current);
  assert.equal(modelCurrentSketch(undone).lines.length,4);
  const redone=redoModelSession(undone);
  const selectionAfterUndoRedo={
    ...moved.selection,sourceSignature:sketch.serializeSketch(modelCurrentSketch(redone)),
  };
  // Candidate identity is recomputed from the authoritative successor, never
  // from the stale pre-undo selection.
  assert.equal(modelCurrentSketch(redone).lines.length,4);
  assert.deepEqual(inspectModelClosedContour(redone,selectionAfterUndoRedo)?.handles[2].position,{x:135,y:90},
    'SKETCH solver constraints, not potentially stale source points, own the recovered coordinates');
  assert.equal(selectionAfterUndoRedo.sourceSignature,sketch.serializeSketch(modelCurrentSketch(redone)));
  const stale=dragModelClosedContourVertex(current,session,moved.selection,
    chosen.handleId,{x:140,y:90},sourceArchive);
  assert.equal(stale.kind,'refused');
  if(stale.kind==='refused')assert.equal(stale.code,'stale_source');
});
test('self-crossing drawn vertex movement refuses with unchanged authoritative archive',()=>{
  let current=newModelEmptySketchSession('workbench.blank.cross.vertex');
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
    publishHistory:next=>{current=next;}});
  const first=commitModelBlankContour(current,session,draw(current));
  assert.equal(first.kind,'committed');
  if(first.kind!=='committed')return;
  const inspected=inspectModelClosedContour(current,first.selection)!;
  const sourceArchive=serializeModelSession(current);
  const outcome=dragModelClosedContourVertex(current,session,first.selection,
    inspected.handles[2].handleId,{x:60,y:-20},sourceArchive);
  assert.equal(outcome.kind,'refused',JSON.stringify(outcome));
  assert.equal(serializeModelSession(current),sourceArchive);
  assert.equal(serializeModelSession(reopenModelSession(sourceArchive)),sourceArchive);
});

test('blank-canvas construction snap is signed, finite, bounded and offers Shift precision',()=>{
  assert.deepEqual(placeBlankContourPointer({x:120.190,y:80.325}),{x:120,y:80});
  assert.deepEqual(placeBlankContourPointer({x:0.499,y:-0.501}),{x:0,y:-1});
  assert.deepEqual(placeBlankContourPointer({x:0.5,y:-0.5}),{x:1,y:-1},
    'half-grid clicks must be symmetric about the sketch origin');
  assert.deepEqual(placeBlankContourPointer({x:-0.21,y:0.29}),{x:0,y:0});
  assert.deepEqual(placeBlankContourPointer({x:120.1904,y:-0.3254},true),
    {x:120.19,y:-0.325});
  for(const rejected of [{x:10000.1,y:0},{x:Infinity,y:0},{x:0,y:NaN}])
    assert.equal(placeBlankContourPointer(rejected),null);
});
test('quantized off-grid pointer clicks build an exact, undoable solver-owned rectangle',()=>{
  let current=newModelEmptySketchSession('workbench.blank.snap');
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
    publishHistory:next=>{current=next;}});
  const raw=[
    {x:0.21,y:-0.2},{x:119.78,y:0.31},
    {x:120.2,y:79.75},{x:-0.23,y:80.24},
  ];
  const initialRevision=current.document.revision;
  let draft=startModelBlankContour(current);
  for(const click of raw){
    const point=placeBlankContourPointer(click);
    assert.ok(point);
    const next=appendBlankContourPoint(draft,point!);
    assert.equal(next.kind,'added');
    if(next.kind!=='added')return;
    draft=next.draft;
  }
  assert.deepEqual(draft.vertices,rectangle);
  assert.equal(current.document.revision,initialRevision,'pointer drafting cannot commit a revision');
  const committed=commitModelBlankContour(current,session,draft);
  assert.equal(committed.kind,'committed',JSON.stringify(committed));
  if(committed.kind!=='committed')return;
  assert.deepEqual(inspectModelClosedContour(current,committed.selection)?.handles.map(p=>p.position),
    rectangle,'SKETCH owns exact admitted positions, not rounded preview pixels');
  const archive=serializeModelSession(current);
  assert.equal(serializeModelSession(reopenModelSession(archive)),archive);
  assert.equal(modelSketchIsEmpty(undoModelSession(current)),true);
});
