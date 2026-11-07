import {createDimensionedLPlateSketch,proposeSelectedPlateProfile,
  admitSelectedPlateProfile, type SelectedAnalyticProfile,
  type SelectedProfileRefusal, type SelectedProfileSelection} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
const sketch=createDimensionedLPlateSketch({lengthMm:120,heightMm:80});
const source=discoverPlateProfiles(sketch);
const chosen:SelectedProfileSelection={
  candidateId:source.candidates[0]!.id,sourceSignature:source.inputSignature
};
const result:SelectedAnalyticProfile|SelectedProfileRefusal=proposeSelectedPlateProfile(sketch,chosen);
if(result.kind==='selected_analytic_profile') {
  const admitted=admitSelectedPlateProfile(sketch,result);
  const area:number=admitted.profile.areaMm2;
  const boundaryCount:number=admitted.boundary.length;
  const holes:string[]=admitted.holeIds;
  void [area,boundaryCount,holes];
}
