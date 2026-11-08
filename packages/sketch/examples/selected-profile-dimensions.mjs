import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {inspectSelectedProfileDimensions,editSelectedProfileDimensions,
  dragSelectedProfileDimension} from '../selected-profile-dimensions.mjs';

const select=sketch=>({candidateId:discoverPlateProfiles(sketch).candidates
  .find(c=>c.lineIds.includes('L:edge0')).id,
  sourceSignature:serializeSketch(sketch)});
let sketch=createDimensionedLPlateSketch(),selection=select(sketch);
// A second authored size dimension models an imported engineering drawing.
// It cannot be silently removed when the design is changed.
sketch.constraints.push({id:'drawing:length',kind:'distanceX',
  a:'L:a',b:'L:b',value:120});
sketch=createSketch(sketch);selection=select(sketch);
const first=editSelectedProfileDimensions(sketch,selection,{
  kind:'edit-selected-dimensions',version:1,
  sourceSignature:selection.sourceSignature,
  changes:[{constraintId:'L:length',value:150}]});
assert.equal(first.kind,'refused');
assert.equal(first.conflict?.status,'minimal_conflict');
assert.deepEqual(first.conflict.constraintIds,['L:length','drawing:length'].sort());
const fixed=editSelectedProfileDimensions(sketch,selection,{
  kind:'edit-selected-dimensions',version:1,
  sourceSignature:selection.sourceSignature,
  changes:[{constraintId:'L:length',value:150},
    {constraintId:'drawing:length',value:150},
    {constraintId:'L:flangeHeight',value:34}]});
assert.equal(fixed.kind,'accepted',JSON.stringify(fixed));
sketch=parseSketch(serializeSketch(fixed.sketch));selection=fixed.selection;
const available=inspectSelectedProfileDimensions(sketch,selection);
assert.equal(available.kind,'selected_profile_dimensions');
const grip=available.dimensions.find(d=>d.constraintId==='L:holeLowerRadius').handle;
const dragged=dragSelectedProfileDimension(sketch,selection,{
  version:1,sourceSignature:selection.sourceSignature,handleId:grip.id,
  target:{x:grip.position.x+1,y:grip.position.y+5}});
assert.equal(dragged.kind,'accepted',JSON.stringify(dragged));
assert.equal(solveSketch(dragged.sketch).status,'solved');
console.log(JSON.stringify({
  kind:dragged.kind,sourceSignature:dragged.nextSourceSignature,
  constraintIds:dragged.sketch.constraints.map(c=>c.id),
  profileLineIds:dragged.profile.lineIds,
  holeIds:dragged.profile.holeIds,
  areaMm2:dragged.profile.profile.areaMm2,
  projectionDeviationMm:dragged.gesture.projectionDeviationMm,
  redundantEquations:dragged.redundantEquations,
  previewOnly:dragged.previewOnly,nativeExact:dragged.nativeExact
}));
