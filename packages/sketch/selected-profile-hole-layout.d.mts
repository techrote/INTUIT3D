import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedAnalyticProfile,SelectedProfileSelection} from './selected-profile.mjs';

export const SELECTED_PROFILE_HOLE_LAYOUT_VERSION:1;
export type SelectedProfileHoleLayoutControl={
  holeId:string;centerPointId:string;position:{x:number;y:number};
  radiusMm:number;xConstraintId:string|null;yConstraintId:string|null;
  radiusConstraintId:string|null;xReferencePointId:string|null;
  yReferencePointId:string|null;dependentEntityIds:string[];canEdit:boolean;
};
export type SelectedProfileHoleLayoutInspection={
  kind:'selected_profile_hole_layout';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;
  holes:SelectedProfileHoleLayoutControl[];profile:SelectedAnalyticProfile;
  previewOnly:true;nativeExact:false;
};
export type SelectedProfileHoleLayoutCommand={
  kind:'set-hole-layout';sourceSignature:string;
  /** Optional explicit reference for both X/Y axes; omitted retains intent. */
  edits:Array<{holeId:string;xMm:number;yMm:number;radiusMm:number;
    anchorPointId?:string}>;
};
export type SelectedProfileHoleLayoutRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false;
};
export type SelectedProfileHoleLayoutAccepted={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;semanticProfileId:string;
  changedConstraintIds:string[];
  edits:Array<{
    holeId:string;before:{x:number;y:number;radiusMm:number};
    after:{x:number;y:number;radiusMm:number};
    xConstraintId:string;yConstraintId:string;radiusConstraintId:string;
    xReferencePointId:string;yReferencePointId:string;
    xOffsetMm:number;yOffsetMm:number;
  }>;
  affectedHoleIds:string[];reanchoredHoleIds:string[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function inspectSelectedProfileHoleLayout(
  source:SketchDocument,selection:SelectedProfileSelection
):SelectedProfileHoleLayoutInspection|SelectedProfileHoleLayoutRefusal;
export function editSelectedProfileHoleLayout(
  source:SketchDocument,selection:SelectedProfileSelection,
  command:SelectedProfileHoleLayoutCommand
):SelectedProfileHoleLayoutAccepted|SelectedProfileHoleLayoutRefusal;
