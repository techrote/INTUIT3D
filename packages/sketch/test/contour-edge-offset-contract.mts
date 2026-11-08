import type {SketchDocument} from '@intuit3d/sketch';
import {inspectClosedContourEdges,planClosedContourEdgeOffset,
  dragClosedContourEdge,CONTOUR_EDGE_OFFSET_VERSION,
  type ContourEdgeInspection,type ContourOffsetEdge,
  type ContourEdgeOffsetPlan,type ContourEdgeDragPlan}
  from '@intuit3d/sketch/contour-edge-offset/v1';
import type {SelectedProfileSelection}
  from '@intuit3d/sketch/selected-profile/v1';
declare const source:SketchDocument;
declare const selected:SelectedProfileSelection;
declare const stamp:string;
const inspection=inspectClosedContourEdges(source,selected,'panel');
if(inspection.kind==='contour_edges'){
  const typed:ContourEdgeInspection=inspection;
  const first:ContourOffsetEdge=typed.edges[0];
  const plan=planClosedContourEdgeOffset(source,selected,{
    kind:'offset-closed-contour-edge',version:1,sourceSignature:stamp,
    contourId:'panel',edgeId:first.edgeId,offsetMm:20});
  if(plan.kind==='planned_edge_offset'){
    const admitted:ContourEdgeOffsetPlan=plan;
    const edits:readonly {index:number;xMm:number;yMm:number}[]=
      admitted.editCommand.changes;
    void edits;
  }
  const gesture=dragClosedContourEdge(source,selected,{
    version:1,sourceSignature:stamp,contourId:'panel',
    edgeId:first.edgeId,start:{x:120,y:20},target:{x:150,y:20}});
  if(gesture.kind==='planned_edge_offset'){
    const typedDrag:ContourEdgeDragPlan=gesture;
    void typedDrag.gesture.tangentialDeviationMm;
  }
}
void CONTOUR_EDGE_OFFSET_VERSION;
