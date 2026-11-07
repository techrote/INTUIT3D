import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedAnalyticProfile,SelectedProfileSelection} from './selected-profile.mjs';
import type {SelectedLinearHolePatternInspection,SelectedLinearHolePatternRefusal}
  from './selected-linear-hole-pattern.mjs';
import type {SelectedProfileHandleRefusal} from './selected-profile-handles.mjs';

export const SELECTED_LINEAR_PATTERN_HANDLES_VERSION:1;
export type LinearPatternDragHandle={
  id:string;kind:'origin'|'pitch'|'radius';holeId:string;
  anchor:{x:number;y:number};position:{x:number;y:number};
  constraintIds:string[];
};
export type SelectedLinearPatternHandles={
  kind:'selected_linear_pattern_handles';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;patternId:string;
  pattern:SelectedLinearHolePatternInspection;handles:LinearPatternDragHandle[];
  previewOnly:true;nativeExact:false;
};
export type LinearPatternDragCommand={
  kind:'drag-pattern-handle';sourceSignature:string;patternId:string;
  handleId:string;xMm:number;yMm:number;
};
export type LinearPatternDragAccepted={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;semanticProfileId:string;patternId:string;
  pattern:SelectedLinearHolePatternInspection;handleId:string;
  changedConstraintIds:string[];
  gesture:{target:{x:number;y:number};appliedPoint:{x:number;y:number};
    deviationMm:number};
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type LinearPatternDragRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false;
};
export function inspectSelectedLinearPatternHandles(
  source:SketchDocument,selection:SelectedProfileSelection,patternId:string
):SelectedLinearPatternHandles|SelectedLinearHolePatternRefusal|
  SelectedProfileHandleRefusal|LinearPatternDragRefusal;
export function dragSelectedLinearPatternHandle(
  source:SketchDocument,selection:SelectedProfileSelection,
  command:LinearPatternDragCommand
):LinearPatternDragAccepted|SelectedLinearHolePatternRefusal|
  SelectedProfileHandleRefusal|LinearPatternDragRefusal;
