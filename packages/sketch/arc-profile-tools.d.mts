import type {ArcSketchDocument,ArcSketchSolution,ArcSolveStatus,ArcDiagnostic} from './arc-constraints.mjs';
import type {ArcHoleSelection,ArcHoleChange} from './arc-hole-authoring.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
export const ARC_PROFILE_TOOLS_VERSION:1;
export const ARC_PROFILE_TOOLS_FORMAT:'intuit3d.arc-profile-tools';
export type ArcProfileToolControl =
  | {kind:'dimension';id:string;constraintId:string;
     dimensionKind:'distanceX'|'distanceY'|'arcRadius';valueMm:number;
     position:{x:number;y:number}}
  | {kind:'hole_center';id:string;circleId:string;
     position:{x:number;y:number};canMove:boolean}
  | {kind:'hole_diameter';id:string;circleId:string;valueMm:number;
     position:{x:number;y:number}};
export type ArcProfileToolChange =
  | {kind:'dimension';constraintId:string;valueMm:number}
  | {kind:'drag-dimension';constraintId:string;xMm:number;yMm:number}
  | {kind:'hole';change:ArcHoleChange}
  | {kind:'array';sourceCircleId:string;patternId:string;
     rows:number;columns:number;spacingXmm:number;spacingYmm:number}
  | {kind:'drag-handle';handleId:string;xMm:number;yMm:number}
  | {kind:'translate-holes';circleIds:string[];deltaXMm:number;deltaYMm:number}
  | {kind:'bind-hole';circleId:string;anchorPointId:string}
  | {kind:'unbind-hole';circleId:string}
  | {kind:'hole-offset';circleId:string;offsetXMm:number;offsetYMm:number};
export type ArcProfileToolStamp={sourceSignature:string;selectionSignature:string};
export interface ArcProfileToolInspection extends ArcProfileToolStamp {
  format:'intuit3d.arc-profile-tools';version:1;
  status:ArcSolveStatus|'profile_rejected';
  diagnostics:ArcDiagnostic[];profileError:string|null;
  controls:ArcProfileToolControl[];profile:AnalyticArcProfile|null;
  previewOnly:true;
}
export type ArcProfileToolResult =
  | (ArcProfileToolStamp & {kind:'refused';format:'intuit3d.arc-profile-tools';
      version:1;reason:string})
  | (ArcProfileToolStamp & {kind:'accepted';format:'intuit3d.arc-profile-tools';
      version:1;sketch:ArcSketchDocument;selection:ArcHoleSelection;
      solution:ArcSketchSolution;profile:AnalyticArcProfile;
      createdIds:string[];appliedValueMm:number|null;previewOnly:true;
      gesture?:{handleId:string;target:{x:number;y:number};
        appliedPoint:{x:number;y:number};deviationMm:number};
      movedHoleIds?:string[]});
export function inspectArcProfileTools(
  source:ArcSketchDocument,selection:ArcHoleSelection):ArcProfileToolInspection;
export function editArcProfileWithTool(
  source:ArcSketchDocument,selection:ArcHoleSelection,command:ArcProfileToolChange,
  expected:ArcProfileToolStamp):ArcProfileToolResult;
