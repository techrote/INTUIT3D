import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  addModelHole, createModelExtrusion, createModelThroughCut, editModelDimension, editModelHole, editModelSketchHandle, inspectModelSession, modelDiagnostics, modelDimensionValues, modelSketchDimensionValues, modelFeatureRemovalImpact, modelFeatureTimeline, modelHoleValues, moveModelFeature, moveModelHoleCenter, moveModelHoleGroup, patternModelHoles, removeModelFeature, removeModelHole, resizeModelHoleLayout, restoreModelFeature,
  editNamedThicknessParameter, inspectNamedThicknessParameter, makeModelThicknessIndependent, modelThicknessBinding, newModelPlateSession, newModelSketchSession, previewModelProfile, previewModelSketchProfile, redoModelSession,
  runtime, serializeModelSession, undoModelSession,
  type ModelDimension, type ModelHole, type ModelHoleField, type ModelSession,
} from './runtimeSession';
import { RuntimeGeometryViewport } from './RuntimeGeometryViewport';
import { ParameterFormulaTable } from './ParameterFormulaTable';
import type { SketchDimensionHandle } from './runtimeSketchHandles';
import { nextCircleDrawing, type CircleDrawingState } from './circleDrawing';
import { createLivePlateSession } from '@intuit3d/workflow-runtime/live-plate-session';
import { experimentalStepFilename } from './localNativeStep';
import { MAX_MODEL_ARCHIVE_BYTES, validateModelArchiveInWorker } from './modelArchiveImport';
import { checkedModelArchiveSize, modelArchiveDownloadName, modelArchiveSummary } from './modelFileLifecycle';

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
  // An unfinished circle is presentation-only. The INTENT journal changes
  // precisely once, after centre AND radius are accepted by RUNTIME/SKETCH.
  const [circleDrawing,setCircleDrawing]=useState<CircleDrawingState>({phase:'idle'});
  const [holeDraft,setHoleDraft]=useState({x:'60',y:'20',diameter:'10'});
  const [arrayDraft,setArrayDraft]=useState({sourceHoleId:'holeA',rows:'2',columns:'2',pitchXmm:'20',pitchYmm:'20'});
  const [extrudeDraft,setExtrudeDraft]=useState('8');
  // Presentation-only E combo: the actual feature is committed by RUNTIME/INTENT.
  const [featureCombo,setFeatureCombo]=useState<'extrude'|'cut'|null>(null);
  const [selected,setSelected]=useState('plate');
  const [activeHole,setActiveHole]=useState<string|null>(null);
  const [layoutSelected,setLayoutSelected]=useState<string[]>(['holeA']);
  const [layoutDraft,setLayoutDraft]=useState({scaleX:'120',scaleY:'100',radiusScale:'100'});
  const [cascadeConfirmation,setCascadeConfirmation]=useState<string|null>(null);
  const [timeline,setTimeline]=useState<'authored'|'evaluated'>('authored');
  const [message,setMessage]=useState<string|null>(null);
  const [pendingImport,setPendingImport]=useState<{file:string;history:ModelSession;origin:'file'|'new'}|null>(null);
  // The browser cannot prove that a requested file download reached the OS.
  const [needsArchiveExport,setNeedsArchiveExport]=useState(true);
  const fileInput=useRef<HTMLInputElement>(null);
  const loadTicket=useRef(0);
  const importAbort=useRef<AbortController|null>(null);
  const [loadingFile,setLoadingFile]=useState<string|null>(null);
  const cancelActiveImport=()=>{
    ++loadTicket.current;
    importAbort.current?.abort();
    importAbort.current=null;
    setLoadingFile(null);
  };
  // RUNTIME's live session fences all native bytes to the ONE authoritative
  // INTENT journal. The browser owns only presentation and ephemeral UI state.
  const liveHistory=useRef(history);
  const nativeSession=useRef<ReturnType<typeof createLivePlateSession>|null>(null);
  if(!nativeSession.current) nativeSession.current=createLivePlateSession({
    runtime,readCurrentHistory:()=>liveHistory.current,
    publishHistory:(next)=>{liveHistory.current=next;setHistory(next);},
    cutFeatureId:'cut',
  });
  const nativeTicket=useRef(0); // UI-only generation; never document authority.
  const [nativeUrl,setNativeUrl]=useState('');
  const [nativeToken,setNativeToken]=useState('');
  const [nativeBusy,setNativeBusy]=useState(false);
  const [autoNative,setAutoNative]=useState(false);
  const autoNativeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [nativeReport,setNativeReport]=useState<string|null>(null);
  const [nativeEvidence,setNativeEvidence]=useState<{
    revision:number;solidCount:number|null;volumeMm3:number|null;holeCount:number;
  }|null>(null);
  const invalidateNative=()=>{
    ++nativeTicket.current;
    if(autoNativeTimer.current!==null){
      clearTimeout(autoNativeTimer.current);autoNativeTimer.current=null;
    }
    nativeSession.current?.cancel();
    setNativeBusy(false);
    setNativeReport(null);
    setNativeEvidence(null);
  };
  const acceptHistory=(next:ModelSession)=>{
    liveHistory.current=next;
    invalidateNative();
    setCascadeConfirmation(null);
    setCircleDrawing({phase:'idle'});
    setFeatureCombo(null);
    setHistory(next);
    setNeedsArchiveExport(true);
    // An accepted journal change may trigger a new native evaluation, but a
    // burst of sketch drags coalesces and unsupported profiles stay pending.
    if(autoNative && nativeUrl.trim() && /^[a-f0-9]{64}$/.test(nativeToken.trim()) &&
        previewModelProfile(inspectModelSession(next)) &&
        modelFeatureTimeline(next).some(row=>row.featureId==='cut'&&row.active)){
      const expectedTicket=nativeTicket.current;
      autoNativeTimer.current=setTimeout(()=>{
        autoNativeTimer.current=null;
        if(expectedTicket===nativeTicket.current)void rebuildNative(false);
      },250);
    }
  };
  useEffect(()=>()=>{if(autoNativeTimer.current!==null)clearTimeout(autoNativeTimer.current);nativeSession.current?.cancel();importAbort.current?.abort();},[]);
  // Browser-native unload guard for changes since last requested archive export.
  useEffect(()=>{
    if(!needsArchiveExport)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[needsArchiveExport]);
  const report=useMemo(()=>inspectModelSession(history),[history]);
  const featureRows=useMemo(()=>modelFeatureTimeline(history),[history]);
  const plateActive=featureRows.some(row=>row.featureId==='plate'&&row.active);
  const cutActive=featureRows.some(row=>row.featureId==='cut'&&row.active);
  const plateAuthored=featureRows.some(row=>row.featureId==='plate');
  const cutAuthored=featureRows.some(row=>row.featureId==='cut');
  const renderSketch=sketchMode||!plateActive;
  const selectedActive=featureRows.some(row=>row.featureId===selected&&row.active);
  const editableLifecycle=selected==='plate'||selected==='cut';
  const removalImpact=selectedActive&&editableLifecycle
    ?modelFeatureRemovalImpact(history,selected):null;
  const values=useMemo(()=>plateActive?modelDimensionValues(history):null,[history,plateActive]);
  const sketchValues=useMemo(()=>modelSketchDimensionValues(history),[history]);
  const thicknessBinding=useMemo(()=>plateActive?modelThicknessBinding(history):'independent',[history,plateActive]);
  const namedThickness=useMemo(()=>plateActive?inspectNamedThicknessParameter(history):null,[history,plateActive]);
  const [namedParameterDraft,setNamedParameterDraft]=useState({name:'thickness',value:'10'});
  useEffect(()=>{
    if(namedThickness)setNamedParameterDraft({name:namedThickness.name,value:String(namedThickness.valueMm)});
  },[namedThickness]);
  const holes=useMemo(()=>modelHoleValues(history),[history]);
  const displayedActiveHole=activeHole&&Object.hasOwn(holes,activeHole)?activeHole:null;
  const layoutIds=layoutSelected.filter(id=>Object.hasOwn(holes,id));
  const layoutPoints=layoutIds.map(id=>holes[id]);
  const layoutSpan=layoutPoints.length?{
    x:Math.max(...layoutPoints.map(p=>p.x))-Math.min(...layoutPoints.map(p=>p.x)),
    y:Math.max(...layoutPoints.map(p=>p.y))-Math.min(...layoutPoints.map(p=>p.y)),
  }:null;
  const solidProfile=useMemo(()=>previewModelProfile(report),[report]);
  const sketchProfile=useMemo(()=>previewModelSketchProfile(report),[report]);
  const canAuthorExtrusion=!plateAuthored && !!sketchProfile && !pendingImport;
  const canAuthorCut=plateActive && !cutAuthored && !!sketchProfile?.holes.length && !pendingImport;
  // Until an authored cut exists, show the extrusion WITHOUT through-holes.
  // This is disposable tessellation; derived profiles never become CAD authority.
  const geom=useMemo(()=>solidProfile
    ?{...solidProfile,profile:renderSketch||cutActive?solidProfile.profile:
      {...solidProfile.profile,holes:[]}}
    :!plateAuthored&&sketchProfile?{profile:sketchProfile,thickness:0}:null,
    [solidProfile,sketchProfile,renderSketch,cutActive,plateAuthored]);
  const faults=useMemo(()=>modelDiagnostics(report),[report]);
  const plate=report.features.find(f=>f.featureId==='plate');
  const cut=report.features.find(f=>f.featureId==='cut');
  const createExtrusion=():boolean=>{
    try{
      if(!extrudeDraft.trim())throw Error('Enter a positive extrusion distance.');
      const previous=liveHistory.current;
      const next=createModelExtrusion(previous,Number(extrudeDraft));
      const changes=runtime.diff(previous,next);
      acceptHistory(next);setSketchMode(false);setSelected('plate');
      setMessage(`Authored body.plate extrusion (${extrudeDraft} mm) at revision ${next.document.revision}; invalidated ${changes.invalidatedFeatureIds.join(' → ')||'none'}. Tessellated preview only; not exact.`);
      return true;
    }catch(e){setMessage('Extrude refused: '+(e instanceof Error?e.message:String(e)));return false;}
  };
  const createCut=():boolean=>{
    try{
      const previous=liveHistory.current;
      const next=createModelThroughCut(previous);
      const changes=runtime.diff(previous,next);
      acceptHistory(next);setSketchMode(false);setSelected('cut');
      setMessage(`Authored through-cut against body.plate at revision ${next.document.revision}; invalidated ${changes.invalidatedFeatureIds.join(' → ')||'none'}. Native Boolean/STEP pending.`);
      return true;
    }catch(e){setMessage('Cut refused: '+(e instanceof Error?e.message:String(e)));return false;}
  };
  const openFeatureCombo=()=>{
    if(canAuthorExtrusion){setFeatureCombo('extrude');return;}
    if(canAuthorCut){setFeatureCombo('cut');return;}
    setMessage('E tool unavailable: select an admitted sketch without an extrusion, or an uncut body with solved circular holes. Removed features must be restored, not duplicated.');
  };
  const commitFeatureCombo=()=>{
    if(featureCombo==='extrude')createExtrusion();
    if(featureCombo==='cut')createCut();
    // Successful commands call acceptHistory(), which closes this transient dialog;
    // a refused edit leaves the dialog available for correction or cancellation.
  };
  const update=(field:ModelDimension,value:number)=>{
    try {
      const next=editModelDimension(history,field,value);
      const invalidation=runtime.diff(history,next);
      acceptHistory(next);
      setMessage(`Revision ${next.document.revision}: changed ${field}; invalidated ${invalidation.invalidatedFeatureIds.join(' → ') || 'none'} (no exact geometry reused).`);
    } catch(error) {setMessage(error instanceof Error?error.message:'Dimension edit failed');}
  };
  const applyNamedParameter=()=>{
    try{
      const prior=liveHistory.current;
      const next=editNamedThicknessParameter(prior,namedParameterDraft.name.trim(),Number(namedParameterDraft.value));
      const invalidation=runtime.diff(prior,next);
      acceptHistory(next);
      setMessage(`Named parameter committed as ONE undoable INTENT event; invalidated ${invalidation.invalidatedFeatureIds.join(' → ')||'no dependent geometry'}. Native STEP revoked; rebuild required.`);
    }catch(e){setMessage('Named parameter edit refused: '+(e instanceof Error?e.message:String(e)));}
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
  const commitNewCircle=(x:number,y:number,diameter:number):boolean=>{
    try{
      const id='hole.user.'+crypto.randomUUID().replaceAll('-','');
      const result=addModelHole(liveHistory.current,id,x,y,diameter);
      if(result.kind==='refused'){
        setMessage('Add hole refused by SKETCH: '+(result.candidateFeature.diagnostics.join('; ')||result.reason));
        return false;
      }
      acceptHistory(result.history);setSketchMode(true);setActiveHole(id);
      setMessage(`Added ${id} in one undoable sketch transaction; invalidated ${result.invalidation.invalidatedFeatureIds.join(' → ')}. Rebuild STEP.`);
      return true;
    }catch(e){setMessage('Add hole refused: '+String(e));return false;}
  };
  const addHole=()=>{
    const x=Number(holeDraft.x),y=Number(holeDraft.y),diameter=Number(holeDraft.diameter);
    if(Object.values(holeDraft).some(v=>!v.trim())||![x,y,diameter].every(Number.isFinite)){
      setMessage('Add hole refused: enter finite X, Y and diameter.');return;
    }
    commitNewCircle(x,y,diameter);
  };
  const pickCirclePoint=(x:number,y:number)=>{
    const step=nextCircleDrawing(circleDrawing,{x,y});
    if(step.phase==='refused'){setMessage(step.reason);return;}
    if(step.phase==='complete'){
      // Failed profile admission retains the centre so radius can be retried,
      // without an invalid partial circle or phantom revision.
      if(!commitNewCircle(step.circle.x,step.circle.y,step.circle.diameter))
        setMessage('Circle not admitted. Select a smaller radius or a different centre; Escape cancels.');
      return;
    }
    setCircleDrawing(step);
    setMessage('Circle centre selected. Click again to set diameter; Escape cancels without editing the model.');
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
  const applyLayoutResize=()=>{
    try {
      if(Object.values(layoutDraft).some(v=>!v.trim()))
        throw Error('Enter X, Y and bore scaling percentages.');
      const [scaleX,scaleY,radiusScale]=(
        [layoutDraft.scaleX,layoutDraft.scaleY,layoutDraft.radiusScale].map(Number)
      ).map(value=>value/100);
      const result=resizeModelHoleLayout(liveHistory.current,{
        holeIds:layoutIds,scaleX,scaleY,radiusScale,
      });
      if(result.kind==='refused'){
        setMessage('Layout resize refused by SKETCH/profile admission: '+
          (result.candidateFeature.diagnostics.join('; ')||result.reason));
        return;
      }
      acceptHistory(result.history);
      setLayoutDraft({scaleX:'100',scaleY:'100',radiusScale:'100'});
      setSketchMode(true);
      setMessage(`Revision ${result.history.document.revision}: resized ${layoutIds.join(', ')} about their selected centre in ONE undoable SKETCH transaction; invalidated ${result.invalidation.invalidatedFeatureIds.join(' → ')}. Old STEP revoked; rebuild experimental solid.`);
    }catch(e){setMessage('Layout resize refused: '+(e instanceof Error?e.message:String(e)));}
  };
  const removeHole=(id:ModelHole)=>{
    try{
      const result=removeModelHole(liveHistory.current,id);
      if(result.kind==='refused'){setMessage('Remove refused: '+result.reason);return;}
      acceptHistory(result.history);
      setMessage(`Removed ${id}; undo restores the same semantic identity; native STEP requires rebuild.`);
    }catch(e){setMessage('Remove refused: '+String(e));}
  };
  const dragHole=(hole:ModelHole,x:number,y:number,selectedIds:readonly ModelHole[]=[hole])=>{
    try{
      const previous=liveHistory.current;
      const isGroup=selectedIds.length>1&&selectedIds.includes(hole);
      const source=isGroup?modelHoleValues(previous)[hole]:null;
      if(isGroup&&!source)throw Error('Dragged hole no longer exists.');
      const result=isGroup
        ?moveModelHoleGroup(previous,selectedIds,x-source!.x,y-source!.y)
        :moveModelHoleCenter(previous,hole,x,y);
      if(result.kind==='refused'){
        setMessage(`Drag refused: ${result.candidateFeature.diagnostics.join('; ') || result.reason}`);
        return;
      }
      acceptHistory(result.history);setActiveHole(hole);
      setLayoutSelected(isGroup?[...selectedIds]:[hole]);
      setMessage(isGroup
        ?`Moved ${selectedIds.length} selected hole centres together by (${x-source!.x}, ${y-source!.y}) mm in ONE undoable SKETCH transaction. Native STEP requires rebuild.`
        :`Moved ${hole} center to (${x}, ${y}) mm in one undoable sketch transaction; native STEP requires rebuild.`);
    }catch(e){setMessage('Hole drag refused: '+String(e));}
  };
  const dragHoleDiameter=(hole:ModelHole,diameterMm:number)=>{
    try{
      const result=editModelHole(liveHistory.current,hole,'diameter',diameterMm,'require_admissible');
      if(result.kind==='refused'){
        setMessage('Diameter resize refused by SKETCH: '+
          (result.candidateFeature.diagnostics.join('; ')||result.reason));return;
      }
      acceptHistory(result.history);setActiveHole(hole);
      setMessage(`Revision ${result.history.document.revision}: resized ${hole} circular cut to Ø${diameterMm} mm in one admitted RUNTIME/SKETCH transaction. Dependent plate/cut invalidated; old STEP revoked.`);
    }catch(e){setMessage('Diameter resize refused: '+(e instanceof Error?e.message:String(e)));}
  };
  const dragDimension=(id:SketchDimensionHandle,value:number)=>{
    try{
      const result=editModelSketchHandle(liveHistory.current,id,value);
      if(result.kind==='refused'){setMessage('Dimension gesture refused: '+result.reason);return;}
      acceptHistory(result.history);
      setMessage(`Revision ${result.history.document.revision}: direct ${id} → ${value} mm; invalidated ${result.invalidatedFeatureIds.join(' → ')||'none'}. STEP must be rebuilt; preview is not exact.`);
    }catch(e){setMessage('Dimension gesture refused: '+String(e));}
  };
  const removeSelectedFeature=(cascade:boolean)=>{
    try{
      if(!editableLifecycle||!selectedActive)throw Error('Select an active extrusion or cut.');
      const result=removeModelFeature(liveHistory.current,selected,cascade);
      acceptHistory(result.history);
      setMessage(cascade
        ?`Retired ${result.impact.cascadeIds.join(' → ')} in one undoable transaction. Deleted solids and STEP receipts are not current; restore each semantic feature or undo.`
        :`Removed ${selected}; retained ${result.impact.transitiveDependents.join(', ')||'no'} dependent features as editable pending intent. Undo or Restore retains the same feature IDs.`);
    }catch(e){setMessage('Feature removal refused: '+String(e));}
  };
  const restoreSelectedFeature=()=>{
    try{
      if(!editableLifecycle||selectedActive)throw Error('Select a removed extrusion or cut.');
      const next=restoreModelFeature(liveHistory.current,selected);
      acceptHistory(next);
      const state=inspectModelSession(next).features.find(f=>f.featureId===selected)?.status;
      setMessage(`Restored ${selected} with its original semantic identity (${state??'unresolved'}). Native STEP requires a new rebuild.`);
    }catch(e){setMessage('Feature restoration refused: '+String(e));}
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
      const data=serializeModelSession(liveHistory.current);
      // Refuse files larger than the same workbench's 4 MiB import limit.
      checkedModelArchiveSize(data);
      const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download=modelArchiveDownloadName(liveHistory.current);
      try{document.body.appendChild(anchor);anchor.click();}
      finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setNeedsArchiveExport(false);
      setMessage('Model archive download requested. Verify the file exists in Downloads before leaving. The INTENT journal and undo history are included; exact solid/STEP are not.');
    }catch(e){setMessage('Save failed: '+String(e));}
  };
  const openModelFile=async(file:File)=>{
    cancelActiveImport();
    const ticket=loadTicket.current;
    const abort=new AbortController();
    importAbort.current=abort;
    // Never apply an archive until the user explicitly confirms replacement.
    setPendingImport(null);
    setLoadingFile(file.name);
    setMessage(null);
    try{
      if(file.size>MAX_MODEL_ARCHIVE_BYTES)throw Error('Archive exceeds 4 MiB');
      const source=await file.text();
      if(ticket!==loadTicket.current||abort.signal.aborted)return;
      // Full RUNTIME.reopen + undo validation + SKETCH inspection run in a
      // bounded worker, not synchronously on Firefox's main/UI thread.
      const incoming=await validateModelArchiveInWorker(source,{signal:abort.signal});
      if(ticket!==loadTicket.current||abort.signal.aborted)return;
      setPendingImport({file:file.name,history:incoming,origin:'file'});
    }catch(e){
      if(ticket===loadTicket.current&&!abort.signal.aborted)
        setMessage('Open rejected (current model retained): '+String(e));
    }finally{
      if(ticket===loadTicket.current){
        importAbort.current=null;
        setLoadingFile(null);
      }
    }
  };
  const load=(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.target.value=''; // Allow retrying the same rejected file.
    if(file)void openModelFile(file);
  };
  const prepareNewSketch=()=>{
    cancelActiveImport();
    setPendingImport({file:'New sketch-first CAD project',
      history:newModelSketchSession('workbench.sketch.'+crypto.randomUUID()),origin:'new'});
  };
  const useIncoming=()=>{
    if(!pendingImport)return;
    cancelActiveImport();
    acceptHistory(pendingImport.history);
    // Imported archives already exist on disk; newly created projects do not.
    setNeedsArchiveExport(pendingImport.origin==='new');
    const plateRows=modelFeatureTimeline(pendingImport.history).filter(row=>row.featureId==='plate');
    const hasPlate=plateRows.some(row=>row.active);
    // A removed extrusion remains the selected recoverable tombstone after
    // reopening; only a never-extruded sketch selects the source sketch.
    setSketchMode(!hasPlate);setSelected(plateRows.length?'plate':'sketch.plate');
    setActiveHole(null);setPendingImport(null);setFeatureCombo(null);
    setMessage('Model archive reopened with durable feature IDs, undo/redo and no cached meshes.');
  };
  // STEP stays in the RUNTIME live session until the very moment the user
  // downloads it. Edits, undo, archive replacement and provider changes revoke it.
  const downloadCachedStep=()=>{
    const step=nativeSession.current?.currentStep();
    if(!step){
      setNativeReport('No current STEP: build this exact journal revision again.');
      return;
    }
    const current=liveHistory.current;
    const filename=experimentalStepFilename(current.document.projectId,current.document.revision);
    const objectUrl=URL.createObjectURL(new Blob([new Uint8Array(step.bytes)],{type:'model/step'}));
    try{
      const link=document.createElement('a');
      link.href=objectUrl;link.download=filename;
      document.body.appendChild(link);link.click();link.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
    setNativeReport(`Experimental STEP downloaded · revision ${current.document.revision} · ${step.bytes.byteLength} bytes · SHA-256 ${step.sha256}. Same-engine readback only; not independent STEP or production exactness.`);
  };
  const rebuildNative=async(downloadImmediately:boolean)=>{
    const id=++nativeTicket.current;
    const current=liveHistory.current;
    setNativeBusy(true);setNativeReport(null);setNativeEvidence(null);
    try{
      const outcome=await nativeSession.current!.evaluate({
        url:nativeUrl.trim(),token:nativeToken.trim(),
        requestId:`workbench.step.${current.document.revision}.${crypto.randomUUID().replaceAll('-','')}`,
        exportStep:true,
      });
      if(id!==nativeTicket.current)return;
      if(outcome.kind==='unresolved'){
        setNativeReport(`No STEP published: ${outcome.code} — ${outcome.reason}`);
        return;
      }
      // A physical report never overrides the authoritative browser preview;
      // only the live RUNTIME session may release revision-fenced STEP bytes.
      const step=nativeSession.current?.currentStep();
      if(!step || outcome.exactAuthority!==false || outcome.independentInteroperability!==false){
        setNativeReport('No STEP published: stale revision or unacceptable exactness claim.');
        return;
      }
      const observed=outcome.result.observed as {
        source?:{valid?:unknown;solidCount?:unknown;volumeMm3?:unknown}
      }|null;
      const source=observed?.source;
      const solidCount=source?.valid===true && Number.isSafeInteger(source.solidCount) &&
        Number(source.solidCount)>0 ? Number(source.solidCount):null;
      const volumeMm3=source?.valid===true && typeof source.volumeMm3==='number' &&
        Number.isFinite(source.volumeMm3) && source.volumeMm3>0 ? source.volumeMm3:null;
      setNativeEvidence({revision:outcome.source.revision,solidCount,volumeMm3,
        holeCount:outcome.result.intendedPlate?.holes?.length??0});
      if(downloadImmediately) downloadCachedStep();
      else setNativeReport(`Experimental STEP prepared · revision ${outcome.source.revision} · SHA-256 ${step.sha256}. Use Download current STEP to publish these revision-fenced bytes. Same-engine readback only; not independent STEP.`);
    }catch(error){
      if(id===nativeTicket.current)
        setNativeReport('No STEP published: '+(error instanceof Error?error.message:String(error)));
    }finally{
      if(id===nativeTicket.current)setNativeBusy(false);
    }
  };
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(pendingImport){
        if(e.key==='Escape'){e.preventDefault();++loadTicket.current;setPendingImport(null);}
        return;
      }
      if(e.key==='Escape' && featureCombo){
        e.preventDefault();setFeatureCombo(null);return;
      }
      if(e.key==='Escape' && circleDrawing.phase!=='idle'){
        setCircleDrawing({phase:'idle'});
        setMessage('Circle sketch cancelled. No model revision was created.');
        e.preventDefault();return;
      }
      const target=e.target as HTMLElement|null;
      const command=e.ctrlKey||e.metaKey;
      const letter=e.key.toLowerCase();
      // Project shortcuts stay active even with a focused dimension field.
      if(command&&!e.altKey&&letter==='s'){e.preventDefault();save();return;}
      if(command&&!e.altKey&&letter==='o'){e.preventDefault();fileInput.current?.click();return;}
      if(command&&!e.altKey&&letter==='n'){e.preventDefault();prepareNewSketch();return;}
      if(target?.closest('input,textarea,select,[contenteditable=true]'))return;
      if(!command&&!e.altKey&&!e.shiftKey && letter==='e' &&
          circleDrawing.phase==='idle'){
        e.preventDefault();openFeatureCombo();return;
      }
      if(!command)return;
      if(letter==='z'){e.preventDefault();e.shiftKey?redo():undo();}
      if(letter==='y'){e.preventDefault();redo();}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  });
  return <div className="app-shell runtime-shell" data-testid="runtime-panel"
    onDragOver={event=>{
      if(Array.from(event.dataTransfer.types).includes('Files')){
        event.preventDefault();event.dataTransfer.dropEffect='copy';
      }
    }}
    onDrop={event=>{
      if(!Array.from(event.dataTransfer.types).includes('Files')&&!event.dataTransfer.files.length)return;
      event.preventDefault();
      if(event.dataTransfer.files.length!==1){
        setMessage('Open rejected: drop exactly one local model archive. Current model retained.');return;
      }
      void openModelFile(event.dataTransfer.files[0]);
    }}>
    <header className="titlebar">
      <div className="identity"><strong>INTUIT<span>3D</span></strong><small>MODEL-BACKED CAD</small></div>
      <div className="title-divider"/>
      <div className="project-title">{plateAuthored?'Mounting plate':'Sketch project'} · <span data-testid="runtime-revision">revision {report.revision}</span></div>
      <div className="title-actions">
        <button className="ribbon-button" data-testid="runtime-new-plate"
          onClick={()=>{cancelActiveImport();setPendingImport({
            file:'New mounting plate (fresh project)',history:newModelPlateSession('workbench.plate.'+crypto.randomUUID()),origin:'new',
          });}}>
          New plate sketch
        </button>
        <button className="ribbon-button" data-testid="runtime-new-sketch"
          title="New sketch-first project (Ctrl+N); replacement confirmation required"
          onClick={prepareNewSketch}>New sketch-first project</button>
        <button className="ribbon-button" title="Save authoritative model archive (Ctrl+S)" onClick={save}>Save model archive</button>
        <button className="ribbon-button" title="Open authoritative model archive (Ctrl+O), or drop one JSON archive on the workbench" onClick={()=>fileInput.current?.click()}>Open model archive</button>
        <button className="ribbon-button" onClick={()=>{
          if(window.confirm('Leave the model-backed editor? Export your model archive first; the model session will close.'))onClose();
        }}>Preview sandbox</button>
        <input ref={fileInput} type="file" accept=".json,.i3d-model.json,application/json" className="runtime-file-input" onChange={load}
          aria-label="Open INTUIT model archive" />
      </div>
    </header>
    <nav className="toolstrip" aria-label="Model-backed CAD controls">
      <div className="ribbon-group"><span className="ribbon-label">GEOMETRY</span>
        <button className={!sketchMode?'ribbon-button active':'ribbon-button'} data-testid="runtime-mode-solid" onClick={()=>setSketchMode(false)}>Solid</button>
        <button className={sketchMode?'ribbon-button active':'ribbon-button'} data-testid="runtime-mode-sketch" onClick={()=>setSketchMode(true)}>Sketch</button>
        <button type="button" className={circleDrawing.phase!=='idle'?'ribbon-button active':'ribbon-button'}
          data-testid="runtime-circle-tool" aria-pressed={circleDrawing.phase!=='idle'}
          disabled={!geom || !!pendingImport}
          onClick={()=>{
            if(circleDrawing.phase!=='idle'){setCircleDrawing({phase:'idle'});setMessage('Circle sketch cancelled.');}
            else{setSketchMode(true);setCircleDrawing({phase:'centre'});setMessage('Circle: click a centre, then click a radius. Escape cancels.');}
          }}>{circleDrawing.phase!=='idle'?'Cancel circle':'Draw circle · 2 clicks'}</button>
      </div>
      <div className="ribbon-group" data-testid="runtime-feature-authoring"><span className="ribbon-label">SOLID FEATURES</span>
        <label className="runtime-extrusion-distance" aria-label="Extrusion distance">
          <input type="number" step="any" min="0.001" max="10000"
            data-testid="runtime-extrusion-draft" aria-label="New extrusion distance in millimetres"
            value={extrudeDraft} onChange={event=>setExtrudeDraft(event.target.value)}/>
          <small>mm</small>
        </label>
        <button type="button" className="ribbon-button" data-testid="runtime-create-extrusion"
          disabled={!canAuthorExtrusion}
          onClick={createExtrusion}>Extrude sketch</button>
        <button type="button" className="ribbon-button" data-testid="runtime-create-cut"
          disabled={!canAuthorCut}
          onClick={createCut}>Cut holes through body.plate</button>
        <button type="button" className="ribbon-button" data-testid="runtime-feature-combo-open"
          disabled={!canAuthorExtrusion&&!canAuthorCut} onClick={openFeatureCombo}
          title="E opens the context-sensitive feature tool; no document change until confirmation">Extrude / Cut · E</button>
      </div>
      <div className="ribbon-group"><span className="ribbon-label">AUTHORITATIVE HISTORY</span>
        <button className="ribbon-button" disabled={!history.undoStack.length} onClick={undo}>Undo</button>
        <button className="ribbon-button" disabled={!history.redoStack.length} onClick={redo}>Redo</button>
      </div>
      <div className="toolstrip-right"><span className="stage-chip" data-testid="runtime-archive-state">
        {needsArchiveExport?'UNEXPORTED MODEL CHANGES':'ARCHIVE DOWNLOAD REQUESTED / FILE OPENED'}</span>
        <span className="stage-chip" data-testid="runtime-exact-state">
        REAL INTENT + SKETCH · NO EXACT KERNEL</span></div>
    </nav>
    <div className="workspace-grid">
      <aside className="sidepanel browser-panel" aria-label="Authoritative feature browser">
        <div className="panel-heading">SEMANTIC MODEL <span className="panel-count">{report.features.length}</span></div>
        <div className="browser-project">Plate · {report.projectId}</div>
        <div className="browser-subheading">Stable feature IDs</div>
        <div className="feature-list">
          {featureRows.map((row,i)=>{
            const f=report.features.find(item=>item.featureId===row.featureId);
            return <button key={row.featureId} type="button"
              data-testid={`runtime-feature-${row.featureId}`}
              className={`feature-item${selected===row.featureId?' selected':''}${row.active?'':' removed'}`}
              onClick={()=>{setSelected(row.featureId);setCascadeConfirmation(null);if(f?.kind==='sketch')setSketchMode(true);}}>
              <span className="feature-position">{i+1}</span>
              <span className="feature-main"><span>{row.active?f?.kind.toUpperCase():'REMOVED'} · {row.featureId}</span>
                <small>{row.active?f?.status:'tombstone · restorable'}</small></span>
            </button>;
          })}
        </div>
        <div className="browser-footnote">Semantic history is persisted by INTENT. The mesh is disposable; no topology IDs are taken from triangles.</div>
      </aside>
      <main className="editor-center" aria-label="Model-backed plate editor">
        <div className="viewport-header">
          <div className="view-label"><strong>{renderSketch?'Sketch XY · solved profiles':cutActive?'3D cut preview':'3D uncut extrusion preview'}</strong>
            <span>{geom?'Public SKETCH solver + profile admission':'Invalid or unresolved geometry'}</span></div>
          <span className={geom?'preview-tag':'preview-tag stale'}>{geom?'TESSELLATED PREVIEW · NOT EXACT':'NO CURRENT VALID MESH'}</span>
        </div>
        <div className="viewport-stage">
          {geom?<RuntimeGeometryViewport profile={geom.profile} thickness={geom.thickness} sketchMode={renderSketch}
              onHoleMove={circleDrawing.phase==='idle'?dragHole:undefined}
              onHoleDiameterEdit={circleDrawing.phase==='idle'?dragHoleDiameter:undefined}
              onHoleSelect={(id,additive=false)=>{
                setActiveHole(id);
                setLayoutSelected(previous=>additive
                  ?previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]
                  :[id]);
              }} selectedHoleId={displayedActiveHole} selectedHoleIds={layoutIds}
              onDimensionEdit={circleDrawing.phase==='idle'?dragDimension:undefined}
              onThicknessEdit={plateActive?(mm)=>update('thickness',mm):undefined}
              circleDrawing={circleDrawing}
              onCirclePick={circleDrawing.phase!=='idle'?pickCirclePoint:undefined}/>:
            <div className="empty-overlay" data-testid="runtime-empty">Current dimensions cannot produce an admitted sketch profile. No previous mesh is represented as current.</div>}
          {geom&&<div className="runtime-mesh-caption" data-testid="runtime-boundary">
            {renderSketch?'Admitted 2D sketch':cutActive?'Cut-intent preview':'Uncut extrusion preview'} · {geom.profile.outer.length} outline vertices · {geom.profile.holes.length} displayed circular holes · {plateActive?geom.thickness+' mm extrude':'no solid yet'} · no Boolean proof
          </div>}
          {sketchMode&&circleDrawing.phase!=='idle'&&<div className="runtime-mesh-caption" data-testid="runtime-circle-stage" role="status">
            {circleDrawing.phase==='centre'?'CIRCLE · Click a centre inside the plate':
              `CIRCLE · Centre (${circleDrawing.center.x}, ${circleDrawing.center.y}) mm · Click radius`}
            {' · Escape to cancel · no journal edit until second click'}
          </div>}
          <div className="viewport-hint">{renderSketch?(circleDrawing.phase!=='idle'?
            'Circle tool: centre click → radius click; profile admission rejects overlaps or outside holes':
            'Drag edge/diameter handles or hole centers; arrow keys nudge focused dimensions (Shift = 0.1 mm)'):
            'Drag extrusion-thickness grip or use ↑/↓ · Drag background to orbit · Wheel to zoom · Right-drag to pan'}</div>
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
        <div className="inspector-section" data-testid="runtime-feature-lifecycle">
          <div className="section-head">FEATURE LIFECYCLE · INTENT JOURNAL</div>
          {editableLifecycle?(selectedActive?<div className="runtime-hole-add">
            <strong>{selected} · active</strong>
            <p className="microcopy">{removalImpact?.transitiveDependents.length
              ?`Dependent authoring: ${removalImpact.transitiveDependents.join(', ')}. Retain it as pending or explicitly retire it.`
              :'No dependent features. Removing this feature preserves an undoable tombstone.'}</p>
            <button type="button" className="ribbon-button" data-testid="runtime-feature-remove"
              onClick={()=>removeSelectedFeature(false)}>Remove · keep dependents pending</button>
            {!!removalImpact?.transitiveDependents.length&&<button type="button" className="ribbon-button"
              data-testid="runtime-feature-cascade-start" onClick={()=>setCascadeConfirmation(selected)}>
              Remove with dependent features…</button>}
            {cascadeConfirmation===selected&&<div className="runtime-lifecycle-confirm" role="group"
              aria-label="Confirm dependent feature deletion" data-testid="runtime-feature-cascade-confirmation">
              <strong>Retire {removalImpact?.cascadeIds.join(', ')}?</strong>
              <p className="microcopy">One undoable journal transaction. Dependents will not be silently discarded.</p>
              <button type="button" className="ribbon-button" data-testid="runtime-feature-cascade-confirm"
                onClick={()=>removeSelectedFeature(true)}>Confirm cascade removal</button>
              <button type="button" className="ribbon-button" onClick={()=>setCascadeConfirmation(null)}>Cancel</button>
            </div>}
          </div>:<div className="runtime-hole-add">
            <strong>{selected} · removed</strong>
            <p className="microcopy">Original semantic feature identity is preserved in the journal. Restoration may leave unresolved dependencies pending; no stale mesh is exact.</p>
            <button type="button" className="ribbon-button" data-testid="runtime-feature-restore"
              onClick={restoreSelectedFeature}>Restore selected feature</button>
          </div>):<p className="microcopy">Select the extrusion or cut in the feature browser to remove or restore it. Sketch constraints and parameter sources remain protected in this workbench.</p>}
        </div>
        <div className="inspector-section">
          <div className="section-head">EDIT RETROSPECTIVE DIMENSIONS</div>
          {(['width','depth','holeDiameter','holePitch'] as const).map(field=><ScalarInput
             key={field+':'+history.document.revision} field={field}
             value={sketchValues[field]} onCommit={update}/>)}
          {values?<ScalarInput key={'thickness:'+history.document.revision}
             field="thickness" value={values.thickness} onCommit={update}/>:plateAuthored?<p
             data-testid="runtime-removed-extrusion" className="microcopy">
             Extrusion removed. Plate parameters remain authored in the journal;
             restore the original extrusion to edit or rebuild it.
           </p>:<p data-testid="runtime-sketch-first-guidance" className="microcopy">
             No active solid: edit the solved sketch, then choose Extrude sketch and a thickness
             in the Solid Features toolbar. Cut holes only after extrusion.
           </p>}
          {plateActive&&<div className="runtime-hole-add" data-testid="runtime-thickness-binding">
            <strong>Extrusion thickness · {thicknessBinding==='named_parameter'?'linked parameter':'independent dimension'}</strong>
            <span data-testid="runtime-thickness-link-state">
              {thicknessBinding==='named_parameter'
                ? `Linked: ${namedThickness?.name??'unknown'} (parameter.t) → plate.thicknessMm`
                : 'Independent: plate.thicknessMm is an authored numeric dimension'}
            </span>
            {namedThickness&&<div className="runtime-hole-add" data-testid="runtime-named-parameter-editor">
              <strong>Authoritative named source · {namedThickness.featureId}</strong>
              <label className="runtime-native-field">
                <span>Parameter name</span>
                <input type="text" data-testid="runtime-parameter-name" aria-label="Thickness parameter name"
                  autoComplete="off" spellCheck={false} value={namedParameterDraft.name}
                  onChange={e=>setNamedParameterDraft(d=>({...d,name:e.target.value}))}/>
              </label>
              <label className="runtime-native-field">
                <span>Value · mm</span>
                <input type="number" step="any" data-testid="runtime-parameter-value"
                  aria-label="Thickness parameter value in mm" value={namedParameterDraft.value}
                  onChange={e=>setNamedParameterDraft(d=>({...d,value:e.target.value}))}
                  disabled={!namedThickness.literalEditable}/>
              </label>
              <button type="button" className="ribbon-button runtime-native-export"
                data-testid="runtime-parameter-apply"
                disabled={!!pendingImport||!namedThickness.literalEditable||
                  (namedParameterDraft.name===namedThickness.name&&
                   namedParameterDraft.value===String(namedThickness.valueMm))}
                onClick={applyNamedParameter}>Apply parameter name + value</button>
              <p className="microcopy">One revision-fenced INTENT rename/value edit preserves stable parameter and body IDs. A renamed source stays renamed when the extrusion grip moves. Nonliteral formulas are never overwritten here.</p>
            </div>}
            <ParameterFormulaTable history={history} disabled={!!pendingImport}
              onCommit={next=>acceptHistory(next)} onMessage={setMessage}/>
            <button type="button" className="ribbon-button runtime-native-export"
              data-testid="runtime-freeze-thickness"
              disabled={thicknessBinding!=='named_parameter' || !!pendingImport}
              onClick={makeIndependent}>Make thickness independent</button>
            <p className="microcopy">Freeze the current resolved value, release only the witnessed parameter dependency, and retire the unused parameter. One reversible INTENT transaction; later edits change the extrusion directly. This is not a native geometry operation.</p>
          </div>}
          <p className="microcopy">Values edit actual SKETCH constraints or the authoritative INTENT extrusion dimension. The thickness link/independent state is read from the model's binding manifest, never a separate browser flag. Every edit is a revision-fenced undoable journal transaction.</p>
        </div>
        <div className="inspector-section" data-testid="runtime-hole-inspector">
          <div className="section-head">CIRCULAR HOLES · {Object.keys(holes).length}</div>
          <p className="microcopy" data-testid="runtime-active-hole">
            {displayedActiveHole?`Selected circular cut: ${displayedActiveHole}`:'Select a sketch hole centre or amber radial handle to edit it.'}
            {' '}Drag the amber handle to resize a real constrained diameter; arrow keys change by 1 mm (Shift = 0.1 mm).
          </p>
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
          <div className="runtime-hole-add" data-testid="runtime-hole-layout">
            <strong>Retrospective hole layout · one transaction</strong>
            <p className="microcopy">In Sketch, Ctrl+click (Cmd+click on macOS) hole outlines or centre handles to multi-select, then drag any selected centre to move the whole group in ONE undoable, solver-admitted edit. The checkboxes below select the same authored IDs. You can also scale selected spacing and bores about their bounding-box centre. The selected geometry IDs survive undo/reopen; selection itself is local UI state.</p>
            <fieldset className="runtime-layout-selection" aria-label="Hole layout selection">
              <legend>Selected hole IDs · {layoutIds.length}</legend>
              {Object.keys(holes).map(id=><label key={id}>
                <input type="checkbox" data-testid={`runtime-layout-select-${id}`}
                  checked={layoutIds.includes(id)} onChange={e=>setLayoutSelected(previous=>
                    e.target.checked?[...previous.filter(x=>x!==id),id]:previous.filter(x=>x!==id))}/>
                <span>{id}</span>
              </label>)}
            </fieldset>
            <small data-testid="runtime-layout-current-span">
              Current selected span: {layoutSpan?layoutSpan.x.toFixed(3):'—'} × {layoutSpan?layoutSpan.y.toFixed(3):'—'} mm (X × Y)
            </small>
            {(['scaleX','scaleY','radiusScale'] as const).map(field=><label className="runtime-scalar" key={field}>
              <span>{field==='scaleX'?'X spacing':field==='scaleY'?'Y spacing':'Bore diameter'}</span>
              <span className="runtime-scalar-control">
                <input type="number" step="any" min="0.1" max="1000"
                  data-testid={`runtime-layout-${field}`}
                  aria-label={field==='scaleX'?'X spacing percent':field==='scaleY'?'Y spacing percent':'Bore diameter percent'}
                  value={layoutDraft[field]}
                  onChange={e=>setLayoutDraft(previous=>({...previous,[field]:e.target.value}))}/>
                <small>%</small>
              </span>
            </label>)}
            <button type="button" className="ribbon-button runtime-native-export"
              data-testid="runtime-layout-apply" disabled={!!pendingImport||!layoutIds.length}
              onClick={applyLayoutResize}>Apply selected-hole dimensions</button>
            <p className="microcopy">100% preserves that dimension. A successful edit resets factors to 100%, invalidates current STEP and is independently undoable. Inadmissible collisions are refused without altering the document; only the separate experimental provider can make a physical solid.</p>
          </div>
          {Object.keys(holes).map(hole=><div key={hole} className="runtime-hole-editor" data-testid={`runtime-hole-editor-${hole}`}>
            <strong>{hole==='holeA'?'Hole A':hole==='holeB'?'Hole B':'Added hole'} · {hole}</strong>
            {hole!=='holeA'&&hole!=='holeB'&&<button type="button" className="ribbon-button"
              data-testid={`runtime-remove-hole-${hole}`} onClick={()=>removeHole(hole)}>Remove hole</button>}
            {HOLE_FIELDS.map(field=><HoleScalarInput
              key={`${hole}.${field}.${history.document.revision}`}
              hole={hole} field={field} value={holes[hole][field]} onCommit={editHole}/>)}
          </div>)}
          <p className="microcopy">Every added circle has a stable authored ID and fixed-centre/radius constraints. Drag its centre or amber diameter handle, edit its diameter here, undo/redo, or save and reopen the authoritative model. The base A/B diameter handles also drag. Add/remove requires SKETCH admission; preview and native STEP must rebuild after edits.</p>
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
          <label className="runtime-native-field">
            <span><input type="checkbox" data-testid="runtime-native-auto-rebuild"
              checked={autoNative} onChange={e=>{
                setAutoNative(e.target.checked);
                if(!e.target.checked && autoNativeTimer.current!==null){
                  clearTimeout(autoNativeTimer.current);autoNativeTimer.current=null;
                }
              }}/> Live rebuild after each accepted edit (experimental, 250 ms coalescing)</span>
          </label>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-build" onClick={()=>void rebuildNative(false)}
            disabled={!geom || !cutActive || !!pendingImport || nativeBusy || !nativeUrl.trim() || !/^[a-f0-9]{64}$/.test(nativeToken.trim())}>
            {nativeBusy?'Rebuilding experimental solid…':'Rebuild experimental solid + STEP'}
          </button>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-export" onClick={()=>void rebuildNative(true)}
            disabled={!geom || !cutActive || !!pendingImport || nativeBusy || !nativeUrl.trim() || !/^[a-f0-9]{64}$/.test(nativeToken.trim())}>
            {nativeBusy?'Building verified STEP…':'Build and download experimental STEP'}
          </button>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-download-cached"
            disabled={nativeBusy || !!pendingImport || !nativeSession.current?.currentStep()}
            onClick={downloadCachedStep}>Download current STEP</button>
          {nativeBusy&&<button type="button" className="ribbon-button"
            data-testid="runtime-native-cancel" onClick={()=>{invalidateNative();setNativeReport('Native evaluation cancelled; no STEP published.');}}>Cancel native evaluation</button>}
          {nativeEvidence&&<div className="runtime-native-evidence" data-testid="runtime-native-evidence" role="status">
            <strong>Experimental provider result · revision {nativeEvidence.revision}</strong>
            <span>Through-holes: {nativeEvidence.holeCount} · Solids: {nativeEvidence.solidCount??'not reported'} · Volume: {nativeEvidence.volumeMm3===null?'not reported':nativeEvidence.volumeMm3.toFixed(3)+' mm³'}</span>
            <small>Provider-reported metrics when available; host STEP readback is same-engine only. Not production exactness or independent external CAD verification.</small>
          </div>}
          {nativeReport&&<p className="microcopy" role="status" data-testid="runtime-native-result">{nativeReport}</p>}
          <p className="microcopy">Native build requires an authored extrusion and body-targeted cut; a visible sketch circle alone is not a physical Boolean. The persistent RUNTIME session invalidates native receipts on every model edit, undo/redo, archive replacement or provider change. Optional live rebuild evaluates only admitted sketch revisions after coalescing edits; invalid profiles remain pending. Build-only keeps same-engine-verified bytes available for the current revision; download rechecks the authoritative journal. No preview tessellation is exported as STEP. <strong>Experimental OCP is not production-qualified CAD.</strong></p>
        </div>
        <div className="inspector-section diagnostics">
          <div className="section-head">EVALUATION <span>{faults.length} pending / invalid</span></div>
          {report.features.map(f=><div className="runtime-diagnostic" key={f.featureId}>
            <strong>{f.featureId}</strong> <span data-testid={`runtime-status-${f.featureId}`}>{f.status}</span>
            {f.diagnostics.map((d,i)=><small key={i}>{d}</small>)}
          </div>)}
          <p className="microcopy">Extrude: {plate?.status??'not authored'}. Cut: {cut?.status??'not authored'}. The viewport is a tessellated preview only. Native STEP, when separately rebuilt, remains experimental with same-engine readback rather than production exactness.</p>
        </div>
        {message&&<div className="runtime-message" role="status">{message}</div>}
      </aside>
    </div>
    <footer className="statusbar">LOCAL MODEL + SKETCH · INTENT JOURNAL · PREVIEW ONLY · DROP MODEL JSON TO OPEN
      <span className="status-spacer"/> {report.revision} accepted journal events · Exact geometry: unavailable</footer>
    {featureCombo&&!pendingImport&&<div className="recovery-backdrop"><form
      className="recovery-dialog runtime-feature-combo" role="dialog" aria-modal="true"
      aria-label="Extrude or cut feature" data-testid="runtime-feature-combo"
      onSubmit={event=>{event.preventDefault();commitFeatureCombo();}}
      onKeyDown={event=>{
        // CDP/keyboard accessibility: number inputs do not consistently
        // synthesize a form submit from Enter. Commit explicitly, once.
        if(event.key==='Enter' && !event.nativeEvent.isComposing){
          event.preventDefault();commitFeatureCombo();
        }
      }}>
      <h2>{featureCombo==='extrude'?'Extrude admitted sketch':'Cut circular holes through body.plate'}</h2>
      {featureCombo==='extrude'?<label className="runtime-combo-distance">
        <span>Extrusion distance · mm</span>
        <input type="number" step="any" min="0.001" max="10000" autoFocus
          data-testid="runtime-combo-distance" aria-label="Combo extrusion distance"
          value={extrudeDraft} onChange={event=>setExtrudeDraft(event.target.value)}/>
      </label>:<p>Target: <strong>body.plate</strong>. Source: solved circular holes in <strong>sketch.plate</strong>.
        The Boolean and STEP remain pending a native provider; no exact geometry will be claimed.</p>}
      <p className="microcopy">This commits one authoritative INTENT feature with RUNTIME validation and undo.
        Press Enter to confirm or Escape to cancel; no operation is authored when the dialog opens.</p>
      <div className="recovery-actions">
        <button type="button" data-testid="runtime-feature-combo-cancel"
          onClick={()=>setFeatureCombo(null)}>Cancel</button>
        <button type="submit" data-testid="runtime-feature-combo-confirm">
          {featureCombo==='extrude'?'Create extrusion':'Create through-cut'}</button>
      </div>
    </form></div>}
    {loadingFile&&<div className="recovery-backdrop"><section className="recovery-dialog"
      role="dialog" aria-modal="true" aria-label="Validating incoming model archive"
      data-testid="runtime-import-processing">
      <h2>Validating model archive…</h2>
      <p>Checking {loadingFile} and its undo history in an isolated worker.
        Your current model remains unchanged.</p>
      <div className="recovery-actions">
        <button type="button" data-testid="runtime-import-processing-cancel"
          onClick={()=>{cancelActiveImport();setMessage('Archive import cancelled; current model retained.');}}>
          Cancel import</button>
      </div>
    </section></div>}
    {pendingImport&&<div className="recovery-backdrop"><section className="recovery-dialog" role="dialog"
      aria-modal="true" aria-label="Review incoming model archive" data-testid="runtime-import-review">
      <h2>Replace model session?</h2>
      <p data-testid="runtime-import-identity">Current: {modelArchiveSummary(history).projectId} · revision {modelArchiveSummary(history).revision} · {modelArchiveSummary(history).undoFrames} undo / {modelArchiveSummary(history).redoFrames} redo frames.</p>
      <p data-testid="runtime-import-incoming">Incoming: {modelArchiveSummary(pendingImport.history).projectId} · revision {modelArchiveSummary(pendingImport.history).revision} · {modelArchiveSummary(pendingImport.history).undoFrames} undo / {modelArchiveSummary(pendingImport.history).redoFrames} redo frames. Source: {pendingImport.file}.</p>
      {needsArchiveExport&&<p data-testid="runtime-import-unexported"><strong>Current model has changes not exported since the last download request.</strong> Cancel and save its archive first to retain them.</p>}
      <p>Replace discards the current in-memory undo/redo journal. The incoming archive was validated in an isolated worker; no cached B-rep, STEP or exact-solid authority is imported.</p>
      <div className="recovery-actions">
        <button onClick={()=>{cancelActiveImport();setPendingImport(null);}}>Cancel</button>
        <button onClick={useIncoming}>Replace with model archive</button>
      </div>
    </section></div>}
  </div>;
}
