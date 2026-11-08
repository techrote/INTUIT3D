import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {inspectPointerSelectableContours,selectContourAtPointer,
  pickContourEdgeAtPointer} from '../pointer-contour-selection.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle}
  from '../selected-profile-handles.mjs';

// Two independent machinable sketch regions: a real constrained L with holes,
// and a separate four-edge island wholly inside the empty concave corner's
// AABB. They MUST be selected independently, not unioned by their bounds.
const base=createDimensionedLPlateSketch();
const corners=[[62,42],[82,42],[82,60],[62,60]]
  .map(([x,y],i)=>({id:'island:p'+i,x,y}));
const source=createSketch({...base,
  points:[...base.points,...corners],
  lines:[...base.lines,...corners.map((p,i)=>({
    id:'island:e'+i,start:p.id,end:corners[(i+1)%4].id
  }))],
  constraints:[...base.constraints,...corners.map(p=>({
    id:'island:fix:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
  }))]
});
const signature=serializeSketch(source);
const inventory=inspectPointerSelectableContours(source);
assert.equal(inventory.kind,'pointer_selectable_contours',JSON.stringify(inventory));
assert.equal(inventory.candidates.length,2);
const click=(doc,point)=>selectContourAtPointer(doc,{
  kind:'select-contour-at-pointer',version:1,sourceSignature:serializeSketch(doc),
  point,boundaryClearanceMm:0.1
});
const l=click(source,{x:10,y:40}),island=click(source,{x:72,y:50});
assert.equal(l.kind,'selected',JSON.stringify(l));
assert.equal(island.kind,'selected',JSON.stringify(island));
assert.notEqual(l.selection.candidateId,island.selection.candidateId);

// Pick a genuine semantic edge, then edit the L through its solver-backed
// dimension handle. No canvas-generated candidate ID or screen-space guess.
const edge=pickContourEdgeAtPointer(source,{
  kind:'pick-contour-edge-at-pointer',version:1,sourceSignature:signature,
  point:{x:72,y:42.5},maxDistanceMm:1
});
assert.equal(edge.kind,'selected_edge',JSON.stringify(edge));
assert.equal(edge.edgeId,'island:e0');
const controls=inspectSelectedProfileHandles(source,l.selection);
assert.equal(controls.kind,'selected_profile_handles');
const handle=controls.controls.find(h=>h.constraintId==='L:length');
assert.ok(handle);
const edited=editSelectedProfileHandle(source,l.selection,{
  kind:'set-dimension',sourceSignature:signature,handleId:handle.id,valueMm:150
});
assert.equal(edited.kind,'accepted',JSON.stringify(edited));
assert.equal(solveSketch(edited.sketch).degreesOfFreedom,0);

// RUNTIME owns journaling. The sketch API models reopening the exact returned
// new document, not a fabricated B-rep or verified STEP.
const reopened=parseSketch(serializeSketch(edited.sketch));
assert.equal(click(reopened,{x:72,y:50}).selection.candidateId,
  island.selection.candidateId);
assert.equal(click(reopened,{x:140,y:15}).selection.candidateId,
  l.selection.candidateId);
assert.equal(click(reopened,{x:120,y:15}).reason,'hole_void');
assert.equal(selectContourAtPointer(reopened,{
  kind:'select-contour-at-pointer',version:1,sourceSignature:signature,
  point:{x:72,y:50},boundaryClearanceMm:0.1
}).reason,'stale_source');
assert.equal(edge.nativeExact,false);
assert.equal(edge.independentStepQualified,false);
