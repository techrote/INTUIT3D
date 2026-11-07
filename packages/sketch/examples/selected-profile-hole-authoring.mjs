import assert from 'node:assert/strict';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch,parseSketch,editConstraint} from '../index.mjs';
import {inspectSelectedProfileHoleAuthoring,editSelectedProfileHole}
  from '../selected-profile-hole-authoring.mjs';

let sketch=createDimensionedLPlateSketch();
const candidate=discoverPlateProfiles(sketch).candidates[0];
let selection={candidateId:candidate.id,sourceSignature:serializeSketch(sketch)};
const before=serializeSketch(sketch);
const commit=command=>{
  const view=inspectSelectedProfileHoleAuthoring(sketch,selection);
  assert.equal(view.kind,'selected_profile_hole_authoring');
  const result=editSelectedProfileHole(sketch,selection,
    {sourceSignature:view.sourceSignature,...command});
  assert.equal(result.kind,'accepted',result.reason);
  sketch=result.sketch;selection=result.selection;
  return result;
};
let added=commit({kind:'add-hole',holeId:'L:fastenerThird',
  anchorPointId:'L:b',xMm:65,yMm:15,radiusMm:4});
assert.equal(added.profile.holeIds.length,3);
sketch=editConstraint(sketch,'L:length',{value:150});
selection={...selection,sourceSignature:serializeSketch(sketch)};
const moved=inspectSelectedProfileHoleAuthoring(sketch,selection);
assert.equal(moved.holes.find(h=>h.holeId==='L:fastenerThird').position.x,95);
commit({kind:'reanchor-hole',holeId:'L:fastenerThird',anchorPointId:'L:a'});
const archive=serializeSketch(sketch);
sketch=parseSketch(archive);
selection={...selection,sourceSignature:serializeSketch(sketch)};
assert.equal(inspectSelectedProfileHoleAuthoring(sketch,selection).holes.length,3);
commit({kind:'remove-hole',holeId:'L:fastenerThird'});
assert.equal(inspectSelectedProfileHoleAuthoring(sketch,selection).holes.length,2);
const undone=parseSketch(archive);
assert.equal(inspectSelectedProfileHoleAuthoring(undone,
  {...selection,sourceSignature:archive}).holes.length,3);
const original=parseSketch(before);
assert.equal(original.circles.length,2);
console.log(JSON.stringify({kind:'selected_profile_hole_authoring_pass',
  selectedProfileId:selection.candidateId,finalHoleCount:sketch.circles.length,
  undoHoleCount:undone.circles.length,previewOnly:true,nativeExact:false}));
