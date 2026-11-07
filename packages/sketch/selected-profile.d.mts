import type {SketchDocument,PlateProfile,SolveStatus} from './index.mjs';
export const SELECTED_PROFILE_VERSION:1;
export type SelectedProfileSelection={
  candidateId:string;
  sourceSignature:string;
};
export type SelectedProfileRefusal={
  kind:'refused';version:1;sourceSignature:string;candidateId:string|null;
  reason:'invalid_selection'|'stale_source'|'source_not_profile_ready'|
    'unknown_profile'|'source_not_solved'|
    'unselected_lines_contact_or_overlap_selected_bounds';
  overlappingLineIds:string[];availableCandidateIds:string[];
  sourceStatus:SolveStatus|null;previewOnly:true;nativeExact:false;
};
export type SelectedAnalyticProfile={
  kind:'selected_analytic_profile';version:1;sourceSignature:string;
  candidateId:string;semanticProfileId:string;units:'mm';
  lineIds:string[];holeIds:string[];unselectedLineIds:string[];
  boundary:Array<{
    edgeId:string;startPointId:string;endPointId:string;
    start:{x:number;y:number};end:{x:number;y:number};
  }>;
  profile:PlateProfile;
  previewOnly:true;providerSubmissionReady:true;nativeExact:false;
  exactBrepAvailable:false;independentStepQualified:false;
};
export function proposeSelectedPlateProfile(
  source:SketchDocument,selection:SelectedProfileSelection
):SelectedAnalyticProfile|SelectedProfileRefusal;
export function admitSelectedPlateProfile(
  source:SketchDocument,proposal:SelectedAnalyticProfile
):SelectedAnalyticProfile;
export function createDimensionedLPlateSketch(options?:{
  lengthMm?:number;heightMm?:number;webWidthMm?:number;
  flangeHeightMm?:number;holeRadiusMm?:number;
}):SketchDocument;
