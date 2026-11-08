import {useMemo,useState} from 'react';
import type {FeaturePatch} from '@intuit3d/model';
import type {HistoricalEditChoice} from '@intuit3d/model/historical-edit-inventory';
import type {ModelSession} from './runtimeSession.ts';
import {
  compensateWorkbenchHistoricalField,inspectWorkbenchHistoricalEdits,
  previewWorkbenchHistoricalBatch,commitWorkbenchHistoricalBatch,
  type BatchHistoricalFieldSelection,
} from './historicalEditBridge.ts';

type Reviewed={eventId:string;field:keyof FeaturePatch;fence:string;revision:number};

function readable(value:unknown):string {
  const json=JSON.stringify(value);
  const source=json===undefined?String(value):json;
  return source.length>260?source.slice(0,260)+'… (truncated display only)':source;
}

/** A read-only-on-open INTENT history inspector. The selected event and field
 * are explicitly reviewed before one source-fenced compensating transaction.
 * No model snapshots, native receipts or derived geometry live in UI state. */
export function HistoricalEditInspector({history,disabled,onCommit,onMessage}:{
  history:ModelSession;disabled:boolean;
  onCommit:(next:ModelSession,source:ModelSession)=>boolean;
  onMessage:(message:string)=>void;
}) {
  const [expanded,setExpanded]=useState(false);
  const [cursor,setCursor]=useState<number|null>(null);
  const [review,setReview]=useState<Reviewed|null>(null);
  const [consent,setConsent]=useState(false);
  const [batch,setBatch]=useState<BatchHistoricalFieldSelection[]>([]);
  const [batchReview,setBatchReview]=useState<
    ReturnType<typeof previewWorkbenchHistoricalBatch>|null>(null);
  const [batchFence,setBatchFence]=useState<string|null>(null);
  const [batchConsent,setBatchConsent]=useState(false);
  // Heavy historical replay is NEVER part of ordinary file selection or model
  // hydration: only an explicit user click starts bounded four-row inspection.
  const inspection=useMemo(()=>{
    if(!expanded)return {inventory:null,error:null};
    try{return {inventory:inspectWorkbenchHistoricalEdits(history,cursor,4),error:null};}
    catch(error){return {inventory:null,error:String(error)};}
  },[expanded,history,cursor]);
  const inventory=inspection.inventory;
  const row:HistoricalEditChoice|undefined=inventory?.rows.find(
    item=>item.targetEventId===review?.eventId);
  const fieldChoice=row?.fieldChoices.find(choice=>choice.field===review?.field);
  const transition=row?.fieldTransitions.find(item=>item.field===review?.field);
  const currentReview=!!(review&&inventory&&
    inventory.documentFence===review.fence&&inventory.revision===review.revision&&fieldChoice);
  const requiresConsent=!!(fieldChoice&&fieldChoice.status!=='available');
  const commit=()=>{
    if(!currentReview||!row||!review||!fieldChoice)return;
    try {
      const next=compensateWorkbenchHistoricalField(history,row,review.field,
        review.fence,requiresConsent?consent:false);
      if(!onCommit(next,history)) {
        onMessage('Historical compensation refused: journal changed while reviewing. Inspect again.');
        return;
      }
      setReview(null);setConsent(false);setExpanded(false);setCursor(null);
      onMessage('Reverted '+review.field+' of '+row.featureId+' from event '+row.targetEventId+
        ' in one undoable INTENT transaction. Revision '+next.document.revision+
        '; old native STEP revoked. Rebuild physical evidence before export.');
    }catch(error) {
      onMessage('Historical compensation refused; journal unchanged: '+String(error));
    }
  };
  const queueBatch=(entry:HistoricalEditChoice,field:keyof FeaturePatch)=>{
    if(!inventory)return;
    const selected=batch.some(item=>item.row.targetEventId===entry.targetEventId&&
      item.field===field);
    if(selected){
      setBatch(items=>items.filter(item=>item.row.targetEventId!==entry.targetEventId||
        item.field!==field));
    }else {
      if(batch.some(item=>item.row.featureId===entry.featureId)){
        onMessage('Batch queue refused: choose only one historical edit per semantic feature.');
        return;
      }
      if(batch.length>=8){onMessage('Batch queue limited to eight distinct features.');return;}
      setBatch(items=>[...items,{row:entry,field,sourceFence:inventory.documentFence}]);
    }
    setBatchReview(null);setBatchFence(null);setBatchConsent(false);
  };
  const reviewBatch=()=>{
    if(!inventory)return;
    try{
      const result=previewWorkbenchHistoricalBatch(history,batch,inventory.documentFence);
      setBatchReview(result);setBatchFence(inventory.documentFence);setBatchConsent(false);
    }catch(error){
      setBatchReview(null);setBatchFence(null);
      onMessage('Atomic history review refused; journal unchanged: '+String(error));
    }
  };
  const commitBatch=()=>{
    if(!batchReview||!batchFence)return;
    try {
      const next=commitWorkbenchHistoricalBatch(history,batch,batchFence,batchConsent);
      if(!onCommit(next,history)){
        onMessage('Atomic history batch refused: journal changed while reviewing. Inspect again.');
        return;
      }
      const affected=batchReview.preview.invalidatedBodyIds;
      setBatch([]);setBatchReview(null);setBatchFence(null);
      setBatchConsent(false);setReview(null);setExpanded(false);setCursor(null);
      onMessage('Compensated '+batch.length+' distinct historical features in ONE undo frame at revision '+
        next.document.revision+'. Invalidated bodies: '+(affected.join(', ')||'none')+
        '. All prior native STEP evidence revoked; rebuild before export.');
    }catch(error){
      onMessage('Atomic history batch refused; journal unchanged: '+String(error));
    }
  };
  const currentBatchReview=!!(batchReview&&batchFence&&inventory&&
    batchFence===inventory.documentFence);
  return <section className="inspector-section" data-testid="runtime-historical-edit-inspector">
    <div className="section-head">HISTORICAL EDITS · AUTHORITATIVE JOURNAL</div>
    <p className="microcopy">Inspect an earlier edit without undoing later unrelated authoring.
      Before / authored / current values are INTENT data, not solved or exact geometry.
      Compensations append a new journal event and invalidate cached STEP.</p>
    <button type="button" className="ribbon-button" data-testid="runtime-history-open"
      disabled={disabled} aria-expanded={expanded}
      onClick={()=>{
        setExpanded(old=>!old);setCursor(null);setReview(null);setConsent(false);
        setBatch([]);setBatchReview(null);setBatchFence(null);setBatchConsent(false);
      }}>{expanded?'Close historical edits':'Inspect historical edits'}</button>
    {expanded&&<div className="runtime-hole-add" data-testid="runtime-history-rows">
      {inspection.error&&<p role="alert">History inspection refused: {inspection.error}</p>}
      {inventory&&inventory.rows.length===0&&<p className="microcopy">
        No compensable feature.edit event on this journal page.</p>}
      {inventory?.rows.map(entry=><div key={entry.targetEventId} className="runtime-hole-add"
          data-testid="runtime-history-row">
        <strong>{entry.featureId} · r{entry.sourceRevision}</strong>
        <small>{entry.targetEventId} · {entry.status}</small>
        {entry.reason&&<p className="microcopy">{entry.reason}</p>}
        {entry.fieldChoices.map(choice=>{
          const change=entry.fieldTransitions.find(item=>item.field===choice.field);
          return <div key={choice.field} className="runtime-hole-add">
            <strong>{choice.field} · {choice.status}</strong>
            {change&&<div className="microcopy">
              <div>Before: <code>{readable(change.before)}</code></div>
              <div>Authored: <code>{readable(change.authored)}</code></div>
              <div>Current: <code>{readable(change.current)}</code></div>
              {change.laterEdited&&<small>Later edit to this field recorded</small>}
              {change.laterLifecycleChange&&<small>Later feature lifecycle change recorded</small>}
            </div>}
            {choice.reason&&<p className="microcopy">{choice.reason}</p>}
            <button type="button" className="ribbon-button"
              data-testid="runtime-history-review"
              data-history-event={entry.targetEventId}
              data-history-field={choice.field}
              disabled={disabled||choice.status==='blocked'}
              onClick={()=>{
                setReview({eventId:entry.targetEventId,field:choice.field,
                  fence:inventory.documentFence,revision:inventory.revision});
                setConsent(false);
              }}>Review field compensation</button>
            <button type="button" className="ribbon-button"
              data-testid="runtime-history-batch-queue"
              data-history-event={entry.targetEventId}
              data-history-field={choice.field}
              aria-pressed={batch.some(item=>item.row.targetEventId===entry.targetEventId&&
                item.field===choice.field)}
              disabled={disabled||choice.status==='blocked'||
                (batch.length>=8&&!batch.some(item=>item.row.targetEventId===entry.targetEventId&&
                  item.field===choice.field))}
              onClick={()=>queueBatch(entry,choice.field)}>
              {batch.some(item=>item.row.targetEventId===entry.targetEventId&&
                item.field===choice.field)?'Remove from atomic batch':'Queue for atomic batch'}
            </button>
          </div>;
        })}
      </div>)}
      {inventory?.nextCursor!==null&&inventory?.nextCursor!==undefined&&
        <button type="button" className="ribbon-button" data-testid="runtime-history-older"
          onClick={()=>{
            setCursor(inventory.nextCursor);setReview(null);setConsent(false);
          }}>Older historical edits…</button>}
      <div className="runtime-hole-add" data-testid="runtime-history-batch-panel">
        <strong>ATOMIC MULTI-FEATURE COMPENSATION · {batch.length}/8 selected</strong>
        <p className="microcopy">Select one reviewed field from each of 2–8 distinct semantic
          features, even across history pages. MODEL preflights the combined dependency
          frontier before one persisted undo frame. Multiple inverse journal events advance
          the revision by their count; this is not exact geometry.</p>
        {batch.map(item=><div key={item.row.featureId} className="microcopy">
          {item.row.featureId} / {item.field} · {item.row.targetEventId}
          <button className="ribbon-button" type="button"
            data-testid="runtime-history-batch-remove"
            onClick={()=>queueBatch(item.row,item.field)}>Remove</button>
        </div>)}
        <button className="ribbon-button" type="button"
          data-testid="runtime-history-batch-review"
          disabled={disabled||batch.length<2}
          onClick={reviewBatch}>Review combined compensation</button>
        {batch.length>0&&<button className="ribbon-button" type="button"
          data-testid="runtime-history-batch-clear"
          onClick={()=>{setBatch([]);setBatchReview(null);setBatchFence(null);
            setBatchConsent(false);}}>Clear batch</button>}
        {currentBatchReview&&batchReview&&<div className="runtime-lifecycle-confirm"
          role="group" aria-label="Confirm atomic historical batch"
          data-testid="runtime-history-batch-confirmation">
          <strong>Combined MODEL preflight · {batchReview.preview.selections.length} features</strong>
          <p className="microcopy">Invalidated bodies:
            {' '}{batchReview.preview.invalidatedBodyIds.join(', ')||'none'}.
            {' '}Regressed ready features:
            {' '}{batchReview.preview.regressedReadyFeatureIds.join(', ')||'none'}.
            {' '}Unchanged ready features:
            {' '}{batchReview.preview.unaffectedReadyFeatureIds.join(', ')||'none'}.
            All native physical results become stale until rebuilt and independently checked.</p>
          {batchReview.requiresConsent&&<label>
            <input type="checkbox" data-testid="runtime-history-batch-consent"
              checked={batchConsent} onChange={event=>setBatchConsent(event.target.checked)}/>
            I explicitly accept the combined unresolved/ready-regression outcome.
          </label>}
          <button className="ribbon-button" type="button"
            data-testid="runtime-history-batch-apply"
            disabled={disabled||(batchReview.requiresConsent&&!batchConsent)}
            onClick={commitBatch}>Commit atomic historical batch</button>
          <button className="ribbon-button" type="button"
            onClick={()=>{setBatchReview(null);setBatchFence(null);
              setBatchConsent(false);}}>Cancel combined review</button>
        </div>}
      </div>
      {currentReview&&row&&fieldChoice&&transition&&<div className="runtime-lifecycle-confirm"
          role="group" aria-label="Confirm historical field compensation"
          data-testid="runtime-history-confirmation">
        <strong>Review {row.featureId} / {review?.field} · event {row.targetEventId}</strong>
        <p className="microcopy">Restore the previous authored value {readable(transition.before)}
          {' '}in one new undoable model revision. This does not rewind unrelated later events.
          INTENT admission: {fieldChoice.status}.</p>
        <p className="microcopy">Invalidate bodies: {fieldChoice.invalidatedBodyIds.join(', ')||'none'};
          {' '}regressed ready features: {fieldChoice.regressedReadyFeatureIds.join(', ')||'none'}.
          Preview pending/unsupported until its real geometry provider succeeds.</p>
        {requiresConsent&&<label>
          <input type="checkbox" data-testid="runtime-history-consent"
            checked={consent} onChange={event=>setConsent(event.target.checked)}/>
          I accept this model-owned unresolved/ready-regression outcome.
        </label>}
        <button type="button" className="ribbon-button"
          data-testid="runtime-history-apply"
          disabled={disabled||fieldChoice.status==='blocked'||(requiresConsent&&!consent)}
          onClick={commit}>Commit reviewed historical compensation</button>
        <button type="button" className="ribbon-button"
          data-testid="runtime-history-cancel"
          onClick={()=>{setReview(null);setConsent(false);}}>Cancel review</button>
      </div>}
    </div>}
  </section>;
}
