/** Source-fenced consumer of SKETCH's normal-edge planner and the existing
 * RUNTIME structural contour edit transaction. No browser-owned geometry. */
import * as sketch from '@intuit3d/sketch';
import {
  inspectClosedContourEdges,dragClosedContourEdge,planClosedContourEdgeOffset,
  type ContourEdgeInspection,type ContourEdgeOffsetPlan,
} from '@intuit3d/sketch/contour-edge-offset/v1';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import type {LivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
import {inspectModelClosedContour} from './closedContourBridge.ts';
import {modelCurrentSketch,serializeModelSession,
  type ModelSession} from './runtimeSession.ts';
import type {SketchLocalPoint} from './blankContourDraft.ts';

export type EdgeEditResult =
  | Readonly<{kind:'committed';history:ModelSession;selection:SelectedProfileSelection;
      invalidatedFeatureIds:readonly string[];appliedOffsetMm:number}>
  | Readonly<{kind:'refused';code:string;reason:string}>;

export function inspectModelContourEdges(
  h:ModelSession,selection:SelectedProfileSelection,
):ContourEdgeInspection|null {
  const contour=inspectModelClosedContour(h,selection);
  if(!contour)return null;
  const result=inspectClosedContourEdges(modelCurrentSketch(h),selection,contour.contourId);
  return result.kind==='contour_edges'?result:null;
}

function commitPlannedEdge(
  h:ModelSession,session:LivePlateSession,selection:SelectedProfileSelection,
  edgeId:string,expectedArchive:string,
  plan:ContourEdgeOffsetPlan,
):EdgeEditResult {
  if(plan.kind!=='planned_edge_offset'||plan.edgeId!==edgeId||
      plan.sourceSignature!==sketch.serializeSketch(modelCurrentSketch(h)))
    return {kind:'refused',code:'stale_plan',reason:'SKETCH edge plan does not match current source.'};
  const edit=session.applyCommand({
    kind:'sketch.contour/v1',
    projectId:h.document.projectId,expectedRevision:h.document.revision,
    request:{
      format:'intuit3d.runtime.closed-contour-transaction',version:1,
      expectedArchive,expectedSketchSignature:plan.sourceSignature,
      sketchFeatureId:'sketch.plate',eventId:'workbench.contour.edge.'+h.document.revision,
      operation:'edit',admission:'require_admissible',
      selection,command:plan.editCommand,acceptance:plan.acceptance,
    },
  } as unknown as Parameters<LivePlateSession['applyCommand']>[0]) as unknown as
    | {kind:'committed';history:ModelSession;
        invalidation?:{invalidatedFeatureIds:readonly string[]};
        contourReceipt?:{selection:SelectedProfileSelection;revision:number;contourId:string;
          nextSketchSignature:string}}
    | {kind:'refused';reason:string;code?:string};
  if(edit.kind!=='committed')
    return {kind:'refused',code:edit.code??'runtime_refused',reason:edit.reason};
  if(!edit.contourReceipt||
      edit.contourReceipt.revision!==edit.history.document.revision||
      edit.contourReceipt.contourId!==plan.contourId||
      edit.contourReceipt.nextSketchSignature!==plan.nextSourceSignature||
      sketch.serializeSketch(modelCurrentSketch(edit.history))!==plan.nextSourceSignature||
      JSON.stringify(edit.contourReceipt.selection)!==JSON.stringify(plan.acceptance.selection))
    throw Error('RUNTIME returned a mismatched authoritative edge successor receipt.');
  return {kind:'committed',history:edit.history,
    selection:edit.contourReceipt.selection,
    invalidatedFeatureIds:edit.invalidation?.invalidatedFeatureIds??[],
    appliedOffsetMm:plan.appliedOffsetMm};
}

function sourceEdges(
  h:ModelSession,selection:SelectedProfileSelection,edgeId:string,expectedArchive:string,
):{kind:'ready';inventory:ContourEdgeInspection}|Extract<EdgeEditResult,{kind:'refused'}> {
  if(serializeModelSession(h)!==expectedArchive)
    return {kind:'refused',code:'stale_archive',
      reason:'The canonical journal changed since edge selection. Reselect the contour.'};
  const inventory=inspectModelContourEdges(h,selection);
  if(!inventory)return {kind:'refused',code:'stale_selection',
    reason:'The current SKETCH source does not admit the selected closed contour.'};
  if(!inventory.edges.some(edge=>edge.edgeId===edgeId))
    return {kind:'refused',code:'unselected_edge',
      reason:'Choose one actual edge from the current source-owned inventory.'};
  return {kind:'ready',inventory};
}

export function dragModelClosedContourEdge(
  h:ModelSession,session:LivePlateSession,selection:SelectedProfileSelection,
  edgeId:string,start:SketchLocalPoint,target:SketchLocalPoint,expectedArchive:string,
):EdgeEditResult {
  const valid=sourceEdges(h,selection,edgeId,expectedArchive);
  if(valid.kind==='refused')return valid;
  if(![start.x,start.y,target.x,target.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=10000))
    return {kind:'refused',code:'invalid_pointer',reason:'Edge drag outside bounded sketch workspace.'};
  const proposal=dragClosedContourEdge(modelCurrentSketch(h),selection,{
    version:1,sourceSignature:valid.inventory.sourceSignature,
    contourId:valid.inventory.contourId,edgeId,start,target,
  });
  if(proposal.kind!=='planned_edge_offset')
    return {kind:'refused',code:'sketch_refused',reason:proposal.reason+
      (proposal.detail?' ('+proposal.detail+')':'')};
  return commitPlannedEdge(h,session,selection,edgeId,expectedArchive,proposal);
}

export function offsetModelClosedContourEdge(
  h:ModelSession,session:LivePlateSession,selection:SelectedProfileSelection,
  edgeId:string,offsetMm:number,expectedArchive:string,
):EdgeEditResult {
  const valid=sourceEdges(h,selection,edgeId,expectedArchive);
  if(valid.kind==='refused')return valid;
  if(!Number.isFinite(offsetMm)||Math.abs(offsetMm)>10000||offsetMm===0)
    return {kind:'refused',code:'invalid_offset',reason:'Enter a finite nonzero signed edge offset within 10,000 mm.'};
  const proposal=planClosedContourEdgeOffset(modelCurrentSketch(h),selection,{
    kind:'offset-closed-contour-edge',version:1,
    sourceSignature:valid.inventory.sourceSignature,contourId:valid.inventory.contourId,
    edgeId,offsetMm,
  });
  if(proposal.kind!=='planned_edge_offset')
    return {kind:'refused',code:'sketch_refused',reason:proposal.reason+
      (proposal.detail?' ('+proposal.detail+')':'')};
  return commitPlannedEdge(h,session,selection,edgeId,expectedArchive,proposal);
}
