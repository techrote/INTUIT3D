import type {ArcSketchDocument,ArcSketchSolution,ArcDiagnostic,ArcSolveStatus}
  from './arc-constraints.mjs';
import type {ArcHoleSelection} from './arc-hole-authoring.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
export const ARC_HOLE_ANCHORS_VERSION:1;
export const ARC_HOLE_ANCHORS_FORMAT:'intuit3d.arc-hole-anchors';
export type ArcHoleAnchorStamp={sourceSignature:string;selectionSignature:string};
export type ArcHoleAnchorCommand=
 | {kind:'bind';circleId:string;anchorPointId:string}
 | {kind:'edit-offset';circleId:string;offsetXMm:number;offsetYMm:number}
 | {kind:'drag-center';circleId:string;handleId:string;xMm:number;yMm:number}
 | {kind:'detach';circleId:string};
export interface ArcHoleAnchorControl extends ArcHoleAnchorStamp {
  format:'intuit3d.arc-hole-anchors';version:1;profileId:string;circleId:string;
  mode:'fixed'|'anchored'|'unsupported';reason:string|null;canEdit:boolean;
  binding:{anchorPointId:string;xConstraintId:string;yConstraintId:string;
    offsetXMm:number;offsetYMm:number}|null;
  fixedConstraintId:string|null;centerPointId:string|null;
  handleId:string;position:{xMm:number;yMm:number}|null;
  solverStatus:ArcSolveStatus;diagnostics:ArcDiagnostic[];
  previewOnly:true;nativeExact:false;
}
export type ArcHoleAnchorResult =
 | (ArcHoleAnchorStamp & {kind:'refused';format:'intuit3d.arc-hole-anchors';
    version:1;reason:string;previewOnly:true;nativeExact:false})
 | (ArcHoleAnchorStamp & {kind:'accepted';format:'intuit3d.arc-hole-anchors';
    version:1;sketch:ArcSketchDocument;selection:ArcHoleSelection;
    solution:ArcSketchSolution;profile:AnalyticArcProfile;
    binding:ArcHoleAnchorControl;previewOnly:true;nativeExact:false});
export function inspectArcHoleAnchor(
  sketch:ArcSketchDocument,selection:ArcHoleSelection,circleId:string
):ArcHoleAnchorControl;
export function proposeArcHoleAnchor(
  sketch:ArcSketchDocument,selection:ArcHoleSelection,
  command:ArcHoleAnchorCommand,expected:ArcHoleAnchorStamp
):ArcHoleAnchorResult;
