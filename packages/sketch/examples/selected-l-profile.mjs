import assert from 'node:assert/strict';
import {editConstraint,parseSketch,serializeSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch,proposeSelectedPlateProfile,
  admitSelectedPlateProfile} from '../selected-profile.mjs';

// Sketch solve -> chosen nonrectangular profile -> retrospective edit ->
// authoritative replay. Output is a provider-ready analytic selection,
// NOT a physical solid or independently accepted STEP.
let sketch=createDimensionedLPlateSketch();
const select=doc=>{
  const discovery=discoverPlateProfiles(doc);
  const candidate=discovery.candidates.find(c=>c.lineIds.length===6);
  return admitSelectedPlateProfile(doc,proposeSelectedPlateProfile(doc,{
    candidateId:candidate.id,sourceSignature:discovery.inputSignature
  }));
};
const before=select(sketch);
sketch=editConstraint(sketch,'L:length',{value:150});
sketch=editConstraint(sketch,'L:webWidth',{value:50});
sketch=editConstraint(sketch,'L:height',{value:100});
sketch=parseSketch(serializeSketch(sketch));
const after=select(sketch);
assert.equal(after.semanticProfileId,before.semanticProfileId);
assert.ok(after.profile.areaMm2>before.profile.areaMm2);
console.log(JSON.stringify({
  selectedProfile:after.semanticProfileId,
  firstAreaMm2:before.profile.areaMm2,
  editedAreaMm2:after.profile.areaMm2,
  boundaryEdges:after.boundary.map(e=>e.edgeId),
  survivingHoleIds:after.holeIds,
  providerSubmissionReady:true,nativeExact:false,
  exactBrepAvailable:false,independentStepQualified:false
},null,2));
