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

/**
 * Source-fenced multi-feature historical compensation. The selection must
 * contain 2–8 distinct semantic features, even across history pages. Preview
 * and commit both use MODEL's combined transaction/admission engine; UI state
 * never creates a replacement document or a second history authority.
 */
import {
  FEATURE_HISTORY_BATCH_FORMAT, previewFeatureHistoryBatch,
  commitUndoableFeatureHistoryBatch,
} from '@intuit3d/model/feature-history-batch';
import type { FeatureHistoryBatchRequest } from '@intuit3d/model/feature-history-batch';

export type BatchHistoricalFieldSelection = Readonly<{
  row: HistoricalEditChoice;
  field: keyof FeaturePatch;
  sourceFence: string;
}>;

function historicalBatchRequest(
  history:ModelSession,selected:readonly BatchHistoricalFieldSelection[],
  displayedDocumentFence:string,
):FeatureHistoryBatchRequest {
  const document=history.document;
  const actualFence=serializeProject(document);
  if(actualFence!==displayedDocumentFence ||
      selected.some(item=>item.sourceFence!==actualFence))
    throw Error('Historical batch is stale: inspect the current journal again.');
  if(selected.length<2||selected.length>8)
    throw Error('Select 2–8 distinct historical features for one batch.');
  if(new Set(selected.map(item=>item.row.featureId)).size!==selected.length)
    throw Error('Select only one historical field per feature in a batch.');
  for(const {row,field} of selected){
    const event=document.journal.find(item=>item.eventId===row.targetEventId);
    if(event?.type!=='feature.edit'||event.featureId!==row.featureId)
      throw Error('Historical batch source event no longer matches its feature.');
    const choice=row.fieldChoices.find(item=>item.field===field);
    if(!choice||choice.status==='blocked'||choice.admission===null)
      throw Error('Historical batch field was not admitted for review.');
  }
  return {
    format:FEATURE_HISTORY_BATCH_FORMAT,version:1,
    expectedProjectId:document.projectId,expectedRevision:document.revision,
    expectedDocumentFence:actualFence,
    admission:'permit_unresolved',confirmUnresolved:true,
    selections:selected.map(({row,field},i)=>({
      kind:'fields' as const,targetEventId:row.targetEventId,
      eventId:'workbench.history.batch.'+document.revision+'.'+i,
      selectedFields:[field],
    })),
  };
}

export function previewWorkbenchHistoricalBatch(
  history:ModelSession,selected:readonly BatchHistoricalFieldSelection[],
  displayedDocumentFence:string,
) {
  const request=historicalBatchRequest(history,selected,displayedDocumentFence);
  const preview=previewFeatureHistoryBatch(history.document,request);
  const status=new Map(preview.plan.features.map(item=>[item.feature.id,item.status]));
  const requiresConsent=preview.regressedReadyFeatureIds.length>0||
    preview.selections.some(item=>status.get(item.featureId)!=='ready');
  return {preview,requiresConsent};
}

export function commitWorkbenchHistoricalBatch(
  history:ModelSession,selected:readonly BatchHistoricalFieldSelection[],
  displayedDocumentFence:string,explicitConsent:boolean,
):ModelSession {
  const {requiresConsent}=previewWorkbenchHistoricalBatch(
    history,selected,displayedDocumentFence);
  if(requiresConsent&&!explicitConsent)
    throw Error('Explicit consent required for unresolved batch compensation.');
  const request=historicalBatchRequest(history,selected,displayedDocumentFence);
  return commitUndoableFeatureHistoryBatch(history,{
    ...request,
    admission:requiresConsent?'permit_unresolved':'require_ready',
    confirmUnresolved:requiresConsent&&explicitConsent,
  });
}
