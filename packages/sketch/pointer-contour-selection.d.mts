import type {SketchDocument,SolveStatus} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile} from './selected-profile.mjs';

export const POINTER_CONTOUR_SELECTION_VERSION:1;
export type SketchPoint={x:number;y:number};
export type PointerProfileRefusal={
  kind:'refused';version:1;sourceSignature:string;
  reason:string;detail:string|null;sourceStatus:SolveStatus|null;
  diagnostics:[];previewOnly:true;nativeExact:false;
  exactBrepAvailable:false;independentStepQualified:false;
};
export type PointerProfileMiss={
  kind:'miss';version:1;sourceSignature:string;
  reason:'hole_void'|'outside_contours'|'no_edge_in_range';
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type PointerSelectableProfile={
  candidateId:string;semanticProfileId:string;lineIds:string[];holeIds:string[];
  boundary:SelectedAnalyticProfile['boundary'];areaMm2:number;
  bounds:{minX:number;minY:number;maxX:number;maxY:number};
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
};
export type PointerContourInventory={
  kind:'pointer_selectable_contours';version:1;sourceSignature:string;
  sourceStatus:SolveStatus|null;discoveryStatus:'ready'|'ambiguous';
  candidates:PointerSelectableProfile[];
  blocked:{candidateId:string;reason:string;overlappingLineIds:string[]}[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type SelectContourPointerCommand={
  kind:'select-contour-at-pointer';version:1;sourceSignature:string;
  point:SketchPoint;boundaryClearanceMm:number;
};
export type PickContourEdgePointerCommand={
  kind:'pick-contour-edge-at-pointer';version:1;sourceSignature:string;
  point:SketchPoint;maxDistanceMm:number;
};
export type PointerContourSelected={
  kind:'selected';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  hit:{kind:'interior';point:SketchPoint};
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type PointerContourEdgeSelected={
  kind:'selected_edge';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  edgeId:string;startPointId:string;endPointId:string;
  hit:{kind:'edge';point:SketchPoint;nearest:SketchPoint;fraction:number;
    alongMm:number;distanceMm:number;lengthMm:number};
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function inspectPointerSelectableContours(
  source:SketchDocument):PointerContourInventory|PointerProfileRefusal;
export function selectContourAtPointer(
  source:SketchDocument,request:SelectContourPointerCommand
):PointerContourSelected|PointerProfileMiss|PointerProfileRefusal;
export function pickContourEdgeAtPointer(
  source:SketchDocument,request:PickContourEdgePointerCommand
):PointerContourEdgeSelected|PointerProfileMiss|PointerProfileRefusal;
