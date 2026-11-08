import assert from 'node:assert/strict';
import {parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle}
  from '../selected-profile-handles.mjs';
import {inspectPointerSelectableContours,selectContourAtPointer,
  pickContourEdgeAtPointer} from '../pointer-contour-selection.mjs';

// A genuine WORKBENCH flow: use sketch-local mm pointer coordinates, never
// choose the first discovery candidate or guess native topological face IDs.
const original=createDimensionedLPlateSketch();
const stamp=serializeSketch(original);
const inventory=inspectPointerSelectableContours(original);
assert.equal(inventory.kind,'pointer_selectable_contours');
const selected=selectContourAtPointer(original,{
  kind:'select-contour-at-pointer',version:1,sourceSignature:stamp,
  point:{x:10,y:40},boundaryClearanceMm:0.15
});
assert.equal(selected.kind,'selected',JSON.stringify(selected));

// Existing public solver handles are now reachable from a user-selected
// contour, not from a hard-coded candidate ID.
const handles=inspectSelectedProfileHandles(original,selected.selection);
assert.equal(handles.kind,'selected_profile_handles');
const lengthHandle=handles.controls.find(x=>x.constraintId==='L:length');
assert.ok(lengthHandle);
const edited=editSelectedProfileHandle(original,selected.selection,{
  kind:'set-dimension',sourceSignature:stamp,handleId:lengthHandle.id,valueMm:150
});
assert.equal(edited.kind,'accepted',JSON.stringify(edited));
assert.equal(solveSketch(edited.sketch).degreesOfFreedom,0);
assert.equal(edited.profile.semanticProfileId,selected.profile.semanticProfileId);

// RUNTIME persists one authoritative replacement sketch and successor
// selection in an undoable, revision-fenced journal command (not done here).
const reopened=parseSketch(serializeSketch(edited.sketch));
const freshStamp=serializeSketch(reopened);
const edge=pickContourEdgeAtPointer(reopened,{
  kind:'pick-contour-edge-at-pointer',version:1,sourceSignature:freshStamp,
  point:{x:65,y:0.5},maxDistanceMm:1
});
assert.equal(edge.kind,'selected_edge',JSON.stringify(edge));
assert.equal(edge.edgeId,'L:edge0');
assert.equal(edge.selection.sourceSignature,freshStamp);
assert.equal(edge.nativeExact,false);
const denied=selectContourAtPointer(reopened,{
  kind:'select-contour-at-pointer',version:1,sourceSignature:stamp,
  point:{x:140,y:15},boundaryClearanceMm:0
});
assert.equal(denied.reason,'stale_source');
