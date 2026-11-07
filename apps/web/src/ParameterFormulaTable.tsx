import {useEffect,useMemo,useState} from 'react';
import {
  commitModelParameterFormulaTable, modelParameterFormulaRows,
  previewModelParameterFormulaTable,
  type ModelParameterFormulaDraft,type ModelSession,
} from './runtimeSession';

export interface ParameterFormulaTableProps {
  history:ModelSession;
  disabled:boolean;
  onCommit:(next:ModelSession)=>void;
  onMessage:(message:string)=>void;
}

/**
 * Spreadsheet editing is draft-only until INTENT accepts the whole FINAL table.
 * Display labels are not feature IDs. The browser never interprets a formula,
 * changes dependency edges, or declares derived geometry exact.
 */
export function ParameterFormulaTable({
  history,disabled,onCommit,onMessage,
}:ParameterFormulaTableProps) {
  const source=useMemo(()=>modelParameterFormulaRows(history),[history]);
  const [origin,setOrigin]=useState(history.document.revision);
  const [drafts,setDrafts]=useState<readonly ModelParameterFormulaDraft[]>(source);
  const [preview,setPreview]=useState<{
    revision:number;invalidated:readonly string[];
    unchanged:readonly string[];changed:readonly string[];
  }|null>(null);
  useEffect(()=>{
    setOrigin(history.document.revision);
    setDrafts(source.map(({featureId,name,formula})=>({featureId,name,formula})));
    setPreview(null);
  },[source,history.document.revision]);
  const dirty=useMemo(()=>drafts.filter(d=>{
    const old=source.find(x=>x.featureId===d.featureId);
    return old&&(old.name!==d.name||old.formula!==d.formula);
  }),[drafts,source]);
  const stale=origin!==history.document.revision;
  const ready=dirty.length>0&&!stale&&!disabled;
  const update=(id:string,key:'name'|'formula',value:string)=>{
    setDrafts(rows=>rows.map(r=>r.featureId===id?{...r,[key]:value}:r));
    setPreview(null);
  };
  const inspect=()=>{
    try {
      const staged=previewModelParameterFormulaTable(history,drafts,origin);
      setPreview({
        revision:origin,changed:staged.events.map(e=>e.eventId),
        invalidated:staged.invalidation.invalidatedFeatureIds,
        unchanged:staged.invalidation.unchangedReady,
      });
      onMessage(`Parameter sheet preview: ${staged.events.length} authored edit(s), ${staged.invalidation.invalidatedFeatureIds.length} invalidated feature(s). No model change committed.`);
    } catch(e) {
      setPreview(null);
      onMessage('Parameter sheet refused: '+(e instanceof Error?e.message:String(e)));
    }
  };
  const commit=()=>{
    if(!preview||preview.revision!==origin||!ready)return;
    try {
      // Re-preview immediately before commit; a stale revision or changed
      // dependency is refused, leaving the original history untouched.
      const prior=history;
      const next=commitModelParameterFormulaTable(prior,drafts,origin);
      onCommit(next);
      onMessage(`Parameter sheet committed ${preview.changed.length} edit(s) in ONE undo frame; revision ${next.document.revision}. Invalidate ${preview.invalidated.join(', ')||'none'}. Native STEP must rebuild.`);
    }catch(e){
      setPreview(null);
      onMessage('Parameter sheet commit refused: '+(e instanceof Error?e.message:String(e)));
    }
  };
  return <section className="runtime-formula-sheet" data-testid="runtime-formula-sheet"
      aria-label="Model-owned parameter spreadsheet">
    <div className="section-head">PARAMETER FORMULA TABLE · INTENT</div>
    <p className="microcopy">Change one or several named parameter formulas together, including simultaneous renames. Preview validates final dependencies and units. One commit creates one undo frame; no preview or STEP is exact geometry.</p>
    {!source.length?<p className="microcopy">No authored parameters in this project.</p>:
      <div className="runtime-formula-rows">
        {drafts.map((row,i)=>{
          const original=source.find(x=>x.featureId===row.featureId);
          return <div className="runtime-formula-row" key={row.featureId}
              data-testid={`runtime-formula-row-${i}`}>
            <small title={row.featureId}>{row.featureId} · {original?.unit}</small>
            <label><span>Name</span>
              <input data-testid={`runtime-formula-name-${i}`}
                aria-label={`Parameter ${row.featureId} name`}
                type="text" autoComplete="off" spellCheck={false}
                value={row.name} disabled={disabled}
                onChange={e=>update(row.featureId,'name',e.target.value)}/></label>
            <label><span>Formula</span>
              <input data-testid={`runtime-formula-expression-${i}`}
                aria-label={`Parameter ${row.featureId} formula`}
                type="text" autoComplete="off" spellCheck={false}
                value={row.formula} disabled={disabled}
                onChange={e=>update(row.featureId,'formula',e.target.value)}/></label>
            <span className="runtime-formula-value" data-testid={`runtime-formula-value-${i}`}>
              {original?.value===null?'Unresolved':`${original?.value} ${original?.unit}`}
              <small>{original?.status}</small>
            </span>
            {!!original?.diagnostics.length&&<p className="microcopy" role="status">
              {original.diagnostics.join('; ')}</p>}
          </div>;
        })}
      </div>}
    <div className="runtime-formula-actions">
      <button type="button" className="ribbon-button"
        data-testid="runtime-formula-preview" disabled={!ready}
        onClick={inspect}>Preview parameter edits</button>
      <button type="button" className="ribbon-button runtime-native-export"
        data-testid="runtime-formula-commit"
        disabled={!ready||!preview||preview.revision!==origin}
        onClick={commit}>Commit parameter table</button>
      {dirty.length>0&&<button type="button" className="ribbon-button"
        data-testid="runtime-formula-reset" disabled={disabled}
        onClick={()=>{
          setDrafts(source.map(({featureId,name,formula})=>({featureId,name,formula})));
          setPreview(null);
        }}>Discard drafts</button>}
    </div>
    {preview&&<div className="runtime-formula-impact" data-testid="runtime-formula-impact">
      <strong>Model preview · revision {preview.revision} · {preview.changed.length} edit(s)</strong>
      <p>Rebuild: {preview.invalidated.join(', ')||'no dependent features'}.</p>
      <p>Unaffected: {preview.unchanged.join(', ')||'none'}.</p>
      <small>Semantic dependency analysis only. No C++/STEP calculation was run.</small>
    </div>}
  </section>;
}
