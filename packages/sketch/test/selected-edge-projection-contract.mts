import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeSketch} from '../index.mjs';
import {createSelectedEdgeProjection,inspectSelectedEdgeProjection,
  editSelectedEdgeProjection,dragSelectedEdgeProjection,
  removeSelectedEdgeProjection,SELECTED_EDGE_PROJECTION_VERSION}
  from '../selected-edge-projection.mjs';
import type {CreateEdgeProjectionCommand,EdgeProjectionAccepted,
  EdgeProjectionHandle,EdgeProjectionInspection} from '../selected-edge-projection.mjs';
const sketch=createDimensionedLPlateSketch();
const selection={candidateId:'selected',sourceSignature:serializeSketch(sketch)};
const cmd:CreateEdgeProjectionCommand={
  kind:'create-edge-projection',version:1,
  sourceSignature:selection.sourceSignature,projectionId:'crossDatum',
  sourceSplitId:'datum',targetEdgeId:'L:edge2'
};
const result=createSelectedEdgeProjection(sketch,selection,cmd);
if(result.kind==='accepted'){
  const accepted:EdgeProjectionAccepted=result;
  const inspected=inspectSelectedEdgeProjection(
    result.sketch,result.selection,'crossDatum','datum');
  if(inspected.kind==='selected_edge_projection'){
    const read:EdgeProjectionInspection=inspected;
    const handle:EdgeProjectionHandle=read.handles[0];
    const edited=editSelectedEdgeProjection(result.sketch,result.selection,{
      kind:'edit-edge-projection',version:1,
      sourceSignature:result.nextSourceSignature,
      projectionId:'crossDatum',sourceSplitId:'datum',
      sourceOffsetsMm:[50,70]});
    const dragged=dragSelectedEdgeProjection(result.sketch,result.selection,{
      version:1,sourceSignature:result.nextSourceSignature,
      projectionId:'crossDatum',sourceSplitId:'datum',
      handleId:handle.id,target:{x:60,y:45}});
    const removed=removeSelectedEdgeProjection(result.sketch,result.selection,{
      kind:'remove-edge-projection',version:1,
      sourceSignature:result.nextSourceSignature,
      projectionId:'crossDatum',sourceSplitId:'datum'});
    void accepted;void edited;void dragged;void removed;
  }
}
void SELECTED_EDGE_PROJECTION_VERSION;
