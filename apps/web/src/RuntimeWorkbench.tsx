import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  addModelHole, editModelDimension, editModelHole, editModelSketchHandle, inspectModelSession, modelDiagnostics, modelDimensionValues, modelHoleValues, moveModelFeature, moveModelHoleCenter, patternModelHoles, removeModelHole,
  MODEL_DIMENSIONS, makeModelThicknessIndependent, modelThicknessBinding, newModelPlateSession, previewModelProfile, redoModelSession,
  reopenModelSession, runtime, serializeModelSession, undoModelSession,
  type ModelDimension, type ModelHole, type ModelHoleField, type ModelSession,
} from './runtimeSession';
import { RuntimeGeometryViewport } from './RuntimeGeometryViewport';
import type { SketchDimensionHandle } from './runtimeSketchHandles';
import { evaluateLocalPlate } from '@intuit3d/workflow-runtime/local-plate-client';
import { verifyCurrentStepRevision, experimentalStepFilename } from './localNativeStep';

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

const HOLE_FIELDS: readonly ModelHoleField[] = ['x','y','diameter'];

function HoleScalarInput({hole,field,value,onCommit}:{
  hole:ModelHole;field:ModelHoleField;value:number;
  onCommit:(hole:ModelHole,field:ModelHoleField,value:number)=>void;
}) {
  const [text,setText]=useState(String(value));
  const cancelledBlur=useRef(false);
  const label=hole+' '+(field==='diameter'?'diameter':field.toUpperCase()+' center');
  return <label className="runtime-scalar">
    <span>{field==='diameter'?'Diameter':field.toUpperCase()+' center'}</span>
    <span className="runtime-scalar-control">
      <input type="number" step="any" min={field==='diameter'?'0':undefined}
        data-testid={`runtime-hole-${hole}-${field}`} aria-label={label}
        value={text} onChange={e=>setText(e.target.value)}
        onKeyDown={e=>{
          if(e.key==='Enter')e.currentTarget.blur();
          if(e.key==='Escape'){cancelledBlur.current=true;setText(String(value));e.currentTarget.blur();}
        }}
        onBlur={()=>{
          if(cancelledBlur.current){cancelledBlur.current=false;return;}
          const next=Number(text);
          if(text.trim()!=='' && Number.isFinite(next) &&
              (field!=='diameter'||next>0) && Math.abs(next)<=10000){
            if(!Object.is(next,value))onCommit(hole,field,next);
          }else setText(String(value));
        }}/>
      <small>mm</small>
    </span>
  </label>;
}

export function RuntimeWorkbench({ onClose }: { onClose:()=>void }) {
  const [history,setHistory]=useState<ModelSession>(()=>newModelPlateSession());
  const [sketchMode,setSketchMode]=useState(false);
  const [holeDraft,setHoleDraft]=useState({x:'60',y:'20',diameter:'10'});
  const [arrayDraft,setArrayDraft]=useState({sourceHoleId:'holeA',rows:'2',columns:'2',pitchXmm:'20',pitchYmm:'20'});
  const [selected,setSelected]=useState('plate');
  const [timeline,setTimeline]=useState<'authored'|'evaluated'>('authored');
  const [message,setMessage]=useState<string|null>(null);
  const [pendingImport,setPendingImport]=useState<{file:string;history:ModelSession}|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const loadTicket=useRef(0);
  // Native work must NEVER outlive the authoritative journal revision.
  const liveHistory=useRef(history);
  const nativeOperation=useRef<AbortController|null>(null);
  const nativeTicket=useRef(0);
  const [nativeUrl,setNativeUrl]=useState('');
  const [nativeToken,setNativeToken]=useState('');
  const [nativeBusy,setNativeBusy]=useState(false);
  const [nativeReport,setNativeReport]=useState<string|null>(null);
  const invalidateNative=()=>{
    ++nativeTicket.current;
    nativeOperation.current?.abort();
    nativeOperation.current=null;
    setNativeBusy(false);
    setNativeReport(null);
  };
  const acceptHistory=(next:ModelSession)=>{
    invalidateNative();
    liveHistory.current=next;
    setHistory(next);
  };
  useEffect(()=>()=>{nativeOperation.current?.abort();},[]);
  const report=useMemo(()=>inspectModelSession(history),[history]);
  const values=useMemo(()=>modelDimensionValues(history),[history]);
  const thicknessBinding=useMemo(()=>modelThicknessBinding(history),[history]);
  const holes=useMemo(()=>modelHoleValues(history),[history]);
  const geom=useMemo(()=>previewModelProfile(report),[report]);
  const faults=useMemo(()=>modelDiagnostics(report),[report]);
  const plate=report.features.find(f=>f.featureId==='plate');
  const cut=report.features.find(f=>f.featureId==='cut');
  const update=(field:ModelDimension,value:number)=>{
    try {
      const next=editModelDimension(history,field,value);
      const invalidation=runtime.diff(history,next);
      acceptHistory(next);
      setMessage(`Revision ${next.document.revision}: changed ${field}; invalidated ${invalidation.invalidatedFeatureIds.join(' → ') || 'none'} (no exact geometry reused).`);
    } catch(error) {setMessage(error instanceof Error?error.message:'Dimension edit failed');}
  };
  const makeIndependent=()=>{
    try{
      const prior=liveHistory.current;
      const result=makeModelThicknessIndependent(prior);
      acceptHistory(result.history);
      setMessage(`Extrusion thickness frozen at ${result.bakedThicknessMm} mm. Named parameter and witnessed dependency retired as ONE undoable operation; invalidated ${result.invalidatedFeatureIds.join(' → ') || 'none'}. Preview and STEP must rebuild.`);
    }catch(e){setMessage('Make Independent refused: '+(e instanceof Error?e.message:String(e)));}
  };
  const editHole=(hole:ModelHole,field:ModelHoleField,value:number)=>{
    try{
      const previous=liveHistory.current;
      const result=editModelHole(previous,hole,field,value,'preserve_unresolved');
      if(result.kind==='refused'){setMessage(result.reason);return;}
      acceptHistory(result.history);
      setMessage(`Revision ${result.history.document.revision}: ${hole} ${field} edited; ${result.invalidation.invalidatedFeatureIds.join(' → ') || 'no structural invalidation'}. ${result.sketchStatus}; no exact geometry reused.`);
    }catch(e){setMessage('Hole edit refused: '+String(e));}
  };
  const addHole=()=>{
    const x=Number(holeDraft.x),y=Number(holeDraft.y),diameter=Number(holeDraft.diameter);
    if(Object.values(holeDraft).some(v=>!v.trim())||![x,y,diameter].every(Number.isFinite)){
      setMessage('Add hole refused: enter finite X, Y and diameter.');return;
    }
    try{
      const id='hole.user.'+crypto.randomUUID().replaceAll('-','');
      const result=addModelHole(liveHistory.current,id,x,y,diameter);
      if(result.kind==='refused'){
        setMessage('Add hole refused: '+result.candidateFeature.diagnostics.join('; '));return;
      }
      acceptHistory(result.history);setSketchMode(true);
      setMessage(`Added ${id} in one undoable sketch transaction; invalidated ${result.invalidation.invalidatedFeatureIds.join(' → ')}. Rebuild STEP.`);
    }catch(e){setMessage('Add hole refused: '+String(e));}
  };
  const patternHoles=()=>{
    const {rows,columns,pitchXmm,pitchYmm}=arrayDraft;
    if([rows,columns,pitchXmm,pitchYmm].some(value=>!value.trim())){
      setMessage('Array refused: enter rows, columns and X/Y pitches.');return;
    }
    try {
      const previous=liveHistory.current;
      const sourceHoleId=Object.hasOwn(holes,arrayDraft.sourceHoleId)
        ?arrayDraft.sourceHoleId:Object.keys(holes)[0];
      const result=patternModelHoles(previous,{
        sourceHoleId,rows:Number(rows),columns:Number(columns),
        pitchXmm:Number(pitchXmm),pitchYmm:Number(pitchYmm),
      });
      if(result.kind==='refused'){
        setMessage('Array refused: '+(result.candidateFeature.diagnostics.join('; ')||result.reason));return;
      }
      acceptHistory(result.history);setSketchMode(true);
      setMessage(`Array committed at revision ${result.history.document.revision}: ${Number(rows)*Number(columns)-1} independently editable circular cuts copied from solved ${sourceHoleId}; ${result.invalidation.invalidatedFeatureIds.join(' → ')} invalidated. Rebuild STEP.`);
    }catch(e){setMessage('Array refused: '+String(e));}
  };
  const removeHole=(id:ModelHole)=>{
    try{
      const result=removeModelHole(liveHistory.current,id);
      if(result.kind==='refused'){setMessage('Remove refused: '+result.reason);return;}
      acceptHistory(result.history);
      setMessage(`Removed ${id}; undo restores the same semantic identity; native STEP requires rebuild.`);
    }catch(e){setMessage('Remove refused: '+String(e));}
  };
  const dragHole=(hole:ModelHole,x:number,y:number)=>{
    try{
      const result=moveModelHoleCenter(liveHistory.current,hole,x,y);
      if(result.kind==='refused'){setMessage(`Drag refused: ${result.candidateFeature.diagnostics.join('; ') || result.reason}`);return;}
      acceptHistory(result.history);
      setMessage(`Moved ${hole} center to (${x}, ${y}) mm in one undoable sketch transaction; native STEP requires rebuild.`);
    }catch(e){setMessage('Hole drag refused: '+String(e));}
  };
  const dragDimension=(id:SketchDimensionHandle,value:number)=>{
    try{
      const result=editModelSketchHandle(liveHistory.current,id,value);
      if(result.kind==='refused'){setMessage('Dimension gesture refused: '+result.reason);return;}
      acceptHistory(result.history);
      setMessage(`Revision ${result.history.document.revision}: direct ${id} → ${value} mm; invalidated ${result.invalidatedFeatureIds.join(' → ')||'none'}. STEP must be rebuilt; preview is not exact.`);
    }catch(e){setMessage('Dimension gesture refused: '+String(e));}
  };
  const moveTimeline=(id:string,direction:'earlier'|'later')=>{
    try{
      const moved=moveModelFeature(liveHistory.current,id,direction);
      acceptHistory(moved.history);
      setMessage(`Authored timeline moved ${id} to position ${moved.toIndex+1}. Dependency evaluation and semantic body targets remain authoritative; no exact artifact was reused.`);
    }catch(e){setMessage('Timeline move refused: '+String(e));}
  };
  const undo=()=>{
    try{acceptHistory(undoModelSession(liveHistory.current));setMessage(null);}
    catch(e){setMessage(String(e));}
  };
  const redo=()=>{
    try{acceptHistory(redoModelSession(liveHistory.current));setMessage(null);}
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
    acceptHistory(pendingImport.history);setSelected('plate');setPendingImport(null);
    setMessage('Model archive reopened with durable feature IDs, undo/redo and no cached meshes.');
  };
  const downloadNativeStep=async()=>{
    if(nativeOperation.current) return;
    const current=liveHistory.current;
    const archive=serializeModelSession(current);
    const token=nativeToken.trim();
    const url=nativeUrl.trim();
    const id=++nativeTicket.current;
    const controller=new AbortController();
    nativeOperation.current=controller;
    setNativeBusy(true);setNativeReport(null);
    try{
      const outcome=await evaluateLocalPlate({
        url,token,runtime,readCurrentHistory:()=>liveHistory.current,
        cutFeatureId:'cut',
        requestId:`workbench.step.${current.document.revision}.${crypto.randomUUID().replaceAll('-','')}`,
        exportStep:true,signal:controller.signal,
      });
      if(id!==nativeTicket.current || controller.signal.aborted)return;
      if(outcome.kind==='unresolved'){
        setNativeReport(`No STEP published: ${outcome.code} — ${outcome.reason}`);
        return;
      }
      // Re-fence AFTER the browser client has checked the HTTP result and hash,
      // immediately before publishing bytes to the download API.
      if(!outcome.step || !verifyCurrentStepRevision({
        originalArchive:archive, readCurrentHistory:()=>liveHistory.current,
        serialize:serializeModelSession,source:outcome.source,
      })){
        setNativeReport('No STEP published: document changed while native work completed.');
        return;
      }
      if(outcome.exactAuthority!==false || outcome.independentInteroperability!==false){
        setNativeReport('No STEP published: unacceptable exactness claim.');
        return;
      }
      const bytes=new Uint8Array(outcome.step.bytes);
      const filename=experimentalStepFilename(current.document.projectId,current.document.revision);
      const objectUrl=URL.createObjectURL(new Blob([bytes],{type:'model/step'}));
      try{
        const link=document.createElement('a');
        link.href=objectUrl;link.download=filename;
        document.body.appendChild(link);link.click();link.remove();
      }finally{setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
      setNativeReport(`Experimental STEP downloaded · revision ${outcome.source.revision} · ${bytes.byteLength} bytes · SHA-256 ${outcome.step.sha256}. Same-engine readback only; not independent STEP or production exactness.`);
    }catch(error){
      if(id===nativeTicket.current && !controller.signal.aborted)
        setNativeReport('No STEP published: '+(error instanceof Error?error.message:String(error)));
    }finally{
      if(id===nativeTicket.current){
        nativeOperation.current=null;
        setNativeBusy(false);
      }
    }
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
        <button className="ribbon-button" data-testid="runtime-new-plate"
          onClick={()=>{++loadTicket.current;setPendingImport({
            file:'New mounting plate (fresh project)',history:newModelPlateSession('workbench.plate.'+crypto.randomUUID()),
          });}}>
          New plate sketch
        </button>
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
        <button className={!sketchMode?'ribbon-button active':'ribbon-button'} data-testid="runtime-mode-solid" onClick={()=>setSketchMode(false)}>Solid</button>
        <button className={sketchMode?'ribbon-button active':'ribbon-button'} data-testid="runtime-mode-sketch" onClick={()=>setSketchMode(true)}>Sketch</button>
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
          {geom?<RuntimeGeometryViewport profile={geom.profile} thickness={geom.thickness} sketchMode={sketchMode} onHoleMove={dragHole} onDimensionEdit={dragDimension}/>:
            <div className="empty-overlay" data-testid="runtime-empty">Current dimensions cannot produce an admitted sketch profile. No previous mesh is represented as current.</div>}
          {geom&&<div className="runtime-mesh-caption" data-testid="runtime-boundary">
            Analytic profile {geom.profile.outer.length} vertices · {geom.profile.holes.length} circular holes · {geom.thickness} mm extrude · no Boolean proof
          </div>}
          <div className="viewport-hint">{sketchMode?'Drag edge/diameter handles or hole centers; arrow keys nudge focused dimensions (Shift = 0.1 mm)':
            'Drag to orbit · Wheel to zoom · Right-drag to pan · edit historical dimensions in inspector'}</div>
        </div>
        <section className="timeline" aria-label="Authoritative history versus dependency schedule">
          <div className="timeline-head"><div className="tab-group">
            <button className={timeline==='authored'?'active':''} onClick={()=>setTimeline('authored')}>Authored timeline</button>
            <button className={timeline==='evaluated'?'active':''} onClick={()=>setTimeline('evaluated')}>Dependency order</button>
          </div><span className="timeline-note">INTENT authoritative chronology and DAG</span></div>
          <div className="timeline-rail" data-testid="runtime-order">
            {(timeline==='authored'?report.authoredOrder:report.executableOrder).map((id,i)=>
              <div key={id} className="timeline-event">
                <span className="timeline-index">{i+1}</span><span>{id}</span>
                {timeline==='authored'&&<span className="timeline-move-actions">
                  <button type="button" data-testid={`runtime-move-${id}-earlier`}
                    aria-label={`Move ${id} earlier`} disabled={i===0}
                    onClick={()=>moveTimeline(id,'earlier')}>◀</button>
                  <button type="button" data-testid={`runtime-move-${id}-later`}
                    aria-label={`Move ${id} later`} disabled={i===report.authoredOrder.length-1}
                    onClick={()=>moveTimeline(id,'later')}>▶</button>
                </span>}
              </div>)}
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
          <div className="runtime-hole-add" data-testid="runtime-thickness-binding">
            <strong>Extrusion thickness · named parameter</strong>
            <span data-testid="runtime-thickness-link-state">
              {thicknessBinding==='named_parameter'
                ? 'Linked: thickness (parameter.t) → plate.thicknessMm'
                : 'Independent: plate.thicknessMm is an authored numeric dimension'}
            </span>
            <button type="button" className="ribbon-button runtime-native-export"
              data-testid="runtime-freeze-thickness"
              disabled={thicknessBinding!=='named_parameter' || !!pendingImport}
              onClick={makeIndependent}>Make thickness independent</button>
            <p className="microcopy">Freeze the current resolved value, release only the witnessed parameter dependency, and retire the unused parameter. One reversible INTENT transaction; later edits change the extrusion directly. This is not a native geometry operation.</p>
          </div>
          <p className="microcopy">Values edit actual SKETCH constraints or the authoritative INTENT extrusion dimension. The thickness link/independent state is read from the model's binding manifest, never a separate browser flag. Every edit is a revision-fenced undoable journal transaction.</p>
        </div>
        <div className="inspector-section" data-testid="runtime-hole-inspector">
          <div className="section-head">CIRCULAR HOLES · {Object.keys(holes).length}</div>
          <div className="runtime-hole-add" data-testid="runtime-hole-authoring">
            <strong>Add a through-hole</strong>
            {(['x','y','diameter'] as const).map(field=><label key={field} className="runtime-scalar">
              <span>{field==='diameter'?'Diameter':field.toUpperCase()+' centre'}</span>
              <span className="runtime-scalar-control">
                <input type="number" step="any" data-testid={`runtime-new-hole-${field}`}
                  aria-label={`New hole ${field}`} value={holeDraft[field]}
                  onChange={e=>setHoleDraft(prev=>({...prev,[field]:e.target.value}))}/>
                <small>mm</small>
              </span>
            </label>)}
            <button type="button" className="ribbon-button runtime-native-export"
              data-testid="runtime-add-hole" disabled={!!pendingImport}
              onClick={addHole}>Add circular cut</button>
          </div>
          <div className="runtime-hole-add" data-testid="runtime-hole-pattern">
            <strong>Rectangular circular-hole array · one-shot</strong>
            <label className="runtime-scalar">
              <span>Copy solved hole</span>
              <span className="runtime-scalar-control">
                <select data-testid="runtime-pattern-source" aria-label="Array source hole"
                  value={Object.hasOwn(holes,arrayDraft.sourceHoleId)?arrayDraft.sourceHoleId:Object.keys(holes)[0]}
                  onChange={e=>setArrayDraft(prev=>({...prev,sourceHoleId:e.target.value}))}>
                  {Object.keys(holes).map(id=><option key={id} value={id}>{id}</option>)}
                </select>
              </span>
            </label>
            {(['rows','columns','pitchXmm','pitchYmm'] as const).map(field=><label className="runtime-scalar" key={field}>
              <span>{field==='pitchXmm'?'X pitch':field==='pitchYmm'?'Y pitch':field==='rows'?'Rows':'Columns'}</span>
              <span className="runtime-scalar-control">
                <input data-testid={`runtime-pattern-${field}`} type="number"
                  aria-label={field==='pitchXmm'?'Array X pitch':field==='pitchYmm'?'Array Y pitch':field}
                  min={field==='rows'||field==='columns'?1:undefined}
                  max={field==='rows'||field==='columns'?8:undefined}
                  step={field==='rows'||field==='columns'?1:'any'}
                  value={arrayDraft[field]}
                  onChange={e=>setArrayDraft(prev=>({...prev,[field]:e.target.value}))}/>
                {(field==='pitchXmm'||field==='pitchYmm')&&<small>mm</small>}
              </span>
            </label>)}
            <button type="button" className="ribbon-button runtime-native-export"
              data-testid="runtime-pattern-holes" disabled={!!pendingImport}
              onClick={patternHoles}>Create one-shot hole array</button>
            <p className="microcopy">Copies the currently solved source hole, including its radius. Each new circle is an independent SKETCH constraint, not an associative pattern; undo removes the entire array in one step. Invalid overlaps and outside cuts are refused.</p>
          </div>
          {Object.keys(holes).map(hole=><div key={hole} className="runtime-hole-editor" data-testid={`runtime-hole-editor-${hole}`}>
            <strong>{hole==='holeA'?'Hole A':hole==='holeB'?'Hole B':'Added hole'} · {hole}</strong>
            {hole!=='holeA'&&hole!=='holeB'&&<button type="button" className="ribbon-button"
              data-testid={`runtime-remove-hole-${hole}`} onClick={()=>removeHole(hole)}>Remove hole</button>}
            {HOLE_FIELDS.map(field=><HoleScalarInput
              key={`${hole}.${field}.${history.document.revision}`}
              hole={hole} field={field} value={holes[hole][field]} onCommit={editHole}/>)}
          </div>)}
          <p className="microcopy">Every added circle has a stable authored ID and fixed-centre/radius constraints. Drag its centre, edit its diameter here, undo/redo, or save and reopen the authoritative model. The base A/B diameter handles also drag. Add/remove requires SKETCH admission; preview and native STEP must rebuild after edits.</p>
        </div>
        <div className="inspector-section runtime-native" data-testid="runtime-native-panel">
          <div className="section-head">LOCAL NATIVE STEP · EXPERIMENTAL</div>
          <p className="microcopy">Start the separate trusted local provider using <code>node apps/web/scripts/local-native-host.mjs</code>. Copy its one-session loopback URL and pairing token from your terminal. No cloud connection; neither value is saved with the model.</p>
          <label className="runtime-native-field">
            <span>Local provider URL</span>
            <input type="url" data-testid="runtime-native-url" aria-label="Local native provider URL"
              placeholder="http://127.0.0.1:port" autoComplete="off" spellCheck={false}
              value={nativeUrl} onChange={e=>{invalidateNative();setNativeUrl(e.target.value);}}/>
          </label>
          <label className="runtime-native-field">
            <span>Session pairing token</span>
            <input type="password" data-testid="runtime-native-token" aria-label="Local native pairing token"
              placeholder="64 hexadecimal characters" autoComplete="off" spellCheck={false}
              value={nativeToken} onChange={e=>{invalidateNative();setNativeToken(e.target.value);}}/>
          </label>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-export" onClick={()=>void downloadNativeStep()}
            disabled={!geom || !!pendingImport || nativeBusy || !nativeUrl.trim() || !/^[a-f0-9]{64}$/.test(nativeToken.trim())}>
            {nativeBusy?'Building verified STEP…':'Build and download experimental STEP'}
          </button>
          {nativeBusy&&<button type="button" className="ribbon-button"
            data-testid="runtime-native-cancel" onClick={()=>{invalidateNative();setNativeReport('Native evaluation cancelled; no STEP published.');}}>Cancel native evaluation</button>}
          {nativeReport&&<p className="microcopy" role="status" data-testid="runtime-native-result">{nativeReport}</p>}
          <p className="microcopy">Only the model's live revision is submitted. A changed, invalid or unresolved sketch cannot publish old STEP. OCP research output is a physical experimental solid, <strong>not independently verified production CAD</strong>. This preview viewport remains tessellated.</p>
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
