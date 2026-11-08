/**
 * Workbench adapter for RUNTIME PR #319's versioned structural journal seam.
 * Does not replace the SKETCH solver or persist an independent browser sketch.
 * Before #319 is accepted, a user can draw/cancel but Close refuses clearly.
 */
import * as sketch from '@intuit3d/sketch';
import {createClosedContour,inspectClosedContour,dragClosedContourVertex, type ClosedContourInspection} from '@intuit3d/sketch/closed-contour-authoring/v1';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import type {LivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
import {
  modelCurrentSketch,modelSketchIsEmpty,runtime,serializeModelSession,
  type ModelSession,
} from './runtimeSession.ts';
import {beginBlankContourDraft,type BlankContourDraft,type SketchLocalPoint} from './blankContourDraft.ts';

export type BlankContourCommit =
  | Readonly<{kind:'committed';history:ModelSession;selection:SelectedProfileSelection}>
  | Readonly<{kind:'refused';reason:string;code:string}>;

export function structuralContourRuntimeAvailable():boolean {
  return 'commitClosedContour' in runtime&&typeof runtime.commitClosedContour==='function';
}
export function startModelBlankContour(h:ModelSession):BlankContourDraft {
  if(!modelSketchIsEmpty(h))
    throw Error('The first outline can only be drawn on a truly empty sketch.');
  return beginBlankContourDraft({
    projectId:h.document.projectId,
    revision:h.document.revision,
    expectedArchive:serializeModelSession(h),
    expectedSketchSignature:sketch.serializeSketch(modelCurrentSketch(h)),
    contourId:'drawn.'+h.document.revision,
  });
}
export function commitModelBlankContour(
  h:ModelSession,session:LivePlateSession,draft:BlankContourDraft,
):BlankContourCommit {
  const currentArchive=serializeModelSession(h);
  if(draft.projectId!==h.document.projectId||draft.revision!==h.document.revision||
      draft.expectedArchive!==currentArchive)
    return {kind:'refused',code:'stale_source',reason:'The authoritative journal changed while drawing; restart the outline.'};
  const source=modelCurrentSketch(h);
  if(draft.expectedSketchSignature!==sketch.serializeSketch(source))
    return {kind:'refused',code:'stale_sketch',reason:'The SKETCH source changed; restart the outline.'};
  if(!modelSketchIsEmpty(h))
    return {kind:'refused',code:'occupied_sketch',reason:'The initial sketch already contains geometry.'};
  if(!structuralContourRuntimeAvailable())
    return {kind:'refused',code:'runtime_not_admitted',reason:'Drawing retained locally but Close cannot journal it until the versioned RUNTIME structural contour transaction (#319) is admitted.'};
  const command={
    kind:'create-closed-contour' as const,version:1 as const,
    sourceSignature:draft.expectedSketchSignature,contourId:draft.contourId,
    vertices:draft.vertices.map(p=>({x:p.x,y:p.y})),
  };
  const acceptance=createClosedContour(source,command);
  if(acceptance.kind!=='accepted')
    return {kind:'refused',code:'sketch_refused',reason:'SKETCH refused this outline: '+acceptance.reason+
      (acceptance.detail?' ('+acceptance.detail+')':'')};
  // Build precisely the #319 versioned request, including the whole canonical
  // archive fence and the full SKETCH acceptance (not only a projected profile).
  const edit=session.applyCommand({
    kind:'sketch.contour/v1',
    projectId:h.document.projectId,expectedRevision:h.document.revision,
    request:{
      format:'intuit3d.runtime.closed-contour-transaction',version:1,
      expectedArchive:draft.expectedArchive,
      expectedSketchSignature:draft.expectedSketchSignature,
      sketchFeatureId:'sketch.plate',eventId:'workbench.contour.'+h.document.revision,
      operation:'create',admission:'require_admissible',
      command,acceptance,
    },
  } as unknown as Parameters<LivePlateSession['applyCommand']>[0]) as unknown as
    | {kind:'committed';history:ModelSession;
        contourReceipt?:{selection:SelectedProfileSelection;revision:number}}
    | {kind:'refused';reason:string;code?:string};
  if(edit.kind!=='committed')
    return {kind:'refused',code:edit.code??'runtime_refused',reason:edit.reason};
  if(!edit.contourReceipt||edit.contourReceipt.revision!==edit.history.document.revision)
    throw Error('RUNTIME omitted the required source-bound successor contour receipt.');
  // The live RUNTIME publisher owns the authoritative successor; no UI model
  // patch or fabricated semantic handles are accepted.
  return {kind:'committed',history:edit.history,selection:edit.contourReceipt.selection};
}

/**
 * Discover a drawn contour exclusively through SKETCH's solved, source-fenced
 * inspection. Semantic IDs come from the actual journal, never browser pixel
 * geometry. Seeded contours are intentionally not treated as drawn outlines.
 */
export function inspectModelClosedContour(
  h:ModelSession,selection:SelectedProfileSelection,
):ClosedContourInspection|null {
  const source=modelCurrentSketch(h),signature=sketch.serializeSketch(source);
  if(signature!==selection.sourceSignature)return null;
  const candidates=new Set(source.lines.flatMap(line=>{
    const match=/^([A-Za-z][\\w:.-]{0,80}):edge:0$/.exec(line.id);
    return match?[match[1]]:[];
  }));
  const admitted=[...candidates].map(id=>inspectClosedContour(source,selection,id))
    .filter((result):result is ClosedContourInspection=>result.kind==='closed_contour');
  if(admitted.length>1)throw Error('Ambiguous structural contour selection.');
  return admitted[0]??null;
}

export type ClosedContourVertexEdit =
  | Readonly<{kind:'committed';history:ModelSession;selection:SelectedProfileSelection;
      invalidatedFeatureIds:readonly string[]}>
  | Readonly<{kind:'refused';code:string;reason:string}>;

/** Commit one selected semantic vertex gesture through the same RUNTIME journal
 * as initial Close. Replaying the accepted drag in RUNTIME also checks hidden
 * entity loss, hole association, and exact canonical archive identity.
 */
export function dragModelClosedContourVertex(
  h:ModelSession,session:LivePlateSession,selection:SelectedProfileSelection,
  handleId:string,target:SketchLocalPoint,
):ClosedContourVertexEdit {
  const inspected=inspectModelClosedContour(h,selection);
  if(!inspected)return {kind:'refused',code:'stale_selection',
    reason:'The current solver source does not admit this selected drawn contour. Reselect it.'};
  if(!inspected.handles.some(handle=>handle.handleId===handleId))
    return {kind:'refused',code:'unselected_handle',
      reason:'Select a vertex handle from the current solver-owned contour.'};
  if(!Number.isFinite(target.x)||!Number.isFinite(target.y)||
      Math.abs(target.x)>10000||Math.abs(target.y)>10000)
    return {kind:'refused',code:'invalid_target',reason:'Vertex target is outside the bounded sketch workspace.'};
  const source=modelCurrentSketch(h);
  const command={version:1 as const,sourceSignature:inspected.sourceSignature,
    contourId:inspected.contourId,handleId,target:{x:target.x,y:target.y}};
  const acceptance=dragClosedContourVertex(source,selection,command);
  if(acceptance.kind!=='accepted')
    return {kind:'refused',code:'sketch_refused',reason:'SKETCH refused vertex movement: '+acceptance.reason+
      (acceptance.detail?' ('+acceptance.detail+')':'')};
  const edit=session.applyCommand({
    kind:'sketch.contour/v1',
    projectId:h.document.projectId,expectedRevision:h.document.revision,
    request:{
      format:'intuit3d.runtime.closed-contour-transaction',version:1,
      expectedArchive:serializeModelSession(h),
      expectedSketchSignature:inspected.sourceSignature,
      sketchFeatureId:'sketch.plate',eventId:'workbench.contour.drag.'+h.document.revision,
      operation:'drag',admission:'require_admissible',
      selection,command,acceptance,
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
      edit.contourReceipt.contourId!==inspected.contourId||
      edit.contourReceipt.nextSketchSignature!==acceptance.nextSourceSignature||
      sketch.serializeSketch(modelCurrentSketch(edit.history))!==acceptance.nextSourceSignature||
      JSON.stringify(edit.contourReceipt.selection)!==JSON.stringify(acceptance.selection))
    throw Error('RUNTIME returned a mismatched authoritative vertex successor receipt.');
  return {kind:'committed',history:edit.history,
    selection:edit.contourReceipt.selection,
    invalidatedFeatureIds:edit.invalidation?.invalidatedFeatureIds??[]};
}
