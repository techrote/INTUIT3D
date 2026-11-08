import test from 'node:test';
import assert from 'node:assert/strict';
import * as sketch from '@intuit3d/sketch';
import * as model from '@intuit3d/model';
import {
  newModelPlateSession, modelSketchDimensionValues, modelHoleValues,
  undoModelSession, redoModelSession, serializeModelSession, reopenModelSession,
} from './runtimeSession.ts';
import {
  selectModelProfileAtPointer, inspectModelPointerProfile,
  dragModelPointerProfileHandle,
} from './pointerProfileBridge.ts';

function selected(history:ReturnType<typeof newModelPlateSession>){
  const hit=selectModelProfileAtPointer(history,60,65);
  assert.equal(hit.kind,'selected',JSON.stringify(hit));
  if(hit.kind!=='selected')throw Error('No selected contour');
  return hit.selection;
}
function widthHandle(history:ReturnType<typeof newModelPlateSession>,selection:ReturnType<typeof selected>){
  const inventory=inspectModelPointerProfile(history,selection);
  assert.equal(inventory.kind,'pointer_editable_handles',JSON.stringify(inventory));
  if(inventory.kind!=='pointer_editable_handles')throw Error('No semantic handles');
  const width=inventory.handles.find(h=>h.kind==='dimension'&&h.dimensionKind==='distanceX');
  assert.ok(width,'No width handle provided by accepted SKETCH');
  return width;
}

test('real selected linear contour edits width in one revision, persists and replays undo',()=>{
  const history=newModelPlateSession('workbench.pointer.contour');
  const selection=selected(history),handle=widthHandle(history,selection);
  const before=serializeModelSession(history);
  const change=dragModelPointerProfileHandle(history,selection,handle.handleId,{
    x:handle.position.x+20,y:handle.position.y,
  });
  assert.equal(change.history.document.revision,history.document.revision+1);
  assert.equal(modelSketchDimensionValues(change.history).width,140);
  assert.equal(modelSketchDimensionValues(history).width,120);
  assert.equal(serializeModelSession(history),before,'source history was mutated');
  assert.ok(change.invalidatedFeatureIds.includes('plate'));
  const reopened=reopenModelSession(serializeModelSession(change.history));
  assert.equal(modelSketchDimensionValues(reopened).width,140);
  assert.equal(modelSketchDimensionValues(undoModelSession(reopened)).width,120);
  assert.equal(modelSketchDimensionValues(redoModelSession(undoModelSession(reopened))).width,140);
  assert.equal(inspectModelPointerProfile(change.history,change.selection).kind,'pointer_editable_handles');
});

test('boundary, hole void and stale source refuse; original archive stays untouched',()=>{
  const original=newModelPlateSession('workbench.pointer.refusal');
  const before=serializeModelSession(original),selection=selected(original);
  const handle=widthHandle(original,selection);
  assert.notEqual(selectModelProfileAtPointer(original,35,40).kind,'selected',
    'A circular void must not become material');
  assert.notEqual(selectModelProfileAtPointer(original,120,20).kind,'selected',
    'An exact contour boundary must not become an arbitrary selected face');
  const edited=dragModelPointerProfileHandle(original,selection,handle.handleId,{
    x:handle.position.x+10,y:handle.position.y,
  });
  assert.throws(()=>inspectModelPointerProfile(edited.history,selection),/stale/i);
  assert.throws(()=>dragModelPointerProfileHandle(edited.history,selection,handle.handleId,{
    x:handle.position.x+15,y:handle.position.y,
  }),/stale/i);
  assert.equal(serializeModelSession(original),before);
});

test('authoritative sketch source and pointer adapter never modify model on read-only selection',()=>{
  const history=newModelPlateSession('workbench.pointer.read');
  const before=serializeModelSession(history),selection=selected(history);
  const inventory=inspectModelPointerProfile(history,selection);
  assert.equal(inventory.kind,'pointer_editable_handles');
  assert.equal(serializeModelSession(history),before);
  assert.equal(modelHoleValues(history).holeA.x,35);
  const source=model.featuresOf(history.document).find(f=>f.id==='sketch.plate');
  assert.ok(source);
  assert.equal(sketch.serializeSketch(sketch.validateSketch(source.payload.sketch)),selection.sourceSignature);
});
