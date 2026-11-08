/**
 * Model-owned historical edit inventory and one-transaction field compensation.
 * This is a read-only journal projection until a specifically reviewed choice
 * is committed; never a geometry, sketch-solver or STEP authority.
 */
import {serializeProject} from '@intuit3d/model';
import {
  HISTORICAL_EDIT_INVENTORY_FORMAT, inspectHistoricalFeatureEdits,
  type HistoricalEditChoice,
} from '@intuit3d/model/historical-edit-inventory';
import {
  FEATURE_EDIT_FIELD_REVERT_FORMAT, commitUndoableFeatureEditFieldRevert,
} from '@intuit3d/model/feature-edit-revert';
import type {FeaturePatch} from '@intuit3d/model';
import type {ModelSession} from './runtimeSession.ts';

export function inspectWorkbenchHistoricalEdits(
  history:ModelSession,cursor:number|null=null,limit=4,
) {
  const document=history.document;
  return inspectHistoricalFeatureEdits(document,{
    format:HISTORICAL_EDIT_INVENTORY_FORMAT,version:1,
    expectedProjectId:document.projectId,
    expectedRevision:document.revision,
    expectedDocumentFence:serializeProject(document),
    probeEventId:'workbench.history.probe.'+document.revision,
    cursor,limit,
  });
}

export function compensateWorkbenchHistoricalField(
  history:ModelSession,row:HistoricalEditChoice,field:keyof FeaturePatch,
  displayedDocumentFence:string,explicitConsent:boolean,
):ModelSession {
  const document=history.document;
  // Rendered choices are never trusted after a model replacement, undo or
  // concurrent edit, even if the incoming document has the same revision.
  const currentFence=serializeProject(document);
  if(displayedDocumentFence!==currentFence)
    throw Error('Historical choice is stale: inspect the current journal again.');
  if(!document.journal.some(event=>event.eventId===row.targetEventId&&event.type==='feature.edit'))
    throw Error('Historical event is no longer in the authoritative journal.');
  const choice=row.fieldChoices.find(item=>item.field===field);
  if(!choice||choice.status==='blocked'||choice.admission===null)
    throw Error('Selected historical field cannot be compensated by INTENT.');
  if(choice.status!=='available'&&!explicitConsent)
    throw Error('Explicit consent is required for unresolved historical compensation.');
  return commitUndoableFeatureEditFieldRevert(history,{
    format:FEATURE_EDIT_FIELD_REVERT_FORMAT,version:1,
    expectedProjectId:document.projectId,expectedRevision:document.revision,
    expectedDocumentFence:currentFence,
    targetEventId:row.targetEventId,
    eventId:'workbench.history.compensate.'+document.revision+'.'+row.sourceRevision,
    selectedFields:[field],
    admission:choice.admission,
    confirmUnresolved:choice.confirmUnresolved&&explicitConsent,
  });
}
