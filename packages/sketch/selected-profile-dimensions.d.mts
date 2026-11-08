import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedAnalyticProfile,SelectedProfileSelection} from './selected-profile.mjs';
import type {ConflictExplanation} from './conflict-explanation.mjs';

export const SELECTED_PROFILE_DIMENSIONS_VERSION:1;
export type DimensionHandle={
  id:string;kind:'distanceX'|'distanceY'|'radius';
  position:{x:number;y:number};
};
export type SelectedDimension={
  constraintId:string;kind:'distanceX'|'distanceY'|'radius';
  value:number;referencePointId?:string;drivenPointId?:string;
  circleId?:string;centerPointId?:string;handle:DimensionHandle;
};
export type DimensionRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];
  conflict:ConflictExplanation|null;previewOnly:true;nativeExact:false;
};
export type DimensionInspection={
  kind:'selected_profile_dimensions';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  dimensions:SelectedDimension[];solverStatus:'solved';
  degreesOfFreedom:number;redundantEquations:number|null;
  diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;
};
export type DimensionChange={constraintId:string;value:number};
export type EditSelectedDimensionsCommand={
  kind:'edit-selected-dimensions';version:1;sourceSignature:string;
  changes:DimensionChange[];
};
export type DimensionGesture={
  version:1;sourceSignature:string;handleId:string;
  target:{x:number;y:number};
};
export type DimensionAccepted={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;previousCandidateId:string;
  nextCandidateId:string;changedConstraintIds:string[];
  changedPointIds:string[];changedRadiusIds:string[];
  solverStatus:'solved';degreesOfFreedom:number;redundantEquations:number|null;
  diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type DimensionDragged=DimensionAccepted&{gesture:{
  handleId:string;requested:{x:number;y:number};
  applied:{x:number;y:number};projectionDeviationMm:number;
}};
export function inspectSelectedProfileDimensions(
  source:SketchDocument,selection:SelectedProfileSelection
):DimensionInspection|DimensionRefusal;
export function editSelectedProfileDimensions(
  source:SketchDocument,selection:SelectedProfileSelection,
  command:EditSelectedDimensionsCommand
):DimensionAccepted|DimensionRefusal;
export function dragSelectedProfileDimension(
  source:SketchDocument,selection:SelectedProfileSelection,
  gesture:DimensionGesture
):DimensionDragged|DimensionRefusal;
