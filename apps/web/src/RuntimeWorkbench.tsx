import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  editModelDimension, inspectModelSession, modelDiagnostics, modelDimensionValues,
  MODEL_DIMENSIONS, newModelPlateSession, previewModelProfile, redoModelSession,
  reopenModelSession, runtime, serializeModelSession, undoModelSession,
  type ModelDimension, type ModelSession,
} from './runtimeSession';
import { RuntimeGeometryViewport } from './RuntimeGeometryViewport';

const LABEL: Record<ModelDimension,string> = {
  width:'Plate width', depth:'Plate depth', holeDiameter:'Hole diameter',
  holePitch:'Hole pitch', thickness:'Extrude thickness',
};

function ScalarInput({ field, value, onCommit }: {
  field: ModelDimension; value:number; onCommit:(field:ModelDimension,n:number)=>void;
}) {
  const [text,setText]=useState(String(value));
  // Escape causes blur before React commits setText: fence it synchronously.
  const cancelledBlur = useRef(false);
  return <label className="runtime-scalar">
    <span>{LABEL[field]}</span>
    <span className="runtime-scalar-control">
      <input data-testid={`runtime-dimension-${field}`} aria-label={LABEL[field]}
        type="number" min="0" step="any" value={text}
        onChange={e=>setText(e.target.value)}
        onKeyDown={e=>{
          if(e.key==='Enter')e.currentTarget.blur();
          if(e.key==='Escape'){cancelledBlur.current=true;setText(String(value));e.currentTarget.blur();}
        }}
        onBlur={()=>{if(cancelledBlur.current){cancelledBlur.current=false;return;}const next=Number(text);if(text.trim()!=='' && Number.isFinite(next) && next>0){
          if(!Object.is(next,value))onCommit(field,next);
        }else setText(String(value));}}/>
      <small>mm</small>
    </span>
  </label>;
}

export function RuntimeWorkbench({ onClose }: { onClose:()=>void }) {
  const [history,setHistory]=useState<ModelSession>(()=>newModelPlateSession());
  const [sketchMode,setSketchMode]=useState(false);
  const [selected,setSelected]=useState('plate');
  const [timeline,setTimeline]=useState<'authored'|'evaluated'>('authored');
  const [message,setMessage]=useState<string|null>(null);
  const [pendingImport,setPendingImport]=useState<{file:string;history:ModelSession}|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const loadTicket=useRef(0);
  const report=useMemo(()=>inspectModelSession(history),[history]);
  const values=useMemo(()=>modelDimensionValues(history),[history]);
  const geom=useMemo(()=>previewModelProfile(report),[report]);
  const faults=useMemo(()=>modelDiagnostics(report),[report]);
  const plate=report.features.find(f=>f.featureId==='plate');
  const cut=report.features.find(f=>f.featureId==='cut');
  const update=(field:ModelDimension,value:number)=>{
    try {
      const next=editModelDimension(history,field,value);
      const invalidation=runtime.diff(history,next);
      setHistory(next);
      setMessage(`Revision ${next.document.revision}: changed ${field}; invalidated ${invalidation.invalidatedFeatureIds.join(' → ') || 'none'} (no exact geometry reused).`);
    } catch(error) {setMessage(error instanceof Error?error.message:'Dimension edit failed');}
  };
  const undo=()=>{
    try{setHistory(undoModelSession(history));setMessage(null);}
    catch(e){setMessage(String(e));}
  };
  const redo=()=>{
    try{setHistory(redoModelSession(history));setMessage(null);}
    catch(e){setMessage(String(e));}
  };
  const save=()=>{
    try{
      const data=serializeModelSession(history);
      const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url; anchor.download='intuit3d-plate.i3d-model.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('Authoritative INTENT journal + undo archive saved locally. Exact geometry and STEP are not included.');
    }catch(e){setMessage('Save failed: '+String(e));}
  };
  const load=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    const ticket=++loadTicket.current;
    try{
      if(file.size>4*1024*1024)throw Error('Archive exceeds 4 MiB');
      const source=await file.text();
      const incoming=reopenModelSession(source);
      if(ticket!==loadTicket.current)return;
      setPendingImport({file:file.name,history:incoming});
      setMessage(null);
    }catch(e){if(ticket===loadTicket.current)setMessage('Open rejected: '+String(e));}
  };
  const useIncoming=()=>{
    if(!pendingImport)return;
    ++loadTicket.current;
    setHistory(pendingImport.history);setSelected('plate');setPendingImport(null);
    setMessage('Model archive reopened with durable feature IDs, undo/redo and no cached meshes.');
  };
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(pendingImport)return;
      const target=e.target as HTMLElement|null;
      if(target?.closest('input,textarea,[contenteditable=true]'))return;
      if(!(e.ctrlKey||e.metaKey))return;
      if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
      if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}
      if(e.key.toLowerCase()==='s'){e.preventDefault();save();}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  });
  return <div className="app-shell runtime-shell" data-testid="runtime-panel">
    <header className="titlebar">
      <div className="identity"><strong>INTUIT<span>3D</span></strong><small>MODEL-BACKED CAD</small></div>
      <div className="title-divider"/>
      <div className="project-title">Mounting plate · <span data-testid="runtime-revision">revision {report.revision}</span></div>
      <div className="title-actions">
        <button className="ribbon-button" onClick={save}>Save model archive</button>
        <button className="ribbon-button" onClick={()=>fileInput.current?.click()}>Open model archive</button>
        <button className="ribbon-button" onClick={()=>{
          if(window.confirm('Leave the model-backed editor? Export your model archive first; the model session will close.'))onClose();
        }}>Preview sandbox</button>
        <input ref={fileInput} type="file" accept=".json" className="runtime-file-input" onChange={load}
          aria-label="Open INTUIT model archive" />
      </div>
    </header>
    <nav className="toolstrip" aria-label="Model-backed CAD controls">
      <div className="ribbon-group"><span className="ribbon-label">GEOMETRY</span>
        <button className={!sketchMode?'ribbon-button active':'ribbon-button'} onClick={()=>setSketchMode(false)}>Solid</button>
        <button className={sketchMode?'ribbon-button active':'ribbon-button'} onClick={()=>setSketchMode(true)}>Sketch</button>
      </div>
      <div className="ribbon-group"><span className="ribbon-label">AUTHORITATIVE HISTORY</span>
        <button className="ribbon-button" disabled={!history.undoStack.length} onClick={undo}>Undo</button>
        <button className="ribbon-button" disabled={!history.redoStack.length} onClick={redo}>Redo</button>
      </div>
      <div className="toolstrip-right"><span className="stage-chip" data-testid="runtime-exact-state">
        REAL INTENT + SKETCH · NO EXACT KERNEL</span></div>
    </nav>
    <div className="workspace-grid">
      <aside className="sidepanel browser-panel" aria-label="Authoritative feature browser">
        <div className="panel-heading">SEMANTIC MODEL <span className="panel-count">{report.features.length}</span></div>
        <div className="browser-project">Plate · {report.projectId}</div>
        <div className="browser-subheading">Stable feature IDs</div>
        <div className="feature-list">
          {report.features.map((f,i)=><button key={f.featureId} type="button"
            data-testid={`runtime-feature-${f.featureId}`}
            className={selected===f.featureId?'feature-item selected':'feature-item'}
            onClick={()=>{setSelected(f.featureId);if(f.kind==='sketch')setSketchMode(true);}}>
            <span className="feature-position">{i+1}</span>
            <span className="feature-main"><span>{f.kind.toUpperCase()} · {f.featureId}</span><small>{f.status}</small></span>
          </button>)}
        </div>
        <div className="browser-footnote">Semantic history is persisted by INTENT. The mesh is disposable; no topology IDs are taken from triangles.</div>
      </aside>
      <main className="editor-center" aria-label="Model-backed plate editor">
        <div className="viewport-header">
          <div className="view-label"><strong>{sketchMode?'Sketch XY · solved profiles':'3D extrusion preview'}</strong>
            <span>{geom?'Public SKETCH solver + profile admission':'Invalid or unresolved geometry'}</span></div>
          <span className={geom?'preview-tag':'preview-tag stale'}>{geom?'TESSELLATED PREVIEW · NOT EXACT':'NO CURRENT VALID MESH'}</span>
        </div>
        <div className="viewport-stage">
          {geom?<RuntimeGeometryViewport profile={geom.profile} thickness={geom.thickness} sketchMode={sketchMode}/>:
            <div className="empty-overlay" data-testid="runtime-empty">Current dimensions cannot produce an admitted sketch profile. No previous mesh is represented as current.</div>}
          {geom&&<div className="runtime-mesh-caption" data-testid="runtime-boundary">
            Analytic profile {geom.profile.outer.length} vertices · {geom.profile.holes.length} circular holes · {geom.thickness} mm extrude · no Boolean proof
          </div>}
          <div className="viewport-hint">{sketchMode?'Profile from public SKETCH solver · Edit dimension values in inspector':
            'Drag to orbit · Wheel to zoom · Right-drag to pan · edit historical dimensions in inspector'}</div>
        </div>
        <section className="timeline" aria-label="Authoritative history versus dependency schedule">
          <div className="timeline-head"><div className="tab-group">
            <button className={timeline==='authored'?'active':''} onClick={()=>setTimeline('authored')}>Authored timeline</button>
            <button className={timeline==='evaluated'?'active':''} onClick={()=>setTimeline('evaluated')}>Dependency order</button>
          </div><span className="timeline-note">INTENT authoritative chronology and DAG</span></div>
          <div className="timeline-rail" data-testid="runtime-order">
            {(timeline==='authored'?report.authoredOrder:report.executableOrder).map((id,i)=>
              <div key={id} className="timeline-event"><span className="timeline-index">{i+1}</span><span>{id}</span></div>)}
          </div>
        </section>
      </main>
      <aside className="sidepanel inspector-panel" aria-label="Model-backed feature inspector">
        <div className="panel-heading">PARAMETRIC INSPECTOR <span className="panel-count">mm</span></div>
        <div className="inspector-feature"><small>SELECTED SEMANTIC FEATURE</small><strong>{selected}</strong>
          <span>{report.features.find(f=>f.featureId===selected)?.status ?? 'Missing'}</span></div>
        <div className="inspector-section">
          <div className="section-head">EDIT RETROSPECTIVE DIMENSIONS</div>
          {MODEL_DIMENSIONS.map(field=><ScalarInput key={field+':'+history.document.revision} field={field}
            value={values[field]} onCommit={update}/>)}
          <p className="microcopy">Values edit the actual SKETCH constraints or the retrospective INTENT thickness parameter. Every edit is a revision-fenced undoable journal transaction.</p>
        </div>
        <div className="inspector-section diagnostics">
          <div className="section-head">EVALUATION <span>{faults.length} pending / invalid</span></div>
          {report.features.map(f=><div className="runtime-diagnostic" key={f.featureId}>
            <strong>{f.featureId}</strong> <span data-testid={`runtime-status-${f.featureId}`}>{f.status}</span>
            {f.diagnostics.map((d,i)=><small key={i}>{d}</small>)}
          </div>)}
          <p className="microcopy">Extrude: {plate?.status}. Cut: {cut?.status}. Real native B-rep and verified STEP are unavailable. This viewport never asserts exactness.</p>
        </div>
        {message&&<div className="runtime-message" role="status">{message}</div>}
      </aside>
    </div>
    <footer className="statusbar">LOCAL MODEL + SKETCH · INTENT JOURNAL · PREVIEW ONLY
      <span className="status-spacer"/> {report.revision} accepted journal events · Exact geometry: unavailable</footer>
    {pendingImport&&<div className="recovery-backdrop"><section className="recovery-dialog" role="dialog"
      aria-modal="true" aria-label="Review incoming model archive" data-testid="runtime-import-review">
      <h2>Replace model session?</h2>
      <p>{pendingImport.file}: {pendingImport.history.document.revision} durable events.
        Accepting replaces the in-memory undo history. No native B-rep/STEP is imported.</p>
      <div className="recovery-actions">
        <button onClick={()=>{++loadTicket.current;setPendingImport(null);}}>Cancel</button>
        <button onClick={useIncoming}>Replace with model archive</button>
      </div>
    </section></div>}
  </div>;
}
