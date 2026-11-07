import assert from 'node:assert/strict';
import {serializeSketch,parseSketch,editConstraint,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {editSelectedLinearHolePattern} from '../selected-linear-hole-pattern.mjs';
import {inspectSelectedLinearPatternHandles,dragSelectedLinearPatternHandle}
  from '../selected-linear-pattern-handles.mjs';

let sketch=createDimensionedLPlateSketch();
let selection={candidateId:discoverPlateProfiles(sketch).candidates[0].id,
  sourceSignature:serializeSketch(sketch)};
const created=editSelectedLinearHolePattern(sketch,selection,{
  kind:'create-pattern',sourceSignature:serializeSketch(sketch),
  patternId:'L:array',anchorPointId:'L:b',firstXmm:52,firstYmm:15,
  pitchXmm:14,pitchYmm:0,radiusMm:3,count:2});
assert.equal(created.kind,'accepted',created.reason);
sketch=created.sketch;selection=created.selection;
function gesture(kind,xMm,yMm){
  const view=inspectSelectedLinearPatternHandles(sketch,selection,'L:array');
  assert.equal(view.kind,'selected_linear_pattern_handles',view.reason);
  const result=dragSelectedLinearPatternHandle(sketch,selection,{
    kind:'drag-pattern-handle',sourceSignature:view.sourceSignature,
    patternId:'L:array',handleId:view.handles.find(h=>h.kind===kind).id,
    xMm,yMm});
  assert.equal(result.kind,'accepted',result.reason);
  sketch=result.sketch;selection=result.selection;
}
gesture('pitch',64,15);
gesture('radius',56,15);
sketch=editConstraint(sketch,'L:length',{value:150});
sketch=parseSketch(serializeSketch(sketch));
selection={...selection,sourceSignature:serializeSketch(sketch)};
const reopened=inspectSelectedLinearPatternHandles(sketch,selection,'L:array');
assert.equal(reopened.kind,'selected_linear_pattern_handles',reopened.reason);
assert.deepEqual(reopened.pattern.members.map(m=>m.position.x),[82,94]);
assert.equal(reopened.pattern.radiusMm,4);
assert.equal(solveSketch(sketch).status,'solved');
console.log(JSON.stringify({kind:'selected_linear_pattern_handles_pass',
  changedWidthMm:150,centresMm:reopened.pattern.members.map(m=>m.position),
  radiusMm:4,semanticProfileId:reopened.semanticProfileId,
  previewOnly:true,nativeExact:false,independentStepQualified:false}));
