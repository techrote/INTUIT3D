/** Provider-submittable analytic wire, NOT native B-rep, exact STEP or final CAD admission. */
import type {ArcSketchDocument,ArcSketchSolution,ArcPreviewCurve} from './arc-constraints.mjs';
export const ARC_PROFILE_VERSION:1;
export const ARC_PROFILE_FORMAT:'intuit3d.analytic-arc-profile';
export interface AnalyticArcProfile {
  format:'intuit3d.analytic-arc-profile';version:1;id:string;units:'mm';
  status:'analytic_2d_validated_pending_native';
  sourceSignature:string;
  numericalPolicy:{contactUncertaintyMm:number;
    action:'reject_ambiguous_contact_no_geometry_healing'};
  boundary:ArcPreviewCurve[];
  holes:Array<{id:string;centerId:string;x:number;y:number;radiusMm:number}>;
  signedBoundaryAreaMm2:number;materialAreaMm2:number;
  globalSelfIntersectionChecked:true;holeContainmentChecked:true;
  providerSubmissionReady:true;nativeProfileAdmissible:false;
  exactBrepAvailable:false;stepQualified:false;
}
export function prepareArcProfileForProvider(
  source:ArcSketchDocument,solution:ArcSketchSolution,
  request:{profileId:string;boundaryIds:string[];holeIds?:string[]}
):AnalyticArcProfile;
