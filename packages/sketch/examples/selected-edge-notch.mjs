import assert from 'node:assert/strict';
import {serializeSketch,solveSketch,editConstraint} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {createSelectedEdgeNotch,inspectSelectedEdgeNotch,
  dragSelectedEdgeNotchHandle} from '../selected-edge-notch.mjs';
const start=createDimensionedLPlateSketch();
const selected=discoverPlateProfiles(start).candidates[0];
const sourceSignature=serializeSketch(start);
const made=createSelectedEdgeNotch(start,{
  candidateId:selected.id,sourceSignature},{
  kind:'create-edge-notch',version:1,sourceSignature,
  notchId:'flange:relief',edgeId:'L:edge0',
  fromMm:45,toMm:65,depthMm:8
});
assert.equal(made.kind,'accepted',JSON.stringify(made));
const initial=inspectSelectedEdgeNotch(made.sketch,made.selection,'flange:relief');
assert.equal(initial.kind,'selected_edge_notch');
const depthHandle=initial.handles.find(h=>h.kind==='depth');
const drag=dragSelectedEdgeNotchHandle(made.sketch,made.selection,{
  version:1,sourceSignature:made.nextSourceSignature,
  notchId:'flange:relief',handleId:depthHandle.id,
  target:{x:depthHandle.position.x,y:12}
});
assert.equal(drag.kind,'accepted',JSON.stringify(drag));
const widened=editConstraint(drag.sketch,'L:length',{value:140});
const replay=inspectSelectedEdgeNotch(widened,{
  candidateId:drag.selection.candidateId,
  sourceSignature:serializeSketch(widened)},'flange:relief');
assert.equal(replay.kind,'selected_edge_notch',JSON.stringify(replay));
assert.equal(solveSketch(widened).status,'solved');
console.log(JSON.stringify({
  operation:'@intuit3d/sketch/selected-edge-notch/v1',
  beforeAreaMm2:made.profile.profile.areaMm2,
  afterDragAreaMm2:drag.profile.profile.areaMm2,
  widenedLengthMm:replay.originalLengthMm,
  notch:{fromMm:replay.fromMm,toMm:replay.toMm,depthMm:replay.depthMm},
  stableOriginalEdgeId:replay.originalEdgeId,
  profileSelection:drag.selection,
  previewOnly:true,nativeExact:false,stepQualified:false
},null,2));
