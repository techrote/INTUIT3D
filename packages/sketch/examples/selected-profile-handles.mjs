import assert from 'node:assert/strict';
import {parseSketch,serializeSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle} from '../selected-profile-handles.mjs';

let sketch=createDimensionedLPlateSketch();
const discovered=discoverPlateProfiles(sketch);
let selection={candidateId:discovered.candidates[0].id,
  sourceSignature:discovered.inputSignature};
const original=inspectSelectedProfileHandles(sketch,selection);
const originalArea=original.profile.profile.areaMm2;
const edit=(constraintId,valueMm)=>{
  const state=inspectSelectedProfileHandles(sketch,selection);
  const handle=state.controls.find(h=>h.constraintId===constraintId);
  const result=editSelectedProfileHandle(sketch,selection,{kind:'set-dimension',
    sourceSignature:state.sourceSignature,handleId:handle.id,valueMm});
  assert.equal(result.kind,'accepted');
  sketch=result.sketch;selection=result.selection;
  return result;
};
edit('L:length',150);
edit('L:webWidth',50);
edit('L:height',100);
edit('L:holeLowerRadius',6);
sketch=parseSketch(serializeSketch(sketch));
const after=inspectSelectedProfileHandles(sketch,selection);
assert.equal(after.kind,'selected_profile_handles');
assert.equal(after.semanticProfileId,original.semanticProfileId);
console.log(JSON.stringify({
  profileId:selection.candidateId,
  originalAreaMm2:originalArea,editedAreaMm2:after.profile.profile.areaMm2,
  controls:after.controls.map(h=>({id:h.id,valueMm:h.valueMm})),
  holes:after.profile.profile.holes.map(h=>({id:h.id,x:h.x,y:h.y,radius:h.radius})),
  sourceReplayed:true,authoritativeSketch:true,previewOnly:true,
  nativeExact:false,independentStepQualified:false
},null,2));
