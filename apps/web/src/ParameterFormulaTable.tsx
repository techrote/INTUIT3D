import {useEffect,useMemo,useState} from 'react';
import {
  commitModelParameterFormulaTable, commitResolvedModelParameterFormulaRecovery,
  inspectModelParameterFormulaRecovery, modelParameterFormulaRows,
  previewModelParameterFormulaTable, resolveModelParameterFormulaRecovery,
  type ModelParameterFormulaDraft,type ModelSession,
} from './runtimeSession';
import type {ParameterSheetResolutionResult}
  from '@intuit3d/model/parameter-sheet-resolution';

export interface ParameterFormulaTableProps {
  history:ModelSession;
  disabled:boolean;
  onCommit:(next:ModelSession)=>void;
  onMessage:(message:string)=>void;
}
interface Editor {
  readonly base:ModelSession;
  readonly rows:readonly ModelParameterFormulaDraft[];
}
type ConflictReport=ReturnType<typeof inspectModelParameterFormulaRecovery>;
interface Review {
  readonly kind:'normal'|'recovered';
  readonly targetRevision:number;
  readonly changed:number;
  readonly invalidated:readonly string[];
  readonly unchanged:readonly string[];
  readonly recovery?:ParameterSheetResolutionResult;
}
const draftOf=(h:ModelSession):Editor=>({
  base:h,rows:modelParameterFormulaRows(h).map(({featureId,name,formula})=>({
    featureId,name,formula,
  })),
});
const canApprove=(code:string)=>
  code==='edited_row_changed'||code==='referenced_parameter_changed'||
  code==='event_id_taken';

/**
 * The authored BASE and unsaved draft survive other accepted edits. INTENT
 * checks exact journal ancestry and offers explicit, per-conflict recovery;
 * neither a stale formula nor a new dependency is silently overwritten.
 * Browser state is an editable view, never the model's source of truth.
 */
export function ParameterFormulaTable({
  history,disabled,onCommit,onMessage,
}:ParameterFormulaTableProps) {
  const source=useMemo(()=>modelParameterFormulaRows(history),[history]);
  const [editor,setEditor]=useState<Editor>(()=>draftOf(history));
  const baseline=useMemo(()=>modelParameterFormulaRows(editor.base),[editor.base]);
  const [review,setReview]=useState<Review|null>(null);
  const [offered,setOffered]=useState<ConflictReport|null>(null);
  const [approved,setApproved]=useState<readonly number[]>([]);
  const [replacements,setReplacements]=useState<Readonly<Record<string,string>>>({});

  const dirty=editor.rows.filter(row=>{
    const old=baseline.find(item=>item.featureId===row.featureId);
    return old&&(old.name!==row.name||old.formula!==row.formula);
  });
  const stale=editor.base.document.projectId!==history.document.projectId||
    editor.base.document.revision!==history.document.revision;
  const ready=dirty.length>0&&!disabled;
  const previewCurrent=!!review&&review.targetRevision===history.document.revision&&
    (stale?review.kind==='recovered':review.kind==='normal');

  // Never erase unsaved edits merely because a direct grip, another inspector,
  // undo, or a native operation advanced the authoritative journal. Switching
  // to a DIFFERENT project intentionally releases its old local draft.
  useEffect(()=>{
    setEditor(previous=>{
      if(previous.base.document.projectId!==history.document.projectId)
        return draftOf(history);
      const original=modelParameterFormulaRows(previous.base);
      const edited=previous.rows.some(row=>{
        const old=original.find(item=>item.featureId===row.featureId);
        return old&&(old.name!==row.name||old.formula!==row.formula);
      });
      return edited?previous:draftOf(history);
    });
    setReview(null);setOffered(null);setApproved([]);setReplacements({});
  },[history]);

  const update=(id:string,key:'name'|'formula',value:string)=>{
    setEditor(previous=>({...previous,rows:previous.rows.map(row=>
      row.featureId===id?{...row,[key]:value}:row)}));
    setReview(null);setOffered(null);setApproved([]);setReplacements({});
  };
  const discard=()=>{
    setEditor(draftOf(history));
    setReview(null);setOffered(null);setApproved([]);setReplacements({});
  };
  const asReview=(result:ParameterSheetResolutionResult):Review=>{
    if(result.status!=='ready'||!result.preview||!result.resolvedRequest)
      throw Error('Recovery is not yet accepted by INTENT.');
    return {
      kind:'recovered',targetRevision:history.document.revision,
      changed:result.preview.events.length,
      invalidated:result.preview.invalidation.invalidatedFeatureIds,
      unchanged:result.preview.invalidation.unchangedReady,
      recovery:result,
    };
  };
  const inspect=()=>{
    if(!ready)return;
    setReview(null);setOffered(null);setApproved([]);setReplacements({});
    try {
      if(!stale){
        const stage=previewModelParameterFormulaTable(history,editor.rows,
          history.document.revision);
        setReview({
          kind:'normal',targetRevision:history.document.revision,
          changed:stage.events.length,
          invalidated:stage.invalidation.invalidatedFeatureIds,
          unchanged:stage.invalidation.unchangedReady,
        });
        onMessage('Parameter sheet preview: '+stage.events.length+
          ' edit(s), '+stage.invalidation.invalidatedFeatureIds.length+
          ' invalidated feature(s). No model change committed.');
      }else{
        const report=inspectModelParameterFormulaRecovery(
          editor.base,history,editor.rows);
        setOffered(report);
        if(report.status==='ready'){
          const recovered=resolveModelParameterFormulaRecovery(
            editor.base,history,editor.rows,[],[]);
          setReview(asReview(recovered));
          onMessage('Non-conflicting draft safely reviewed against current revision. Examine scalar values before commit.');
        }else{
          onMessage('Parameter sheet remains uncommitted: '+report.conflicts.length+
            ' exact conflict(s). Each overridable conflict needs explicit review.');
        }
      }
    }catch(e){
      onMessage('Parameter sheet preview refused: '+(e instanceof Error?e.message:String(e)));
    }
  };
  const resolve=()=>{
    if(!offered||!stale||!ready)return;
    setReview(null);
    try {
      const approvals=offered.conflicts.filter((item,i)=>
        canApprove(item.code)&&approved.includes(i)).map(item=>({
          code:item.code,featureId:item.featureId,relatedId:item.relatedId,
        }));
      const eventReplacements=offered.conflicts.filter(item=>
        item.code==='event_id_taken'&&item.featureId!==null).map(item=>({
          featureId:item.featureId!,eventId:replacements[item.featureId!]??'',
        }));
      const result=resolveModelParameterFormulaRecovery(editor.base,history,
        editor.rows,approvals,eventReplacements);
      if(result.status==='ready'){
        setReview(asReview(result));
        onMessage('Conflicts reviewed by INTENT. Check old/current scalar values and commit explicitly; no changes applied yet.');
      }else{
        onMessage('Resolution refused: '+result.conflicts.map(item=>item.detail).join('; '));
      }
    }catch(e){
      onMessage('Resolution refused: '+(e instanceof Error?e.message:String(e)));
    }
  };
  const commit=()=>{
    if(!ready||!previewCurrent||!review)return;
    try{
      const next=review.kind==='normal'
        ?commitModelParameterFormulaTable(history,editor.rows,
          history.document.revision)
        :commitResolvedModelParameterFormulaRecovery(history,review.recovery!);
      // A resulting revision is a new BASE, not an automatically stale draft.
      setEditor(draftOf(next));setReview(null);setOffered(null);
      setApproved([]);setReplacements({});
      onCommit(next);
      onMessage('Parameter table committed '+review.changed+
        ' edit(s) in ONE undo frame; revision '+next.document.revision+
        '. Invalidated '+(review.invalidated.join(', ')||'none')+
        '. Native STEP requires a source-matched rebuild.');
    }catch(e){
      setReview(null);
      onMessage('Parameter sheet commit refused: '+(e instanceof Error?e.message:String(e)));
    }
  };
  return <section className="runtime-formula-sheet" data-testid="runtime-formula-sheet"
      aria-label="Model-owned parameter spreadsheet">
    <div className="section-head">PARAMETER FORMULA TABLE · INTENT</div>
    <p className="microcopy">Edit several formulas or names together. An unsaved draft survives other model edits; a changed revision requires a new INTENT review. Recovery never silently overwrites semantic references. One accepted commit is one undo frame.</p>
    {stale&&dirty.length>0&&<p className="microcopy" role="status"
        data-testid="runtime-formula-stale">
      Draft from revision {editor.base.document.revision}; current model revision {history.document.revision}. No changes applied. Preview against the current model or discard the draft.
    </p>}
    {!editor.rows.length?<p className="microcopy">No authored parameters in this project.</p>:
      <div className="runtime-formula-rows">
        {editor.rows.map((row,i)=>{
          const original=baseline.find(x=>x.featureId===row.featureId);
          const current=source.find(x=>x.featureId===row.featureId);
          return <div className="runtime-formula-row" key={row.featureId}
              data-testid={'runtime-formula-row-'+i}>
            <small title={row.featureId}>{row.featureId} · {original?.unit}</small>
            <label><span>Name</span>
              <input data-testid={'runtime-formula-name-'+i}
                aria-label={'Parameter '+row.featureId+' name'}
                type="text" autoComplete="off" spellCheck={false}
                value={row.name} disabled={disabled}
                onChange={e=>update(row.featureId,'name',e.target.value)}/></label>
            <label><span>Formula</span>
              <input data-testid={'runtime-formula-expression-'+i}
                aria-label={'Parameter '+row.featureId+' formula'}
                type="text" autoComplete="off" spellCheck={false}
                value={row.formula} disabled={disabled}
                onChange={e=>update(row.featureId,'formula',e.target.value)}/></label>
            <span className="runtime-formula-value" data-testid={'runtime-formula-value-'+i}>
              {original?.value===null?'Unresolved':String(original?.value)+' '+original?.unit}
              <small>{stale?'Base: '+original?.status+'; current: '+(current?.value??'unresolved'):
                original?.status}</small>
            </span>
            {!!original?.diagnostics.length&&<p className="microcopy" role="status">
              {original.diagnostics.join('; ')}</p>}
          </div>;
        })}
      </div>}
    <div className="runtime-formula-actions">
      <button type="button" className="ribbon-button"
        data-testid="runtime-formula-preview" disabled={!ready}
        onClick={inspect}>{stale?'Review draft against current model':'Preview parameter edits'}</button>
      <button type="button" className="ribbon-button runtime-native-export"
        data-testid="runtime-formula-commit"
        disabled={!ready||!previewCurrent}
        onClick={commit}>Commit parameter table</button>
      {dirty.length>0&&<button type="button" className="ribbon-button"
        data-testid="runtime-formula-reset" disabled={disabled}
        onClick={discard}>Discard drafts</button>}
    </div>
    {stale&&offered?.status==='conflicted'&&<div className="runtime-formula-impact"
        data-testid="runtime-formula-conflicts">
      <strong>Conflicts from revision {offered.baseRevision} to {offered.currentRevision}</strong>
      <p>Review the exact authored model changes. Only checked, overridable conflicts may be acknowledged. Unresolvable semantic rebinding requires editing the draft.</p>
      {offered.conflicts.map((item,i)=><div key={i}>
        <label>
          {canApprove(item.code)&&<input type="checkbox"
            data-testid={'runtime-formula-approve-'+i} checked={approved.includes(i)}
            onChange={e=>setApproved(previous=>e.target.checked?[...previous,i]:
              previous.filter(index=>index!==i))}/>}
          <span>{item.code} · {item.featureId??'model'} · {item.relatedId??'—'}: {item.detail}</span>
        </label>
        {item.code==='event_id_taken'&&item.featureId&&<label>
          New unused event ID for {item.featureId} (explicit, not generated)
          <input type="text" autoComplete="off" spellCheck={false}
            data-testid={'runtime-formula-replacement-'+i}
            value={replacements[item.featureId]??''}
            onChange={e=>setReplacements(prev=>({...prev,[item.featureId!]:e.target.value}))}/>
        </label>}
      </div>)}
      <button type="button" className="ribbon-button runtime-native-export"
        data-testid="runtime-formula-resolve" disabled={!ready}
        onClick={resolve}>Review selected conflict approvals</button>
    </div>}
    {previewCurrent&&review&&<div className="runtime-formula-impact"
        data-testid="runtime-formula-impact">
      <strong>Model preview · revision {review.targetRevision} · {review.changed} edit(s)</strong>
      <p>Rebuild: {review.invalidated.join(', ')||'no dependent features'}.</p>
      <p>Unaffected: {review.unchanged.join(', ')||'none'}.</p>
      {review.recovery&&<div data-testid="runtime-formula-value-comparison">
        <strong>Explicit source-vs-current scalar review</strong>
        {review.recovery.valueComparisons.map(row=><p key={row.featureId}>
          {row.featureId}: original draft {row.baseDraftValue??'unresolved'} {row.baseDraftUnit??''}
          {' → '}current-model draft {row.currentDraftValue??'unresolved'} {row.currentDraftUnit??''}
        </p>)}
        <small>Conflicts acknowledged: {review.recovery.acknowledgedConflicts.length}. The final commit is separate and fenced to the current revision.</small>
      </div>}
      <small>Semantic dependency analysis only. No C++/STEP calculation was run.</small>
    </div>}
  </section>;
}
