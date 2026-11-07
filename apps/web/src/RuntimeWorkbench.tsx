import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  addModelHole, createModelExtrusion, createModelThroughCut, editModelDimension, editModelHole, editModelSketchHandle, inspectModelSession, modelDiagnostics, modelDimensionValues, modelSketchDimensionValues, modelFeatureRemovalImpact, modelFeatureTimeline, modelHoleValues, moveModelFeature, moveModelHoleCenter, patternModelHoles, removeModelFeature, removeModelHole, resizeModelHoleLayout, restoreModelFeature,
  makeModelThicknessIndependent, modelThicknessBinding, newModelPlateSession, newModelSketchSession, previewModelProfile, previewModelSketchProfile, redoModelSession,
  reopenModelSession, runtime, serializeModelSession, undoModelSession,
  type ModelDimension, type ModelHole, type ModelHoleField, type ModelSession,
} from './runtimeSession';
import { RuntimeGeometryViewport } from './RuntimeGeometryViewport';
import type { SketchDimensionHandle } from './runtimeSketchHandles';
import { nextCircleDrawing, type CircleDrawingState } from './circleDrawing';
import { createLivePlateSession } from '@intuit3d/workflow-runtime/live-plate-session';
import { experimentalStepFilename } from './localNativeStep';

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
  const [selected,setSelected]=useState('plate');
  const [activeHole,setActiveHole]=useState<string|null>(null);
  const [layoutSelected,setLayoutSelected]=useState<string[]>(['holeA','holeB']);
  const [layoutDraft,setLayoutDraft]=useState({scaleX:'120',scaleY:'100',radiusScale:'100'});
  const [cascadeConfirmation,setCascadeConfirmation]=useState<string|null>(null);
  const [timeline,setTimeline]=useState<'authored'|'evaluated'>('authored');
  const [message,setMessage]=useState<string|null>(null);
  const [pendingImport,setPendingImport]=useState<{file:string;history:ModelSession}|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const loadTicket=useRef(0);
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
    setHistory(next);
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
  useEffect(()=>()=>{if(autoNativeTimer.current!==null)clearTimeout(autoNativeTimer.current);nativeSession.current?.cancel();},[]);
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
  // Until an authored cut exists, show the extrusion WITHOUT through-holes.
  // This is disposable tessellation; derived profiles never become CAD authority.
  const geom=useMemo(()=>solidProfile
    ?{...solidProfile,profile:renderSketch||cutActive?solidProfile.profile:
      {...solidProfile.profile,holes:[]}}
    :sketchProfile?{profile:sketchProfile,thickness:0}:null,
    [solidProfile,sketchProfile,renderSketch,cutActive]);
  const faults=useMemo(()=>modelDiagnostics(report),[report]);
  const plate=report.features.find(f=>f.featureId==='plate');
  const cut=report.features.find(f=>f.featureId==='cut');
  const createExtrusion=()=>{
    try{
      if(!extrudeDraft.trim())throw Error('Enter a positive extrusion distance.');
      const previous=liveHistory.current;
      const next=createModelExtrusion(previous,Number(extrudeDraft));
      const changes=runtime.diff(previous,next);
      acceptHistory(next);setSketchMode(false);setSelected('plate');
      setMessage(`Authored body.plate extrusion (${extrudeDraft} mm) at revision ${next.document.revision}; invalidated ${changes.invalidatedFeatureIds.join(' → ')||'none'}. Tessellated preview only; not exact.`);
    }catch(e){setMessage('Extrude refused: '+(e instanceof Error?e.message:String(e)));}
  };
  const createCut=()=>{
    try{
      const previous=liveHistory.current;
      const next=createModelThroughCut(previous);
      const changes=runtime.diff(previous,next);
      acceptHistory(next);setSketchMode(false);setSelected('cut');
      setMessage(`Authored through-cut against body.plate at revision ${next.document.revision}; invalidated ${changes.invalidatedFeatureIds.join(' → ')||'none'}. Native Boolean/STEP pending.`);
    }catch(e){setMessage('Cut refused: '+(e instanceof Error?e.message:String(e)));}
  };
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
  const dragHole=(hole:ModelHole,x:number,y:number)=>{
    try{
      const result=moveModelHoleCenter(liveHistory.current,hole,x,y);
      if(result.kind==='refused'){setMessage(`Drag refused: ${result.candidateFeature.diagnostics.join('; ') || result.reason}`);return;}
      acceptHistory(result.history);setActiveHole(hole);
      setMessage(`Moved ${hole} center to (${x}, ${y}) mm in one undoable sketch transaction; native STEP requires rebuild.`);
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
    acceptHistory(pendingImport.history);
    const hasPlate=modelFeatureTimeline(pendingImport.history).some(row=>row.featureId==='plate'&&row.active);
    setSketchMode(!hasPlate);setSelected(hasPlate?'plate':'sketch.plate');
    setActiveHole(null);setPendingImport(null);
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
      if(pendingImport)return;
      if(e.key==='Escape' && circleDrawing.phase!=='idle'){
        setCircleDrawing({phase:'idle'});
        setMessage('Circle sketch cancelled. No model revision was created.');
        e.preventDefault();return;
      }
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
        <button className="ribbon-button" data-testid="runtime-new-sketch"
          onClick={()=>{++loadTicket.current;setPendingImport({
            file:'New sketch-first CAD project',history:newModelSketchSession('workbench.sketch.'+crypto.randomUUID()),
          });}}>New sketch-first project</button>
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
          disabled={plateAuthored||!sketchProfile||!!pendingImport}
          onClick={createExtrusion}>Extrude sketch</button>
        <button type="button" className="ribbon-button" data-testid="runtime-create-cut"
          disabled={!plateActive||cutAuthored||!sketchProfile?.holes.length||!!pendingImport}
          onClick={createCut}>Cut holes through body.plate</button>
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
              onHoleSelect={setActiveHole} selectedHoleId={displayedActiveHole}
              onDimensionEdit={circleDrawing.phase==='idle'?dragDimension:undefined}
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
             field="thickness" value={values.thickness} onCommit={update}/>:<p
             data-testid="runtime-sketch-first-guidance" className="microcopy">
             No active solid: edit the solved sketch, then choose Extrude sketch and a thickness
             in the Solid Features toolbar. Cut holes only after extrusion.
           </p>}
          {plateActive&&<div className="runtime-hole-add" data-testid="runtime-thickness-binding">
            <strong>Extrusion thickness · {thicknessBinding==='named_parameter'?'linked parameter':'independent dimension'}</strong>
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
            <p className="microcopy">Select authored holes, then scale their centre spacing and bore diameters about the selected bounding-box centre. This is a one-shot dimensional edit, not an associative pattern. Selected IDs survive undo and model reopening.</p>
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
