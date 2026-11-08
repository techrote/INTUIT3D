import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile} from './selected-profile.mjs';
export const SELECTED_EDGE_BREAKPOINTS_VERSION:1;
export const MAX_SELECTED_EDGE_BREAKPOINTS:8;
export type EdgeBreakpointsRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false;
};
export type EdgeBreakpointHandle={
  id:string;kind:'offset';index:number;position:{x:number;y:number};
};
export type EdgeBreakpointsInspection={
  kind:'selected_edge_breakpoints';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;splitId:string;originalEdgeId:string;
  startPointId:string;endPointId:string;
  start:{x:number;y:number};end:{x:number;y:number};
  tangent:{x:number;y:number};axis:'horizontal'|'vertical';
  lengthMm:number;offsetsMm:number[];handles:EdgeBreakpointHandle[];
  profile:SelectedAnalyticProfile;previewOnly:true;nativeExact:false;
};
export type CreateEdgeBreakpointsCommand={
  kind:'create-edge-breakpoints';version:1;sourceSignature:string;
  splitId:string;edgeId:string;offsetsMm:number[];
};
export type EditEdgeBreakpointsCommand={
  kind:'edit-edge-breakpoints';version:1;sourceSignature:string;
  splitId:string;offsetsMm:number[];
};
export type RemoveEdgeBreakpointsCommand={
  kind:'remove-edge-breakpoints';version:1;sourceSignature:string;splitId:string;
};
export type DragEdgeBreakpointGesture={
  version:1;sourceSignature:string;splitId:string;
  handleId:string;target:{x:number;y:number};
};
export type EdgeBreakpointsAccepted={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;previousCandidateId:string;
  nextCandidateId:string;splitId:string;originalEdgeId:string;
  createdEntityIds:string[];changedConstraintIds:string[];
  handles:EdgeBreakpointHandle[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type EdgeBreakpointDragged=EdgeBreakpointsAccepted&{
  gesture:{handleId:string;requested:{x:number;y:number};
    applied:{x:number;y:number};projectionDeviationMm:number};
};
export function createSelectedEdgeBreakpoints(source:SketchDocument,
  selection:SelectedProfileSelection,command:CreateEdgeBreakpointsCommand):
  EdgeBreakpointsAccepted|EdgeBreakpointsRefusal;
export function inspectSelectedEdgeBreakpoints(source:SketchDocument,
  selection:SelectedProfileSelection,splitId:string):
  EdgeBreakpointsInspection|EdgeBreakpointsRefusal;
export function editSelectedEdgeBreakpoints(source:SketchDocument,
  selection:SelectedProfileSelection,command:EditEdgeBreakpointsCommand):
  EdgeBreakpointsAccepted|EdgeBreakpointsRefusal;
export function dragSelectedEdgeBreakpoint(source:SketchDocument,
  selection:SelectedProfileSelection,gesture:DragEdgeBreakpointGesture):
  EdgeBreakpointDragged|EdgeBreakpointsAccepted|EdgeBreakpointsRefusal;
export function removeSelectedEdgeBreakpoints(source:SketchDocument,
  selection:SelectedProfileSelection,command:RemoveEdgeBreakpointsCommand):
  EdgeBreakpointsAccepted|EdgeBreakpointsRefusal;
