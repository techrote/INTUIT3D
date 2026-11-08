/**
 * WORKBENCH consumer of RUNTIME's accepted, signature-fenced selected-edge API.
 * Only transient drafts live here. RUNTIME/SKETCH owns all anchor constraints,
 * contour selection, solver admission and the single INTENT undo journal event.
 */
import {runtime, type ModelSession} from './runtimeSession';

export type EdgeHoleReview=ReturnType<typeof runtime.inspectSelectedEdgeHoles>;
export type EdgeHoleEdit=Readonly<{
  holeId:string;edgeId:string;alongMm:number;insetMm:number;radiusMm:number;
}>;

export function inspectModelEdgeHoles(history:ModelSession):EdgeHoleReview {
  return runtime.inspectSelectedEdgeHoles(history,{
    projectId:history.document.projectId,expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.plate',
  });
}

export function commitModelEdgeHole(
  history:ModelSession,review:EdgeHoleReview,edit:EdgeHoleEdit,
) {
  if(review.kind!=='ready')throw Error('An admitted selected contour is required.');
  if(review.projectId!==history.document.projectId ||
     review.sourceRevision!==history.document.revision)
    throw Error('Selected-edge review is stale; inspect the latest model revision.');
  const edge=review.inspection.edges.find(item=>item.edgeId===edit.edgeId);
  if(!edge?.editable)throw Error('Choose an editable, solver-constrained edge.');
  const existing=review.inspection.holes.find(item=>item.holeId===edit.holeId);
  if(existing&&!existing.canEdit)
    throw Error('This hole uses other dimensional constraints; do not silently rebind them.');
  if(!existing&&!/^hole\.edge\.[A-Za-z0-9]+$/.test(edit.holeId))
    throw Error('New selected-edge hole requires a unique generated semantic ID.');
  if(![edit.alongMm,edit.insetMm,edit.radiusMm].every(Number.isFinite)||
     Math.max(Math.abs(edit.alongMm),Math.abs(edit.insetMm),edit.radiusMm)>10000||
     edit.radiusMm<=0)
    throw Error('Enter finite edge distances and a positive radius within 10,000 mm.');
  return runtime.editSelectedEdgeHoles(history,{
    sketchFeatureId:'sketch.plate',
    eventId:`workbench.edge.hole.${history.document.revision}`,
    expectedRevision:history.document.revision,
    selection:review.inspection.selection,
    command:{kind:'set-edge-holes',
      sourceSignature:review.inspection.sourceSignature,edits:[edit]},
  });
}

/** Removal is NOT a guessed plate-hole batch. Relative anchors are removed
 * through the admitted selected-profile dependency-aware RUNTIME operation. */
export function removeModelEdgeHole(history:ModelSession,holeId:string) {
  const review=runtime.inspectSelectedProfileHoles(history,{
    projectId:history.document.projectId,
    expectedRevision:history.document.revision,
    sketchFeatureId:'sketch.plate',
  });
  if(review.kind!=='ready')throw Error('No admitted selected profile for hole removal: '+review.reason);
  const hole=review.inspection.holes.find(item=>item.holeId===holeId);
  if(!hole?.canRemove)throw Error('Hole cannot be safely removed from the selected contour.');
  return runtime.editSelectedProfileHole(history,{
    sketchFeatureId:'sketch.plate',eventId:`workbench.edge.remove.${history.document.revision}`,
    expectedRevision:history.document.revision,
    selection:review.inspection.selection,
    command:{kind:'remove-hole',sourceSignature:review.inspection.sourceSignature,holeId},
  });
}
