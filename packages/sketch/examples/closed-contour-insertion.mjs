import assert from 'node:assert/strict';
import {createSketch,serializeSketch,parseSketch,solveSketch}
  from '../index.mjs';
import {createClosedContour} from '../closed-contour-authoring.mjs';
import {editSelectedProfileHole} from '../selected-profile-hole-authoring.mjs';
import {insertClosedContourTab,inspectTabbedClosedContour,
  editTabbedContourVertex} from '../closed-contour-insertion.mjs';

// Consumer pseudo-seam: user closes a sourced panel; picks source edge; requests
// two tab vertices; RUNTIME must independently REPLAY the same structural
// command against a whole-archive/revision fence before committing.
const blank=createSketch({version:1,units:'mm',points:[],lines:[],
  circles:[],constraints:[]});
const outline=createClosedContour(blank,{
  kind:'create-closed-contour',version:1,sourceSignature:serializeSketch(blank),
  contourId:'panel',vertices:[
    {x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}
  ]
});
assert.equal(outline.kind,'accepted',JSON.stringify(outline));
const bored=editSelectedProfileHole(outline.sketch,outline.selection,{
  kind:'add-hole',sourceSignature:outline.nextSourceSignature,
  holeId:'bore',anchorPointId:'panel:vertex:2',
  xMm:85,yMm:45,radiusMm:5
});
assert.equal(bored.kind,'accepted',JSON.stringify(bored));
const command={kind:'insert-closed-contour-tab',version:1,
  sourceSignature:bored.nextSourceSignature,contourId:'panel',
  edgeId:'panel:edge:1',tabId:'panelTab',
  vertices:[{x:140,y:20},{x:140,y:60}]};
const inserted=insertClosedContourTab(bored.sketch,bored.selection,command);
assert.equal(inserted.kind,'accepted',JSON.stringify(inserted));
assert.deepEqual(insertClosedContourTab(bored.sketch,bored.selection,command),
  inserted,'repeat command from exact source must be deterministic');
const editCommand={kind:'edit-tabbed-contour-vertex',version:1,
  sourceSignature:inserted.nextSourceSignature,contourId:'panel',
  tabId:'panelTab',handleId:'panel:handle:2',target:{x:125,y:85}};
const edited=editTabbedContourVertex(inserted.sketch,inserted.selection,editCommand);
assert.equal(edited.kind,'accepted',JSON.stringify(edited));
assert.deepEqual(edited.movedDependentHoles.map(h=>h.to),[{x:90,y:50}]);
const replay=editTabbedContourVertex(inserted.sketch,inserted.selection,editCommand);
assert.deepEqual(edited,replay);
const reopened=parseSketch(serializeSketch(edited.sketch));
const inspected=inspectTabbedClosedContour(reopened,edited.selection,'panel','panelTab');
assert.equal(inspected.kind,'tabbed_closed_contour',JSON.stringify(inspected));
assert.equal(solveSketch(reopened).status,'solved');

console.log(JSON.stringify({
  contract:'@intuit3d/sketch/closed-contour-insertion/v1',
  originalEdgeRetired:inserted.retiredEntityIds,
  createdEntities:inserted.createdEntityIds,
  originalVertexIds:inserted.preservedPointIds,
  currentHandles:inspected.handles.map(h=>h.handleId),
  areaMm2:edited.profile.profile.areaMm2,
  followedHoles:edited.movedDependentHoles,
  exactReplayed:true,solverStatus:'solved',
  journalStatus:'NOT_ADMITTED_BY_RUNTIME_V1',
  previewOnly:true,nativeExact:false,independentStepQualified:false
},null,2));
