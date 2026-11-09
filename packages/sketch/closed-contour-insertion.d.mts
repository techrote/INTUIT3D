import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile}
  from './selected-profile.mjs';
export const CLOSED_CONTOUR_INSERTION_VERSION:1;
export type SketchLocalPoint={x:number;y:number};
export type ContourInsertionRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type InsertContourTabCommand={
  kind:'insert-closed-contour-tab';version:1;
  sourceSignature:string;contourId:string;edgeId:string;tabId:string;
  vertices:[SketchLocalPoint,SketchLocalPoint];
};
export type TabbedContourHandle={
  handleId:string;pointId:string;kind:'origin'|'vertex'|'inserted';
  position:SketchLocalPoint;constraintIds:string[];
};
export type TabbedClosedContourInspection={
  kind:'tabbed_closed_contour';version:1;sourceSignature:string;
  contourId:string;tabId:string;retiredEdgeId:string;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  handles:TabbedContourHandle[];vertices:SketchLocalPoint[];
  solverStatus:'solved';degreesOfFreedom:number;
  diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type EditTabbedContourCommand={
  kind:'edit-tabbed-contour-vertex';version:1;
  sourceSignature:string;contourId:string;tabId:string;
  handleId:string;target:SketchLocalPoint;
};
export type ContourTopologyAccepted={
  kind:'accepted';version:1;operation:'insert'|'edit';
  sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;contourId:string;tabId:string;
  previousCandidateId:string;nextCandidateId:string;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  handles:TabbedContourHandle[];
  movedDependentHoles:Array<{holeId:string;centerPointId:string;
    from:SketchLocalPoint;to:SketchLocalPoint}>;
  solverStatus:'solved';degreesOfFreedom:number;
  diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type InsertContourTabAccepted=ContourTopologyAccepted&{
  operation:'insert';createdEntityIds:string[];retiredEntityIds:string[];
  preservedPointIds:string[];
};
export type EditTabbedContourAccepted=ContourTopologyAccepted&{
  operation:'edit';changedConstraintIds:string[];
};
export function insertClosedContourTab(source:SketchDocument,
  selection:SelectedProfileSelection,command:InsertContourTabCommand):
  InsertContourTabAccepted|ContourInsertionRefusal;
export function inspectTabbedClosedContour(source:SketchDocument,
  selection:SelectedProfileSelection,contourId:string,tabId:string):
  TabbedClosedContourInspection|ContourInsertionRefusal;
export function editTabbedContourVertex(source:SketchDocument,
  selection:SelectedProfileSelection,command:EditTabbedContourCommand):
  EditTabbedContourAccepted|ContourInsertionRefusal;
