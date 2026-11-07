import assert from 'node:assert/strict';
import {serializeSketch,parseSketch,editConstraint,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {editSelectedLinearHolePattern,inspectSelectedLinearHolePattern}
  from '../selected-linear-hole-pattern.mjs';

let sketch=createDimensionedLPlateSketch();
let selection={candidateId:discoverPlateProfiles(sketch).candidates[0].id,
  sourceSignature:serializeSketch(sketch)};
function apply(command){
  const result=editSelectedLinearHolePattern(sketch,selection,{
    ...command,sourceSignature:serializeSketch(sketch)});
  assert.equal(result.kind,'accepted',result.reason);
  sketch=result.sketch;selection=result.selection;
  return result;
}
apply({kind:'create-pattern',patternId:'L:array',anchorPointId:'L:b',
  firstXmm:52,firstYmm:15,pitchXmm:14,pitchYmm:0,radiusMm:3,count:2});
apply({kind:'set-pattern',patternId:'L:array',pitchXmm:12,
  pitchYmm:0,radiusMm:4,count:3});
sketch=editConstraint(sketch,'L:length',{value:150});
selection={...selection,sourceSignature:serializeSketch(sketch)};
sketch=parseSketch(serializeSketch(sketch));
const inspected=inspectSelectedLinearHolePattern(sketch,selection,'L:array');
assert.equal(inspected.kind,'selected_linear_hole_pattern',inspected.reason);
assert.deepEqual(inspected.members.map(m=>m.position.x),[82,94,106]);
assert.equal(solveSketch(sketch).status,'solved');
assert.equal(inspected.semanticProfileId,selection.candidateId);
console.log(JSON.stringify({kind:'selected_linear_hole_pattern_pass',
  editedLBracketWidthMm:150,stableProfileId:inspected.semanticProfileId,
  holeCentresMm:inspected.members.map(m=>m.position),
  analyticOnly:true,nativeExact:false,independentStepQualified:false}));
