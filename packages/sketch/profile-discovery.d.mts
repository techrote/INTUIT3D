import type {PlateProfile,SketchDocument,SolveStatus} from './index.mjs';
export const PROFILE_DISCOVERY_VERSION: 1;
export type ProfileDiscoveryStatus =
  | 'ready' | 'ambiguous' | 'no_profile' | 'source_unsolved'
  | 'numerical_failure' | 'budget_exceeded';
export interface ProfileDiscoveryOptions {
  maxLines?:number;
  maxCircles?:number;
  maxCandidates?:number;
}
export interface DiscoveredPlateCandidate {
  /** Stable within the semantic line set; not a persistent B-rep face ID. */
  id:string;
  /** Authored semantic edge IDs, canonical lexical order. */
  lineIds:string[];
  /** Canonical traversal; reversed flags are derived, never persisted. */
  orderedEdges:Array<{id:string;reversed:boolean}>;
  /** Strictly interior circle IDs, no inferred topology welding. */
  holeIds:string[];
  /** Analytic-only profile validated through the original sketch provider. */
  profile:PlateProfile;
}
export interface RejectedPlateComponent {
  id:string;
  lineIds:string[];
  reason:string;
  detail:string|null;
}
export interface ProfileDiscoveryResponse {
  version:1;
  previewOnly:true;
  inputSignature:string;
  sourceStatus:SolveStatus|null;
  status:ProfileDiscoveryStatus;
  reason:string|null;
  candidates:DiscoveredPlateCandidate[];
  rejected:RejectedPlateComponent[];
}
/**
 * Read-only inference of strictly supported line loops / circular holes.
 * Never infers coincident vertices from floating-point proximity.
 */
export function discoverPlateProfiles(source:SketchDocument,options?:ProfileDiscoveryOptions):ProfileDiscoveryResponse;
/**
 * Replays an exact unambiguous proposal before returning analytic area.
 * This is NOT a geometry-kernel admission or exact B-rep guarantee.
 */
export function admitDiscoveredPlateProfile(source:SketchDocument,proposal:ProfileDiscoveryResponse,candidateId:string):PlateProfile;
