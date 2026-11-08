import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection} from './selected-profile.mjs';
import type {ClosedContourAccepted,ClosedContourRefusal,SketchLocalPoint}
  from './closed-contour-authoring.mjs';

export const CONTOUR_EDGE_OFFSET_VERSION:1;

export type ContourOffsetEdge={
  edgeId:string;startIndex:number;endIndex:number;
  startHandleId:string;endHandleId:string;
  start:SketchLocalPoint;end:SketchLocalPoint;
  midpoint:SketchLocalPoint;normal:SketchLocalPoint;lengthMm:number;
};
export type ContourEdgeInspection={
  kind:'contour_edges';version:1;sourceSignature:string;contourId:string;
  selection:SelectedProfileSelection;edges:ContourOffsetEdge[];
  solverStatus:'solved';degreesOfFreedom:number;
  diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type ClosedContourEdgeOffsetRequest={
  kind:'offset-closed-contour-edge';version:1;sourceSignature:string;
  contourId:string;edgeId:string;offsetMm:number;
};
export type ClosedContourEdgeDragRequest={
  version:1;sourceSignature:string;contourId:string;
  edgeId:string;target:SketchLocalPoint;
};
export type ContourEdgeOffsetPlan={
  kind:'planned_edge_offset';version:1;
  sourceSignature:string;nextSourceSignature:string;
  contourId:string;edgeId:string;offsetMm:number;appliedOffsetMm:number;
  residualMm:number;from:ContourOffsetEdge;to:ContourOffsetEdge;
  editCommand:{
    kind:'edit-closed-contour-vertices';version:1;sourceSignature:string;
    contourId:string;changes:Array<{index:number;xMm:number;yMm:number}>;
  };
  acceptance:ClosedContourAccepted;
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type ContourEdgeDragPlan=ContourEdgeOffsetPlan&{
  gesture:{
    edgeId:string;requested:SketchLocalPoint;projected:SketchLocalPoint;
    applied:SketchLocalPoint;tangentialDeviationMm:number;
    appliedDeviationMm:number;
  };
};
export function inspectClosedContourEdges(
  source:SketchDocument,selection:SelectedProfileSelection,
  contourId:string):ContourEdgeInspection|ClosedContourRefusal;
export function planClosedContourEdgeOffset(
  source:SketchDocument,selection:SelectedProfileSelection,
  request:ClosedContourEdgeOffsetRequest):ContourEdgeOffsetPlan|ClosedContourRefusal;
export function dragClosedContourEdge(
  source:SketchDocument,selection:SelectedProfileSelection,
  gesture:ClosedContourEdgeDragRequest):ContourEdgeDragPlan|ClosedContourRefusal;
