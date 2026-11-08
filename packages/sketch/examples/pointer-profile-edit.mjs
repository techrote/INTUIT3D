import assert from 'node:assert/strict';
import {parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {selectContourAtPointer} from '../pointer-contour-selection.mjs';
import {inspectPointerEditableHandles,pickProfileHandleAtPointer,
  dragProfileHandleAtPointer} from '../pointer-profile-edit.mjs';

const original=createDimensionedLPlateSketch();
const sourceSignature=serializeSketch(original);
const selected=selectContourAtPointer(original,{
  kind:'select-contour-at-pointer',version:1,sourceSignature,
  point:{x:10,y:40},boundaryClearanceMm:0.1
});
assert.equal(selected.kind,'selected',JSON.stringify(selected));
const list=inspectPointerEditableHandles(original,selected.selection);
assert.equal(list.kind,'pointer_editable_handles');
const length=pickProfileHandleAtPointer(original,selected.selection,{
  kind:'pick-profile-handle',version:1,sourceSignature,
  point:{x:120,y:0},maxDistanceMm:0.2,filter:'dimension'
});
assert.equal(length.kind,'picked',JSON.stringify(length));
assert.equal(length.handle.handleId,'dimension:L:length');
const resized=dragProfileHandleAtPointer(original,selected.selection,{
  kind:'drag-profile-handle',version:1,sourceSignature,
  handleId:length.handle.handleId,target:{x:150,y:0}
});
assert.equal(resized.kind,'accepted',JSON.stringify(resized));
assert.equal(resized.sketch.constraints.find(c=>c.id==='L:length').value,150);
assert.equal(solveSketch(resized.sketch).degreesOfFreedom,0);
const reopened=parseSketch(serializeSketch(resized.sketch));
const restored=inspectPointerEditableHandles(reopened,resized.selection);
assert.equal(restored.kind,'pointer_editable_handles');
assert.ok(restored.handles.some(h=>h.handleId===length.handle.handleId));
const center=restored.handles.find(h=>h.handleId==='hole-center:L:holeLower');
assert.ok(center);
// The lower hole follows the edited L end reference. Never reuse its old XY.
const currentCenter={...center.position};
// A centre has two signed XY handles at the same coordinate: refuse to guess.
const overlapped=pickProfileHandleAtPointer(reopened,resized.selection,{
  kind:'pick-profile-handle',version:1,
  sourceSignature:serializeSketch(reopened),
  point:currentCenter,maxDistanceMm:0.1,filter:'all'
});
assert.equal(overlapped.kind,'ambiguous');
const holeCenter=pickProfileHandleAtPointer(reopened,resized.selection,{
  kind:'pick-profile-handle',version:1,
  sourceSignature:serializeSketch(reopened),
  point:currentCenter,maxDistanceMm:0.1,filter:'hole_center'
});
assert.equal(holeCenter.kind,'picked');
const moved=dragProfileHandleAtPointer(reopened,resized.selection,{
  kind:'drag-profile-handle',version:1,
  sourceSignature:serializeSketch(reopened),
  handleId:holeCenter.handle.handleId,
  target:{x:currentCenter.x-5,y:currentCenter.y+2}
});
assert.equal(moved.kind,'accepted',JSON.stringify(moved));
assert.deepEqual(moved.changedConstraintIds,
  ['L:holeLowerOffsetX','L:holeLowerOffsetY']);
assert.equal(solveSketch(parseSketch(serializeSketch(moved.sketch))).status,'solved');
assert.equal(dragProfileHandleAtPointer(moved.sketch,moved.selection,{
  kind:'drag-profile-handle',version:1,sourceSignature,
  handleId:length.handle.handleId,target:{x:130,y:0}
}).reason,'stale_source');
