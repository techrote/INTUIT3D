/**
 * Workbench adapter for RUNTIME PR #319's versioned structural journal seam.
 * Does not replace the SKETCH solver or persist an independent browser sketch.
 * Before #319 is accepted, a user can draw/cancel but Close refuses clearly.
 */
import * as sketch from '@intuit3d/sketch';
import {createClosedContour} from '@intuit3d/sketch/closed-contour-authoring/v1';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import type {LivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
import {
  modelCurrentSketch,modelSketchIsEmpty,runtime,serializeModelSession,
  type ModelSession,
} from './runtimeSession';
import {beginBlankContourDraft,type BlankContourDraft} from './blankContourDraft';

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
  } as Parameters<LivePlateSession['applyCommand']>[0]) as unknown as
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
