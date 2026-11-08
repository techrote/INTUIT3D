import assert from 'node:assert/strict';
import {createSketch,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {createClosedContour,editClosedContourVertices}
  from '../closed-contour-authoring.mjs';
import {inspectClosedContourEdges,dragClosedContourEdge}
  from '../contour-edge-offset.mjs';

// A WORKBENCH user draws a 120 x 80 mounting panel, then selects its
// right-hand semantic edge and drags the edge outward to lengthen the panel.
const source=createSketch({version:1,units:'mm',points:[],lines:[],
  circles:[],constraints:[]});
const drawn=createClosedContour(source,{
  kind:'create-closed-contour',version:1,sourceSignature:serializeSketch(source),
  contourId:'housing',vertices:[
    {x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}
  ]});
assert.equal(drawn.kind,'accepted');
const viewed=inspectClosedContourEdges(drawn.sketch,drawn.selection,'housing');
assert.equal(viewed.kind,'contour_edges');
const edge=viewed.edges.find(e=>e.edgeId==='housing:edge:1');
assert.deepEqual(edge.midpoint,{x:120,y:40});
const gesture=dragClosedContourEdge(drawn.sketch,drawn.selection,{
  version:1,sourceSignature:drawn.nextSourceSignature,
  contourId:'housing',edgeId:edge.edgeId,target:{x:140,y:40}});
assert.equal(gesture.kind,'planned_edge_offset',JSON.stringify(gesture));
assert.equal(gesture.acceptance.profile.profile.areaMm2,11200);
assert.equal(solveSketch(gesture.acceptance.sketch).status,'solved');

// RUNTIME already admits 'edit' of a structural contour. Its authoritative
// transaction must replay the unmodified editCommand and compare the COMPLETE
// acceptance; the browser must not commit gesture.applied as freehand pixels.
const runtimeReplayed=editClosedContourVertices(
  drawn.sketch,drawn.selection,gesture.editCommand);
assert.deepEqual(runtimeReplayed,gesture.acceptance);
const reopened=parseSketch(serializeSketch(runtimeReplayed.sketch));
const refreshed=inspectClosedContourEdges(reopened,runtimeReplayed.selection,
  'housing');
assert.equal(refreshed.kind,'contour_edges');
assert.equal(refreshed.edges[1].edgeId,edge.edgeId);
console.log(JSON.stringify({
  contract:'@intuit3d/sketch/contour-edge-offset/v1',
  semanticEdge:edge.edgeId,sourceReplayed:true,
  sourceSignature:drawn.nextSourceSignature,
  successorSignature:runtimeReplayed.nextSourceSignature,
  changedConstraintIds:runtimeReplayed.changedConstraintIds,
  appliedOffsetMm:gesture.appliedOffsetMm,
  sourceAreaMm2:drawn.profile.profile.areaMm2,
  successorAreaMm2:runtimeReplayed.profile.profile.areaMm2,
  previewOnly:true,nativeExact:false,independentStepQualified:false
},null,2));
