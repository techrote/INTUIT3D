import assert from 'node:assert/strict';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {editConstraint,serializeSketch,parseSketch} from '../index.mjs';
import {inspectSelectedEdgeHolePlacement,setSelectedEdgeHoles}
  from '../selected-edge-hole-placement.mjs';

let sketch=createDimensionedLPlateSketch();
const initialSource=serializeSketch(sketch);
const candidateId=discoverPlateProfiles(sketch).candidates[0].id;
let selection={candidateId,sourceSignature:initialSource};

function report(step){
  const view=inspectSelectedEdgeHolePlacement(sketch,selection);
  assert.equal(view.kind,'selected_edge_hole_placement',view.reason);
  console.log(JSON.stringify({step,sourceSignature:view.sourceSignature,
    semanticProfileId:view.semanticProfileId,holes:view.holes.map(h=>({
      id:h.holeId,position:h.position,radiusMm:h.radiusMm,
      edgeBinding:h.edgeBinding
    })),previewOnly:view.previewOnly,nativeExact:view.nativeExact}));
}
report('original');
const result=setSelectedEdgeHoles(sketch,selection,{
  kind:'set-edge-holes',sourceSignature:selection.sourceSignature,edits:[
    {holeId:'L:holeLower',edgeId:'L:edge0',
      alongMm:90,insetMm:15,radiusMm:5},
    {holeId:'mount:a',edgeId:'L:edge0',
      alongMm:55,insetMm:15,radiusMm:4},
    {holeId:'mount:b',edgeId:'L:edge0',
      alongMm:70,insetMm:15,radiusMm:4}
  ]
});
assert.equal(result.kind,'accepted',result.reason);
sketch=result.sketch;selection=result.selection;
report('atomic_edit');
sketch=editConstraint(sketch,'L:length',{value:150});
selection={candidateId,sourceSignature:serializeSketch(sketch)};
report('retrospective_width');
sketch=parseSketch(serializeSketch(sketch));
selection={candidateId,sourceSignature:serializeSketch(sketch)};
report('reopen');
sketch=parseSketch(initialSource);
selection={candidateId,sourceSignature:serializeSketch(sketch)};
report('source_snapshot_restore');
// Durable application journal/undo is RUNTIME-owned; snapshot restoration
// here is strictly analytic sketch replay rather than actual journal undo.
