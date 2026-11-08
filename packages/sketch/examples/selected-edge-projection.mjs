import assert from 'node:assert/strict';
import {editConstraint,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createSelectedEdgeBreakpoints} from '../selected-edge-breakpoints.mjs';
import {createSelectedEdgeProjection,inspectSelectedEdgeProjection,
  dragSelectedEdgeProjection,removeSelectedEdgeProjection}
  from '../selected-edge-projection.mjs';

// WORKBENCH chooses an actually discovered, solved contour; no implicit target.
const select=doc=>({
  candidateId:discoverPlateProfiles(doc).candidates.find(c=>
    c.lineIds.includes('L:edge0')).id,sourceSignature:serializeSketch(doc)
});
const original=createDimensionedLPlateSketch();
const splits=createSelectedEdgeBreakpoints(original,select(original),{
  kind:'create-edge-breakpoints',version:1,sourceSignature:serializeSketch(original),
  splitId:'datum',edgeId:'L:edge0',offsetsMm:[55,75]});
assert.equal(splits.kind,'accepted',JSON.stringify(splits));
const projected=createSelectedEdgeProjection(splits.sketch,splits.selection,{
  kind:'create-edge-projection',version:1,
  sourceSignature:splits.nextSourceSignature,
  projectionId:'crossDatum',sourceSplitId:'datum',targetEdgeId:'L:edge2'});
assert.equal(projected.kind,'accepted',JSON.stringify(projected));
const reopened=parseSketch(serializeSketch(projected.sketch));
const view=inspectSelectedEdgeProjection(reopened,projected.selection,
  'crossDatum','datum');
assert.equal(view.kind,'selected_edge_projection',JSON.stringify(view));
assert.deepEqual(view.associations.map(a=>a.sourceIndex),[2,1]);
assert.deepEqual(view.sourceOffsetsMm,[55,75]);
const gesture=dragSelectedEdgeProjection(reopened,projected.selection,{
  version:1,sourceSignature:projected.nextSourceSignature,
  projectionId:'crossDatum',sourceSplitId:'datum',
  handleId:'crossDatum:handle1',target:{x:59,y:100}});
assert.equal(gesture.kind,'accepted',JSON.stringify(gesture));
assert.equal(solveSketch(gesture.sketch).status,'solved');
const longer=editConstraint(gesture.sketch,'L:length',{value:150});
const longerView=inspectSelectedEdgeProjection(longer,select(longer),
  'crossDatum','datum');
assert.equal(longerView.kind,'selected_edge_projection',JSON.stringify(longerView));
const removed=removeSelectedEdgeProjection(longer,select(longer),{
  kind:'remove-edge-projection',version:1,sourceSignature:serializeSketch(longer),
  projectionId:'crossDatum',sourceSplitId:'datum'});
assert.equal(removed.kind,'accepted',JSON.stringify(removed));
assert.ok(removed.sketch.points.some(p=>p.id==='datum:break1'));
