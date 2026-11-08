import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {selectContourAtPointer} from '../pointer-contour-selection.mjs';
import {createClosedContour,dragClosedContourVertex,inspectClosedContour}
  from '../closed-contour-authoring.mjs';
import {editSelectedProfileHole} from '../selected-profile-hole-authoring.mjs';

// WORKBENCH's pointer-to-mm transform supplies these coordinates after user
// clicks four corners and explicitly clicks Close. No renderer is authority.
const project=createSketch({version:1,units:'mm',points:[],lines:[],
  circles:[],constraints:[]});
const drawing=createClosedContour(project,{
  kind:'create-closed-contour',version:1,sourceSignature:serializeSketch(project),
  contourId:'housing',vertices:[
    {x:0,y:0},{x:100,y:0},{x:100,y:65},{x:0,y:65}
  ]});
assert.equal(drawing.kind,'accepted',JSON.stringify(drawing));
const hit=selectContourAtPointer(drawing.sketch,{
  kind:'select-contour-at-pointer',version:1,
  sourceSignature:drawing.nextSourceSignature,
  point:{x:50,y:30},boundaryClearanceMm:0});
assert.equal(hit.kind,'selected');
assert.equal(hit.selection.candidateId,drawing.selection.candidateId);

// Select a genuine solver vertex handle by ID, then drag its authored XY
// dimensions through the real linear solver. This is ONE atomic replacement
// document+selection transaction to be journaled by RUNTIME.
const changed=dragClosedContourVertex(drawing.sketch,hit.selection,{
  version:1,sourceSignature:drawing.nextSourceSignature,
  contourId:'housing',handleId:'housing:handle:2',target:{x:125,y:70}
});
assert.equal(changed.kind,'accepted',JSON.stringify(changed));
assert.equal(solveSketch(changed.sketch).status,'solved');
const saved=serializeSketch(changed.sketch);
const reopened=parseSketch(saved);
const verified=inspectClosedContour(reopened,changed.selection,'housing');
assert.equal(verified.kind,'closed_contour');
assert.deepEqual(verified.vertices[2],{x:125,y:70});
assert.equal(verified.handles[2].handleId,'housing:handle:2');
console.log(JSON.stringify({
  contract:'@intuit3d/sketch/closed-contour-authoring/v1',
  selected:changed.selection.candidateId,
  changedConstraints:changed.changedConstraintIds,
  currentAreaMm2:changed.profile.profile.areaMm2,
  sketchRevisionSignature:changed.nextSourceSignature,
  solver:solveSketch(reopened).status,
  previewOnly:true,nativeExact:false,independentStepQualified:false
},null,2));

// A hole references this vertex by authored X/Y constraints. Dragging the
// polygon vertex must move the hole with it, not refuse an unrelated edit.
const bored=editSelectedProfileHole(changed.sketch,changed.selection,{
  kind:'add-hole',sourceSignature:changed.nextSourceSignature,
  holeId:'housing:mount',anchorPointId:'housing:vertex:2',
  xMm:90,yMm:40,radiusMm:5});
assert.equal(bored.kind,'accepted',JSON.stringify(bored));
const withDependent=dragClosedContourVertex(bored.sketch,bored.selection,{
  version:1,sourceSignature:bored.nextSourceSignature,
  contourId:'housing',handleId:'housing:handle:2',target:{x:130,y:75}});
assert.equal(withDependent.kind,'accepted',JSON.stringify(withDependent));
assert.deepEqual(withDependent.movedDependentHoles.map(h=>h.holeId),['housing:mount']);
assert.deepEqual(withDependent.movedDependentHoles[0].to,{x:95,y:45});
assert.equal(inspectClosedContour(parseSketch(serializeSketch(withDependent.sketch)),
  withDependent.selection,'housing').kind,'closed_contour');
console.log(JSON.stringify({associativeHoleDemo:{
  followed:withDependent.movedDependentHoles,
  selection:withDependent.selection.candidateId,
  previewOnly:true,nativeExact:false,independentStepQualified:false
}},null,2));
