/** Authoritative SKETCH arc document, derived analytic profile, no native exactness claim. */
import type {ArcSketchDocument,ArcSketchSolution} from './arc-constraints.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
export const ARC_HOLE_AUTHORING_VERSION:1;
export const ARC_HOLE_SELECTION_FORMAT:'intuit3d.arc-hole-selection';
export interface ArcHoleSelection {
  format:'intuit3d.arc-hole-selection'; version:1; profileId:string;
  boundaryIds:string[]; holeIds:string[];
}
export type ArcHoleChange =
 | {kind:'add';circleId:string;xMm:number;yMm:number;diameterMm:number}
 | {kind:'move';circleId:string;xMm:number;yMm:number}
 | {kind:'resize';circleId:string;diameterMm:number}
 | {kind:'remove';circleId:string};
export type ArcHoleRevision = {sourceSignature:string;selectionSignature:string};
export interface ArcHoleControl {
  id:string;centerPointId:string;centerConstraintId:string|null;
  xMm:number;yMm:number;diameterMm:number;canMove:boolean;canResize:true;
}
export function createArcHoleSelection(source:unknown):ArcHoleSelection;
export function serializeArcHoleSelection(source:ArcHoleSelection):string;
export function inspectArcHoleControls(source:ArcSketchDocument,selection:ArcHoleSelection):{
  version:1;profileId:string;sourceSignature:string;
  selectionSignature:string;controls:ArcHoleControl[];
};
export type ArcHoleEditResult =
 | ({kind:'refused';version:1;reason:string} & ArcHoleRevision)
 | ({kind:'accepted';version:1;sketch:ArcSketchDocument;
     selection:ArcHoleSelection;solution:ArcSketchSolution;
     profile:AnalyticArcProfile} & ArcHoleRevision);
export function editArcProfileHole(
  source:ArcSketchDocument,selection:ArcHoleSelection,
  change:ArcHoleChange,expected:ArcHoleRevision
):ArcHoleEditResult;
