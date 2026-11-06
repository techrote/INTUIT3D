import {plateSketchFixture} from '../index.mjs';
import {
  PROFILE_DISCOVERY_VERSION, discoverPlateProfiles, admitDiscoveredPlateProfile,
  type ProfileDiscoveryResponse, type DiscoveredPlateCandidate,
  type ProfileDiscoveryOptions
} from '../profile-discovery.mjs';
const response:ProfileDiscoveryResponse=discoverPlateProfiles(plateSketchFixture());
const version:1=PROFILE_DISCOVERY_VERSION;
const options:ProfileDiscoveryOptions={maxCandidates:4};
const again:ProfileDiscoveryResponse=discoverPlateProfiles(plateSketchFixture(),options);
if (response.status==='ready') {
  const candidate:DiscoveredPlateCandidate=response.candidates[0];
  const analyticArea:number=admitDiscoveredPlateProfile(plateSketchFixture(),response,candidate.id).areaMm2;
  void analyticArea;
}
void version;
void again;
// @ts-expect-error no exact kernel/B-rep status in this additive preview contract
const exact:'validated_exact'=response.status;
void exact;
// @ts-expect-error unsupported approximation widening option
discoverPlateProfiles(plateSketchFixture(),{fuzzyToleranceMm:1});
