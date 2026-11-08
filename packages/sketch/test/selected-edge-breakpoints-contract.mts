import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeSketch} from '../index.mjs';
import {createSelectedEdgeBreakpoints,inspectSelectedEdgeBreakpoints,
  editSelectedEdgeBreakpoints,dragSelectedEdgeBreakpoint,
  removeSelectedEdgeBreakpoints,SELECTED_EDGE_BREAKPOINTS_VERSION,
  MAX_SELECTED_EDGE_BREAKPOINTS} from '../selected-edge-breakpoints.mjs';
import type {CreateEdgeBreakpointsCommand,EdgeBreakpointHandle,
  EdgeBreakpointsAccepted} from '../selected-edge-breakpoints.mjs';
const sketch=createDimensionedLPlateSketch();
const selection={candidateId:'chosen',sourceSignature:serializeSketch(sketch)};
const command:CreateEdgeBreakpointsCommand={
  kind:'create-edge-breakpoints',version:1,sourceSignature:selection.sourceSignature,
  splitId:'datum',edgeId:'L:edge0',offsetsMm:[30,55]
};
const response=createSelectedEdgeBreakpoints(sketch,selection,command);
if(response.kind==='accepted'){
  const accepted:EdgeBreakpointsAccepted=response;
  const inspection=inspectSelectedEdgeBreakpoints(response.sketch,response.selection,'datum');
  if(inspection.kind==='selected_edge_breakpoints'){
    const handle:EdgeBreakpointHandle=inspection.handles[0];
    const edited=editSelectedEdgeBreakpoints(response.sketch,response.selection,{
      kind:'edit-edge-breakpoints',version:1,
      sourceSignature:response.nextSourceSignature,splitId:'datum',offsetsMm:[32,55]});
    dragSelectedEdgeBreakpoint(response.sketch,response.selection,{
      version:1,sourceSignature:response.nextSourceSignature,splitId:'datum',
      handleId:handle.id,target:{x:33,y:99}});
    removeSelectedEdgeBreakpoints(response.sketch,response.selection,{
      kind:'remove-edge-breakpoints',version:1,
      sourceSignature:response.nextSourceSignature,splitId:'datum'});
    void edited;void accepted;
  }
}
void SELECTED_EDGE_BREAKPOINTS_VERSION;
void MAX_SELECTED_EDGE_BREAKPOINTS;
