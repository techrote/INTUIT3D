import assert from 'node:assert/strict';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {editConstraint,parseSketch,serializeSketch} from '../index.mjs';
import {editSelectedProfileHole} from '../selected-profile-hole-authoring.mjs';
import {inspectSelectedProfileHoleLayout,editSelectedProfileHoleLayout}
  from '../selected-profile-hole-layout.mjs';

const original=createDimensionedLPlateSketch(),saved=serializeSketch(original);
let sketch=original;
const selected=discoverPlateProfiles(sketch).candidates[0];
let selection={candidateId:selected.id,sourceSignature:saved};
const summary=(step,sketch,selection)=>{
  const view=inspectSelectedProfileHoleLayout(sketch,selection);
  assert.equal(view.kind,'selected_profile_hole_layout',view.reason);
  const lower=view.holes.find(h=>h.holeId==='L:holeLower');
  const upper=view.holes.find(h=>h.holeId==='L:holeUpper');
  const length=sketch.constraints.find(c=>c.id==='L:length').value;
  return {step,profileId:view.semanticProfileId,lengthMm:length,
    lower:{...lower.position,radiusMm:lower.radiusMm},
    upper:{...upper.position,radiusMm:upper.radiusMm},
    areaMm2:view.profile.profile.areaMm2,
    previewOnly:true,nativeExact:false};
};
console.log(JSON.stringify(summary('original',sketch,selection)));
const swapped=editSelectedProfileHoleLayout(sketch,selection,{
  kind:'set-hole-layout',sourceSignature:serializeSketch(sketch),
  edits:[
    {holeId:'L:holeLower',xMm:20,yMm:60,radiusMm:4},
    {holeId:'L:holeUpper',xMm:90,yMm:15,radiusMm:6}
  ]
});
assert.equal(swapped.kind,'accepted',swapped.reason);
sketch=swapped.sketch;selection=swapped.selection;
console.log(JSON.stringify(summary('swap_holes',sketch,selection)));
// The lower hole was originally anchored to the right-hand length endpoint.
 // After swapping it into the upper web, preserving that reference would move
 // it outside the selected contour on a length edit. Deliberately reanchor to
 // the stable origin before changing the length; never silently relax intent.
const reanchored=editSelectedProfileHole(sketch,selection,{
  kind:'reanchor-hole',sourceSignature:serializeSketch(sketch),
  holeId:'L:holeLower',anchorPointId:'L:a'
});
assert.equal(reanchored.kind,'accepted',reanchored.reason);
sketch=reanchored.sketch;selection=reanchored.selection;
sketch=editConstraint(sketch,'L:length',{value:150});
selection={...selection,sourceSignature:serializeSketch(sketch)};
console.log(JSON.stringify(summary('resize_outline',sketch,selection)));
sketch=parseSketch(serializeSketch(sketch));
selection={...selection,sourceSignature:serializeSketch(sketch)};
console.log(JSON.stringify(summary('reopen',sketch,selection)));
const restored=parseSketch(saved),initialSelection={
  candidateId:selected.id,sourceSignature:serializeSketch(restored)};
// Snapshot restoration proves reversibility; the external INTENT/RUNTIME journal
// must supply a real durable undo event after integration.
console.log(JSON.stringify(summary('source_restore',restored,initialSelection)));
