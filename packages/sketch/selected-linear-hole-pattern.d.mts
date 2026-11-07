import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedAnalyticProfile,SelectedProfileSelection} from './selected-profile.mjs';

export const SELECTED_LINEAR_HOLE_PATTERN_VERSION:1;
export type LinearHolePatternMember={
  holeId:string;centerPointId:string;position:{x:number;y:number};
  radiusMm:number;xConstraintId:string;yConstraintId:string;
  radiusConstraintId:string;
};
export type SelectedLinearHolePatternInspection={
  kind:'selected_linear_hole_pattern';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;
  patternId:string;count:number;anchorPointId:string;
  pitchXmm:number;pitchYmm:number;radiusMm:number;
  members:LinearHolePatternMember[];
  previewOnly:true;nativeExact:false;
};
export type SelectedLinearHolePatternRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false;
};
export type SelectedLinearHolePatternCommand=
  | {kind:'create-pattern';sourceSignature:string;patternId:string;
     anchorPointId:string;firstXmm:number;firstYmm:number;
     pitchXmm:number;pitchYmm:number;radiusMm:number;count:number}
  | {kind:'set-pattern';sourceSignature:string;patternId:string;
     pitchXmm:number;pitchYmm:number;radiusMm:number;count:number}
  | {kind:'remove-pattern';sourceSignature:string;patternId:string};
export type SelectedLinearHolePatternAccepted={
  kind:'accepted';version:1;operation:SelectedLinearHolePatternCommand['kind'];
  sourceSignature:string;nextSourceSignature:string;sketch:SketchDocument;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  semanticProfileId:string;patternId:string;
  pattern:SelectedLinearHolePatternInspection|null;changedConstraintIds:string[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function inspectSelectedLinearHolePattern(
  source:SketchDocument,selection:SelectedProfileSelection,patternId:string
):SelectedLinearHolePatternInspection|SelectedLinearHolePatternRefusal;
export function editSelectedLinearHolePattern(
  source:SketchDocument,selection:SelectedProfileSelection,
  command:SelectedLinearHolePatternCommand
):SelectedLinearHolePatternAccepted|SelectedLinearHolePatternRefusal;
