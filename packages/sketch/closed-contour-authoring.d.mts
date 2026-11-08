import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile} from './selected-profile.mjs';
export const CLOSED_CONTOUR_AUTHORING_VERSION:1;
export const MAX_CLOSED_CONTOUR_VERTICES:12;
export type SketchLocalPoint={x:number;y:number};
export type ClosedContourRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;
  nativeExact:false;exactBrepAvailable:false;independentStepQualified:false;
};
export type ClosedContourHandle={
  handleId:string;index:number;kind:'origin'|'vertex';pointId:string;
  position:SketchLocalPoint;constraintIds:string[];
};
export type ClosedContourInspection={
  kind:'closed_contour';version:1;sourceSignature:string;contourId:string;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  vertices:SketchLocalPoint[];handles:ClosedContourHandle[];
  dimensions:Array<{index:number;xConstraintId:string;yConstraintId:string;
    offsetXmm:number;offsetYmm:number}>;
  solverStatus:'solved';degreesOfFreedom:number;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false;
  exactBrepAvailable:false;independentStepQualified:false;
};
export type CreateClosedContourCommand={
  kind:'create-closed-contour';version:1;sourceSignature:string;
  contourId:string;vertices:SketchLocalPoint[];
};
export type EditClosedContourCommand={
  kind:'edit-closed-contour-vertices';version:1;sourceSignature:string;
  contourId:string;changes:Array<{index:number;xMm:number;yMm:number}>;
};
export type DragClosedContourGesture={
  version:1;sourceSignature:string;contourId:string;
  handleId:string;target:SketchLocalPoint;
};
export type ClosedContourAccepted={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;contourId:string;
  previousCandidateId:string|null;nextCandidateId:string;
  createdEntityIds:string[];changedConstraintIds:string[];
  handles:ClosedContourHandle[];
  movedDependentHoles:Array<{holeId:string;centerPointId:string;
    from:SketchLocalPoint;to:SketchLocalPoint}>;
  solverStatus:'solved';
  degreesOfFreedom:number;diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type ClosedContourDragged=ClosedContourAccepted&{
  gesture:{handleId:string;requested:SketchLocalPoint;applied:SketchLocalPoint;
    deviationMm:number};
};
export function createClosedContour(source:SketchDocument,
  command:CreateClosedContourCommand):ClosedContourAccepted|ClosedContourRefusal;
export function inspectClosedContour(source:SketchDocument,
  selection:SelectedProfileSelection,contourId:string):
  ClosedContourInspection|ClosedContourRefusal;
export function editClosedContourVertices(source:SketchDocument,
  selection:SelectedProfileSelection,command:EditClosedContourCommand):
  ClosedContourAccepted|ClosedContourRefusal;
export function dragClosedContourVertex(source:SketchDocument,
  selection:SelectedProfileSelection,gesture:DragClosedContourGesture):
  ClosedContourDragged|ClosedContourAccepted|ClosedContourRefusal;
