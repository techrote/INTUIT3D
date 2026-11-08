import assert from 'node:assert/strict';
import {editConstraint,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createSelectedEdgeBreakpoints,inspectSelectedEdgeBreakpoints,
  editSelectedEdgeBreakpoints,dragSelectedEdgeBreakpoint,
  removeSelectedEdgeBreakpoints} from '../selected-edge-breakpoints.mjs';

// WORKBENCH chooses a real discovered contour, not a guessed rectangle.
const choose=sketch=>({
  candidateId:discoverPlateProfiles(sketch).candidates.find(c=>
    c.lineIds.includes('L:edge0')).id,sourceSignature:serializeSketch(sketch)
});
const original=createDimensionedLPlateSketch();
const split=createSelectedEdgeBreakpoints(original,choose(original),{
  kind:'create-edge-breakpoints',version:1,
  sourceSignature:serializeSketch(original),
  splitId:'mountingDatum',edgeId:'L:edge0',offsetsMm:[32,64]});
assert.equal(split.kind,'accepted',JSON.stringify(split));
const reopened=parseSketch(serializeSketch(split.sketch));
const view=inspectSelectedEdgeBreakpoints(reopened,split.selection,'mountingDatum');
assert.equal(view.kind,'selected_edge_breakpoints');
assert.equal(view.handles.length,2);
const dragged=dragSelectedEdgeBreakpoint(reopened,split.selection,{
  version:1,sourceSignature:split.nextSourceSignature,splitId:'mountingDatum',
  handleId:view.handles[0].id,target:{x:36,y:400}});
assert.equal(dragged.kind,'accepted',JSON.stringify(dragged));
const edited=editSelectedEdgeBreakpoints(dragged.sketch,dragged.selection,{
  kind:'edit-edge-breakpoints',version:1,
  sourceSignature:dragged.nextSourceSignature,splitId:'mountingDatum',
  offsetsMm:[36,70]});
assert.equal(edited.kind,'accepted',JSON.stringify(edited));
const widened=editConstraint(edited.sketch,'L:length',{value:150});
const after=inspectSelectedEdgeBreakpoints(widened,choose(widened),'mountingDatum');
assert.equal(after.kind,'selected_edge_breakpoints');
assert.deepEqual(after.offsetsMm,[36,70]);
assert.equal(solveSketch(widened).status,'solved');
const removed=removeSelectedEdgeBreakpoints(widened,choose(widened),{
  kind:'remove-edge-breakpoints',version:1,
  sourceSignature:serializeSketch(widened),splitId:'mountingDatum'});
assert.equal(removed.kind,'accepted',JSON.stringify(removed));
assert.equal(removed.profile.lineIds.length,6);
