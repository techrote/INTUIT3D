import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile} from './selected-profile.mjs';

export const SELECTED_EDGE_HOLE_PLACEMENT_VERSION:1;
export type SelectedEdgeHole={
  holeId:string;centerPointId:string;position:{x:number;y:number};
  radiusMm:number;xConstraintId:string|null;yConstraintId:string|null;
  radiusConstraintId:string|null;canEdit:boolean;
  edgeBinding:{edgeId:string;anchorPointId:string;alongMm:number;insetMm:number}|null;
};
export type SelectedEdge={
  edgeId:string;startPointId:string;endPointId:string;
  start:{x:number;y:number};end:{x:number;y:number};
  lengthMm:number;editable:boolean;axis:'horizontal'|'vertical'|null;
  constraintIds:string[];tangent:{x:number;y:number}|null;
  inward:{x:number;y:number}|null;
};
export type SelectedEdgeHoleInspection={
  kind:'selected_edge_hole_placement';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;
  edges:SelectedEdge[];holes:SelectedEdgeHole[];
  profile:SelectedAnalyticProfile;previewOnly:true;nativeExact:false;
};
export type SelectedEdgeHoleCommand={
  kind:'set-edge-holes';sourceSignature:string;
  edits:Array<{holeId:string;edgeId:string;alongMm:number;
    insetMm:number;radiusMm:number}>;
};
export type SelectedEdgeHoleRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false;
};
export type SelectedEdgeHoleAcceptance={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  semanticProfileId:string;profile:SelectedAnalyticProfile;
  changedConstraintIds:string[];
  createdHoleIds:string[];reanchoredHoleIds:string[];affectedHoleIds:string[];
  edits:Array<{holeId:string;edgeId:string;anchorPointId:string;
    alongMm:number;insetMm:number;radiusMm:number;
    xMm:number;yMm:number;xConstraintId:string;yConstraintId:string;
    radiusConstraintId:string}>;
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function inspectSelectedEdgeHolePlacement(
  source:SketchDocument,selection:SelectedProfileSelection
):SelectedEdgeHoleInspection|SelectedEdgeHoleRefusal;
export function setSelectedEdgeHoles(
  source:SketchDocument,selection:SelectedProfileSelection,
  command:SelectedEdgeHoleCommand
):SelectedEdgeHoleAcceptance|SelectedEdgeHoleRefusal;
