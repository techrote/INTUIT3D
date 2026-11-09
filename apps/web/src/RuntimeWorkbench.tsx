import { useEffect, useMemo, useRef, useState } from 'react';
import * as model from '@intuit3d/model';
import type { ChangeEvent } from 'react';
import {
  addModelHole, createModelExtrusion, createModelThroughCut, editModelDimension, editModelHole, editModelSketchHandle, inspectModelSession, modelDiagnostics, modelDimensionValues, modelSketchDimensionValues, modelFeatureRemovalImpact, modelFeatureTimeline, modelHoleValues, modelHoleIsCartesian, moveModelFeature, moveModelHoleCenter, moveModelHoleGroup, nudgeModelHoleSelection, patternModelHoles, removeModelFeature, removeModelHole, resizeModelHoleLayout, restoreModelFeature,
  editNamedThicknessParameter, inspectNamedThicknessParameter, makeModelThicknessIndependent, modelThicknessBinding, newModelPlateSession, newModelSketchSession, newModelEmptySketchSession, modelSketchHasPlateDimensions, modelSketchIsEmpty, previewModelProfile, previewModelSketchProfile, redoModelSession,
  runtime, serializeModelSession, undoModelSession,
  type ModelDimension, type ModelHole, type ModelHoleField, type ModelSession,
} from './runtimeSession';
import { RuntimeGeometryViewport } from './RuntimeGeometryViewport';
import {
  selectedGeneralProfile, generalProfileBodies, authorGeneralProfileExtrusion,
  authorGeneralProfileCut, redimensionGeneralProfileExtrusion,
} from './generalProfileAuthoring';
import { BlankSketchCanvas } from './BlankSketchCanvas';
import {appendBlankContourPoint,undoBlankContourVertex,placeBlankContourPointer,type BlankContourDraft,type SketchLocalPoint} from './blankContourDraft';
import {commitModelBlankContour,startModelBlankContour,structuralContourRuntimeAvailable,inspectModelClosedContour,dragModelClosedContourVertex} from './closedContourBridge';
import {ClosedContourVertexEditor} from './ClosedContourVertexEditor';
import {insertModelContourTab,previewModelContourTab,inspectModelTabbedContour,editModelTabbedVertex} from './tabbedContourBridge';
import {inspectModelContourEdges,dragModelClosedContourEdge,offsetModelClosedContourEdge}
  from './closedContourEdgeBridge';
import { HistoricalEditInspector } from './HistoricalEditInspector';
import { ProfileNumericEditor } from './ProfileNumericEditor';
import { SelectedEdgeHoleEditor } from './SelectedEdgeHoleEditor';
import { selectModelProfileAtPointer, inspectModelPointerProfile, dragModelPointerProfileHandle } from './pointerProfileBridge';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import { SolidHoleQuickEdit } from './SolidHoleQuickEdit';
import { removeModelEdgeHole } from './selectedEdgeHole';
import { ParameterFormulaTable } from './ParameterFormulaTable';
import type { SketchDimensionHandle } from './runtimeSketchHandles';
import { nextCircleDrawing, type CircleDrawingState } from './circleDrawing';
import { patternModelCircularHoles } from './circularHolePattern';
import { transformSelectedModelHoles } from './rigidHoleTransform';
import { stampSelectedModelHoles, removeSelectedModelHoles } from './selectedHoleStamp';
import { createLivePlateSession } from '@intuit3d/workflow-runtime/live-plate-session';
import { sourceBoundStepFilename } from './localNativeStep';
import { buildPinnedStepEvidenceZip, pinnedStepEvidenceFilename } from './stepEvidenceBundle';
import { MAX_MODEL_ARCHIVE_BYTES, validateModelFileInWorker, type ModelImportStage } from './modelArchiveImport';
import { checkedModelArchiveSize, modelArchiveDownloadName, modelArchiveSummary } from './modelFileLifecycle';
import { deleteLocalRecovery, listLocalRecoveries, readLocalRecovery, storeLocalRecovery, type LocalRecoverySummary } from './modelRecovery';
import { appendImportTrace, serializeImportTrace, type ImportTraceEntry, type ImportTraceStage } from './importTrace';
import { describeNativeStep } from './nativeStepStatus';

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
  const [blankDraft,setBlankDraft]=useState<BlankContourDraft|null>(null);
  const [holeDraft,setHoleDraft]=useState({x:'60',y:'20',diameter:'10'});
  const [arrayDraft,setArrayDraft]=useState({sourceHoleId:'holeA',rows:'2',columns:'2',pitchXmm:'20',pitchYmm:'20'});
  const [orbitDraft,setOrbitDraft]=useState({sourceHoleId:'holeA',instances:'3',pivotXmm:'60',pivotYmm:'40',sweepDegrees:'360'});
  const [extrudeDraft,setExtrudeDraft]=useState('8');
  const [generalDraft,setGeneralDraft]=useState({
    extrudeId:'extrude.part',bodyId:'body.part',cutId:'cut.part',depth:'8',
  });
  // A cut cannot silently choose the first/only body: this is an explicit
  // engineer decision which is discarded on a failed source fence.
  const [generalTargetId,setGeneralTargetId]=useState('');
  // Presentation-only E combo: the actual feature is committed by RUNTIME/INTENT.
  const [featureCombo,setFeatureCombo]=useState<'extrude'|'cut'|null>(null);
  const [selected,setSelected]=useState('plate');
  // A selected contour and its handles are ephemeral, source-fenced SKETCH
  // projections. They are never duplicated into model or native authority.
  const [profilePickMode,setProfilePickMode]=useState(false);
  const [pointerSelection,setPointerSelection]=useState<SelectedProfileSelection|null>(null);
  const [pointerHandleId,setPointerHandleId]=useState('');
  const [selectedContourEdgeId,setSelectedContourEdgeId]=useState('');
  const [edgeOffsetDraft,setEdgeOffsetDraft]=useState('10');
  // Uncommitted pointer vertices are ephemeral; no model/solver write until Commit.
  const [tabDraft,setTabDraft]=useState<{
    edgeId:string;expectedArchive:string;points:SketchLocalPoint[];
  }|null>(null);
  // Whole canonical archive at semantic selection. Reject divergent histories
  // even when their numeric revision and sketch signature happen to agree.
  const [pointerSourceArchive,setPointerSourceArchive]=useState<string|null>(null);
  const [activeHole,setActiveHole]=useState<string|null>(null);
  const [layoutSelected,setLayoutSelected]=useState<string[]>(['holeA']);
  const [layoutDraft,setLayoutDraft]=useState({scaleX:'120',scaleY:'100',radiusScale:'100'});
  const [rigidDraft,setRigidDraft]=useState({translateXmm:'0',translateYmm:'0',rotateDegrees:'90'});
  const [stampDraft,setStampDraft]=useState({deltaXmm:'20',deltaYmm:'0'});
  const [cascadeConfirmation,setCascadeConfirmation]=useState<string|null>(null);
  const [timeline,setTimeline]=useState<'authored'|'evaluated'>('authored');
  const [message,setMessage]=useState<string|null>(null);
  useEffect(()=>{
    if(!tabDraft)return;
    const cancel=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();setTabDraft(null);
        setMessage('Uncommitted tab cancelled; no CAD revision created.');
      }
    };
    window.addEventListener('keydown',cancel);
    return()=>window.removeEventListener('keydown',cancel);
  },[tabDraft]);
  const [pendingImport,setPendingImport]=useState<{file:string;history:ModelSession;origin:'file'|'new'|'recovery'}|null>(null);
  // The browser cannot prove that a requested file download reached the OS.
  const [needsArchiveExport,setNeedsArchiveExport]=useState(true);
  // Automatic *local* recovery copies are serialized RUNTIME archives, not a
  // second authoritative model. A fresh starter must never overwrite a prior
  // user session until the user has actually authored a change.
  const recoverySessionId=useRef('session.'+crypto.randomUUID());
  const [recoveryActivated,setRecoveryActivated]=useState(false);
  const [recoveryEntries,setRecoveryEntries]=useState<LocalRecoverySummary[]>([]);
  const [recoveryStatus,setRecoveryStatus]=useState<'checking'|'ready'|'error'>('checking');
  const [recoveryError,setRecoveryError]=useState<string|null>(null);
  const recoveryWriteQueue=useRef<Promise<void>>(Promise.resolve());
  const refreshRecovery=async()=>{
    try{
      const entries=await listLocalRecoveries();
      setRecoveryEntries(entries);setRecoveryStatus('ready');setRecoveryError(null);
    }catch(e){setRecoveryStatus('error');setRecoveryError(String(e));}
  };
  useEffect(()=>{void refreshRecovery();},[]);
  useEffect(()=>{
    if(!recoveryActivated)return;
    const snapshot=history,requested=!needsArchiveExport;
    // Coalesce direct-manipulation bursts and serialize all writes for this
    // browser session, so a slower older revision cannot win the race.
    const timer=setTimeout(()=>{
      recoveryWriteQueue.current=recoveryWriteQueue.current.catch(()=>{}).then(async()=>{
        const archive=serializeModelSession(snapshot);
        await storeLocalRecovery(snapshot,recoverySessionId.current,archive,requested);
        await refreshRecovery();
      }).catch(e=>{
        setRecoveryStatus('error');
        setRecoveryError('Automatic local recovery failed: '+String(e)+
          '. Export a model archive to protect this session.');
      });
    },450);
    return()=>clearTimeout(timer);
  },[history,needsArchiveExport,recoveryActivated]);
  const fileInput=useRef<HTMLInputElement>(null);
  const loadTicket=useRef(0);
  const importAbort=useRef<AbortController|null>(null);
  const [loadingFile,setLoadingFile]=useState<string|null>(null);
  const [importStage,setImportStage]=useState<ModelImportStage>('reading');
  // The trace never retains filenames, model text, IDs or journal payloads.
  const [importTrace,setImportTrace]=useState<readonly ImportTraceEntry[]>([]);
  const importStarted=useRef<number|null>(null);
  const noteImportStage=(stage:ImportTraceStage)=>{
    if(importStarted.current===null)return;
    const elapsed=Math.max(0,Math.round(performance.now()-importStarted.current));
    setImportTrace(previous=>appendImportTrace(previous,stage,elapsed));
    console.info('INTUIT3D_IMPORT_STAGE '+stage+' +'+elapsed+'ms');
  };
  const downloadImportTrace=()=>{
    try{
      const data=serializeImportTrace(importTrace);
      const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='intuit3d-import-stage-trace.json';
      try{document.body.appendChild(anchor);anchor.click();}
      finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setMessage('Privacy-safe import trace download requested. It contains stage labels and elapsed times only, never the selected archive. Verify the download before sharing.');
    }catch(e){setMessage('Import trace unavailable: '+String(e));}
  };
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
  // UI readiness only. The synchronous capture rechecks the live journal at click.
  const [pinnedEvidenceReady,setPinnedEvidenceReady]=useState(false);
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
    setPinnedEvidenceReady(false);
    setNativeReport(null);
    setNativeEvidence(null);
  };
  const acceptHistory=(next:ModelSession)=>{
    liveHistory.current=next;
    invalidateNative();
    setCascadeConfirmation(null);
    setCircleDrawing({phase:'idle'});
    setBlankDraft(null);
    setTabDraft(null);
    setFeatureCombo(null);
    setHistory(next);
    setRecoveryActivated(true);
    setNeedsArchiveExport(true);
    // An accepted journal change may trigger a new native evaluation, but a
    // burst of sketch drags coalesces and unsupported profiles stay pending.
    if(autoNative && nativeUrl.trim() && /^[a-f0-9]{64}$/.test(nativeToken.trim()) &&
        previewModelProfile(inspectModelSession(next)) &&
        modelFeatureTimeline(next).some(row=>row.featureId==='cut'&&row.active)){
      const expectedTicket=nativeTicket.current;
      autoNativeTimer.current=setTimeout(()=>{
        autoNativeTimer.current=null;
        if(expectedTicket===nativeTicket.current)void rebuildNative('prepare');
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
  const generalBodies=useMemo(()=>generalProfileBodies(history),[history]);
  const generalSelectedBody=generalBodies.find(b=>b.extrudeId===selected) ??
    (!plateActive?generalBodies[0]??null:null);
  const generalSolidReport=generalSelectedBody
    ?report.features.find(f=>f.featureId===generalSelectedBody.extrudeId):null;
  const generalSolid=generalSolidReport?.status==='preview_only'&&
    generalSolidReport.profile?.status==='analytic_profile_only'&&generalSelectedBody
      ?{profile:generalSolidReport.profile,thickness:generalSelectedBody.depthMm}:null;
  // A pending cut's RUNTIME report need not expose bodyId. Match its
  // authoritative INTENT write target to the exact selected body instead.
  const generalCutActive=!!generalSelectedBody&&model.featuresOf(history.document).some(f=>
    f.kind==='cut'&&f.writeTargets.length===1&&
    f.writeTargets[0]===generalSelectedBody.bodyId&&
    report.features.some(r=>r.featureId===f.id&&r.status==='pending_exact_provider'));
  const renderSketch=sketchMode||(!plateActive&&!generalSolid);
  const selectedActive=featureRows.some(row=>row.featureId===selected&&row.active);
  const editableLifecycle=selected==='plate'||selected==='cut';
  const removalImpact=selectedActive&&editableLifecycle
    ?modelFeatureRemovalImpact(history,selected):null;
  const values=useMemo(()=>plateActive&&modelSketchHasPlateDimensions(history)?modelDimensionValues(history):null,[history,plateActive]);
  const legacySketch=useMemo(()=>modelSketchHasPlateDimensions(history),[history]);
  const emptySketch=useMemo(()=>modelSketchIsEmpty(history),[history]);
  const sketchValues=useMemo(()=>legacySketch?modelSketchDimensionValues(history):null,[history,legacySketch]);
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
  const pointerInventory=useMemo(()=>{
    if(!pointerSelection)return null;
    try{return inspectModelPointerProfile(history,pointerSelection);}
    catch{return null;} // A separate edit/undo/archive replacement expires the source fence.
  },[history,pointerSelection]);
  const pointerHandles=pointerInventory?.kind==='pointer_editable_handles'
    ?pointerInventory.handles:[];
  const closedInventory=useMemo(()=>{
    if(!pointerSelection||!pointerSourceArchive||
        pointerSourceArchive!==serializeModelSession(history))return null;
    try{return inspectModelClosedContour(history,pointerSelection);}
    catch{return null;}
  },[history,pointerSelection,pointerSourceArchive]);
  const closedEdges=useMemo(()=>{
    if(!closedInventory||!pointerSelection)return null;
    try{return inspectModelContourEdges(history,pointerSelection);}
    catch{return null;}
  },[history,pointerSelection,closedInventory]);
  const tabbedInventory=useMemo(()=>{
    if(!pointerSelection||!pointerSourceArchive||
      pointerSourceArchive!==serializeModelSession(history))return null;
    try{return inspectModelTabbedContour(history,pointerSelection);}
    catch{return null;}
  },[history,pointerSelection,pointerSourceArchive]);
  const closedHandle=closedInventory?.handles.find(h=>h.handleId===pointerHandleId)??null;
  const tabbedHandle=tabbedInventory?.handles.find(h=>h.handleId===pointerHandleId)??null;
  const tabSourceEdge=tabDraft?closedEdges?.edges.find(edge=>edge.edgeId===tabDraft.edgeId):null;
  // SKETCH-owned preflight is read-only, not a journal event or physical evidence.
  const tabPreflight=useMemo(()=>{
    if(!tabDraft||tabDraft.points.length!==2||!pointerSelection)return null;
    return previewModelContourTab(history,pointerSelection,tabDraft.edgeId,
      [tabDraft.points[0],tabDraft.points[1]],tabDraft.expectedArchive);
  },[history,pointerSelection,tabDraft]);
  const pointerDragHandle=pointerHandles.find(h=>h.handleId===pointerHandleId)??null;
  const contourVertexHandles=closedInventory?.handles??tabbedInventory?.handles??[];
  const selectContourVertex=(handleId:string)=>{
    // Each marker is sourced from a solved SKETCH inventory. Refuse selections
    // carried over from a different archive or an intervening journal event.
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile||
      liveHistory.current!==history||
      pointerSourceArchive!==serializeModelSession(liveHistory.current)||
      !contourVertexHandles.some(handle=>handle.handleId===handleId)){
      setMessage('Vertex selection expired; reselect the current solved contour.');
      return;
    }
    setPointerHandleId(handleId);
    setSelectedContourEdgeId('');
    setMessage('Selected solver-owned vertex '+handleId+
      '. Edit exact X/Y or drag the amber handle; selection does not change the journal.');
  };
  const generalCandidate=useMemo(()=>{
    if(!pointerSelection||!pointerSourceArchive)return null;
    try{return selectedGeneralProfile(history,pointerSelection,pointerSourceArchive);}
    catch{return null;}
  },[history,pointerSelection,pointerSourceArchive]);
  const canGeneralCommit=!!generalCandidate&&!pendingImport&&!loadingFile;
  const canAuthorExtrusion=!plateAuthored && !generalBodies.length && !!sketchProfile && !pendingImport;
  const canAuthorCut=plateActive && !cutAuthored && !!sketchProfile?.holes.length && !pendingImport;
  // Until an authored cut exists, show the extrusion WITHOUT through-holes.
  // This is disposable tessellation; derived profiles never become CAD authority.
  const geom=useMemo(()=>{
    // A generalized body is visualized only from the admitted RUNTIME
    // profile. Its tessellation is NOT a STEP or verified Boolean.
    if(generalSolid){
      return {...generalSolid,profile:renderSketch||generalCutActive?generalSolid.profile:
        {...generalSolid.profile,holes:[]}};
    }
    return solidProfile
      ?{...solidProfile,profile:renderSketch||cutActive?solidProfile.profile:
        {...solidProfile.profile,holes:[]}}
      :!plateAuthored&&sketchProfile?{profile:sketchProfile,thickness:0}:null;
  },[solidProfile,sketchProfile,renderSketch,cutActive,plateAuthored,
    generalSolid,generalCutActive]);
  // RUNTIME, not a React success flag, owns STEP/source/backend provenance.
  // Read only when the journal or an attempt changes; never sample a stale
  // receipt merely because the model revision number still matches.
  const nativeSnapshot=useMemo(()=>{
    const state=nativeSession.current!.refresh();
    const backend=state.stepAvailability==='unavailable'?null:
      nativeSession.current!.currentStepReceipt()?.producer.backend??null;
    return {stepAvailability:state.stepAvailability,
      indicator:describeNativeStep(state,backend,Boolean(geom&&cutActive&&!generalSolid))};
  },[history,geom,cutActive,nativeBusy,nativeReport,nativeEvidence,pinnedEvidenceReady,nativeUrl,nativeToken]);
  const nativeIndicator=nativeSnapshot.indicator;
  const faults=useMemo(()=>modelDiagnostics(report),[report]);
  const plate=report.features.find(f=>f.featureId==='plate');
  const cut=report.features.find(f=>f.featureId==='cut');
  const pickProfile=(x:number,y:number)=>{
    try{
      const result=selectModelProfileAtPointer(liveHistory.current,x,y);
      if(result.kind!=='selected'){
        setMessage('Profile selection '+(result.kind==='miss'?'missed: ':'refused: ')+result.reason+
          '. Click strictly inside a solved contour, away from edges/holes.');
        return;
      }
      setPointerSelection(result.selection);
      setPointerSourceArchive(serializeModelSession(liveHistory.current));
      setPointerHandleId('');
      setSelectedContourEdgeId('');
      setProfilePickMode(false);
      setMessage('Selected solver-owned profile '+result.profile.semanticProfileId+
        '. Choose a semantic dimension/centre handle in the inspector before dragging it. Analytic preview only.');
    }catch(e){setMessage('Profile selection refused: '+String(e));}
  };
  const dragProfile=(handleId:string,x:number,y:number)=>{
    if(!pointerSelection||pendingImport)return;
    try{
      const result=dragModelPointerProfileHandle(liveHistory.current,pointerSelection,handleId,{x,y});
      acceptHistory(result.history);
      setPointerSelection(result.selection);
      setPointerSourceArchive(serializeModelSession(result.history));
      setMessage('Edited selected semantic profile handle '+handleId+' in one undoable RUNTIME transaction at revision '+
        result.history.document.revision+'. Invalidated: '+
        (result.invalidatedFeatureIds.join(' → ')||'none')+'. Native STEP revoked; preview not exact.');
    }catch(e){setMessage('Profile handle drag refused; original journal retained: '+String(e));}
  };
  const dragDrawnVertex=(handleId:string,x:number,y:number)=>{
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    try{
      if(liveHistory.current!==history)throw Error('The displayed journal has changed; reselect the contour.');
      const result=dragModelClosedContourVertex(liveHistory.current,nativeSession.current!,
        pointerSelection,handleId,{x,y},pointerSourceArchive);
      if(result.kind==='refused'){setMessage('Drawn vertex refused: '+result.reason);return;}
      acceptHistory(result.history);
      setPointerSelection(result.selection);
      setPointerSourceArchive(serializeModelSession(result.history));
      setMessage('Moved selected solver-owned vertex '+handleId+
        ' as one authoritative structural SKETCH edit at revision '+result.history.document.revision+
        '; invalidated '+(result.invalidatedFeatureIds.join(' → ')||'no downstream features')+
        '. Native STEP revoked.');
    }catch(e){setMessage('Drawn vertex refused; journal unchanged: '+String(e));}
  };
  const editDrawnEdge=(edgeId:string,start?:SketchLocalPoint,target?:SketchLocalPoint,offsetMm?:number)=>{
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    try{
      if(liveHistory.current!==history)throw Error('The displayed journal changed; reselect the contour.');
      const result=offsetMm!==undefined
        ?offsetModelClosedContourEdge(liveHistory.current,nativeSession.current!,
          pointerSelection,edgeId,offsetMm,pointerSourceArchive)
        :start&&target
          ?dragModelClosedContourEdge(liveHistory.current,nativeSession.current!,
            pointerSelection,edgeId,start,target,pointerSourceArchive)
          :{kind:'refused' as const,reason:'No valid edge gesture.',code:'invalid_gesture'};
      if(result.kind==='refused'){setMessage('Whole edge refused: '+result.reason);return;}
      acceptHistory(result.history);
      setPointerSelection(result.selection);
      setPointerSourceArchive(serializeModelSession(result.history));
      setSelectedContourEdgeId(edgeId);
      setMessage('Moved semantic contour edge '+edgeId+' by '+result.appliedOffsetMm+
        ' mm outward-normal in ONE source-fenced RUNTIME revision '+
        result.history.document.revision+'; invalidated '+
        (result.invalidatedFeatureIds.join(' → ')||'no downstream features')+
        '. Original STEP revoked; preview is analytic only.');
    }catch(e){setMessage('Whole edge refused; journal unchanged: '+String(e));}
  };
  const beginTab=()=>{
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    if(!closedInventory||!closedEdges?.edges.some(edge=>edge.edgeId===selectedContourEdgeId)){
      setMessage('Select one SKETCH-owned contour edge before inserting a tab.');return;
    }
    setTabDraft({edgeId:selectedContourEdgeId,expectedArchive:pointerSourceArchive,points:[]});
    setMessage('Insert tab: click two sketch-local positions in order. Shift gives fine snap. Commit creates one undoable revision; Escape cancels.');
  };
  const addTabPoint=(x:number,y:number,precise:boolean)=>{
    if(!tabDraft||pendingImport||loadingFile)return;
    if(tabDraft.expectedArchive!==serializeModelSession(liveHistory.current)){
      setTabDraft(null);setMessage('Tab draft cancelled: authoritative source changed.');return;
    }
    const point=placeBlankContourPointer({x,y},precise);
    if(!point){setMessage('Tab vertex outside bounded sketch coordinates.');return;}
    if(tabDraft.points.length>=2){setMessage('Two points placed. Commit or cancel.');return;}
    setTabDraft({...tabDraft,points:[...tabDraft.points,point]});
    setMessage('Tab pointer vertices '+(tabDraft.points.length+1)+'/2. No model revision yet.');
  };
  const editTabDraftCoordinate=(index:number,axis:'x'|'y',raw:string)=>{
    if(!tabDraft||pendingImport||loadingFile)return;
    if(tabDraft.expectedArchive!==serializeModelSession(liveHistory.current)){
      setTabDraft(null);setMessage('Tab draft cancelled: authoritative source changed.');return;
    }
    const value=Number(raw);
    if(!raw.trim()||!Number.isFinite(value)||Math.abs(value)>10000){
      setMessage('Tab draft coordinate must be a finite number within ±10,000 mm.');
      return;
    }
    if(!tabDraft.points[index])return;
    setTabDraft({...tabDraft,points:tabDraft.points.map((point,i)=>
      i===index?{...point,[axis]:value}:point)});
    setMessage(null);
  };
  const commitTab=()=>{
    if(!tabDraft||!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    if(tabDraft.points.length!==2){setMessage('Place both tab vertices before committing.');return;}
    if(tabPreflight?.kind!=='admissible'){
      setMessage('Tab cannot commit: '+(tabPreflight?.reason??'SKETCH admission preview not current.'));
      return;
    }
    try{
      if(liveHistory.current!==history||tabDraft.expectedArchive!==pointerSourceArchive)
        throw Error('Selected journal changed. Restart tab placement.');
      const result=insertModelContourTab(liveHistory.current,nativeSession.current!,
        pointerSelection,tabDraft.edgeId,
        [tabDraft.points[0],tabDraft.points[1]],tabDraft.expectedArchive);
      if(result.kind==='refused'){setMessage('Tab refused: '+result.reason);return;}
      acceptHistory(result.history);
      setPointerSelection(result.selection);
      setPointerSourceArchive(serializeModelSession(result.history));
      setPointerHandleId('');setSelectedContourEdgeId('');
      setMessage('Inserted tab in ONE source-fenced RUNTIME revision '+
        result.history.document.revision+'. Retired '+result.retiredEdgeIds.join(', ')+
        '. Native STEP pending independent qualification.');
    }catch(error){setMessage('Tab insertion refused; journal unchanged: '+String(error));}
  };
  const editTabVertex=(handleId:string,x:number,y:number)=>{
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    try{
      if(liveHistory.current!==history)throw Error('Displayed journal changed; reselect.');
      const result=editModelTabbedVertex(liveHistory.current,nativeSession.current!,
        pointerSelection,handleId,{x,y},pointerSourceArchive);
      if(result.kind==='refused'){setMessage('Tab vertex refused: '+result.reason);return;}
      acceptHistory(result.history);
      setPointerSelection(result.selection);
      setPointerSourceArchive(serializeModelSession(result.history));
      setMessage('Edited solver-owned tab vertex '+handleId+' in one undoable revision '+
        result.history.document.revision+'. Native STEP stale/pending; analytic preview only.');
    }catch(error){setMessage('Tab vertex edit refused; journal unchanged: '+String(error));}
  };
  const dragUnselectedContourVertex=(handleId:string,x:number,y:number)=>{
    // Only source-inspected handles in the current canonical journal are eligible.
    // The existing SKETCH/RUNTIME edit paths remain the sole geometry authority.
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile||
        liveHistory.current!==history||
        pointerSourceArchive!==serializeModelSession(liveHistory.current)){
      setMessage('Vertex drag expired; reselect the current source-owned contour.');
      return;
    }
    if(closedInventory?.handles.some(handle=>handle.handleId===handleId)){
      setPointerHandleId(handleId);
      setSelectedContourEdgeId('');
      dragDrawnVertex(handleId,x,y);
    }else if(tabbedInventory?.handles.some(handle=>handle.handleId===handleId)){
      setPointerHandleId(handleId);
      setSelectedContourEdgeId('');
      editTabVertex(handleId,x,y);
    }else setMessage('Vertex drag refused: handle is not owned by the current SKETCH inventory.');
  };
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
  const authorNamedExtrusion=()=>{
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    try{
      if(liveHistory.current!==history)throw Error('Displayed source changed. Reselect the contour.');
      if(!generalDraft.depth.trim())throw Error('Enter a positive depth.');
      const result=authorGeneralProfileExtrusion(history,pointerSelection,pointerSourceArchive,
        generalDraft.extrudeId.trim(),generalDraft.bodyId.trim(),Number(generalDraft.depth));
      acceptHistory(result.history);setSelected(result.semanticIds.extrudeId);
      setGeneralTargetId('');setSketchMode(false);
      setMessage('FEATUREOPS authored '+result.semanticIds.extrudeId+' → '+
        result.semanticIds.bodyId+' at revision '+result.history.document.revision+
        '. Status: preview_only; no native B-rep/STEP. Reselect source contour before the next edit.');
    }catch(e){setMessage('Named extrusion refused; journal retained: '+String(e));}
  };
  const authorNamedCut=()=>{
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    try{
      if(liveHistory.current!==history)throw Error('Displayed source changed. Reselect the contour.');
      const body=generalBodies.find(b=>b.extrudeId===generalTargetId);
      if(!body)throw Error('Choose an explicit current named target body.');
      const result=authorGeneralProfileCut(history,pointerSelection,pointerSourceArchive,
        body.extrudeId,body.bodyId,generalDraft.cutId.trim());
      acceptHistory(result.history);setSelected(result.semanticIds.cutId);setSketchMode(false);
      setMessage('FEATUREOPS authored '+result.semanticIds.cutId+' on '+body.bodyId+
        ' at revision '+result.history.document.revision+
        '. pending_exact_provider: no qualified Boolean or STEP. Reselect contour to edit further.');
    }catch(e){setMessage('Named body cut refused; journal retained: '+String(e));}
  };
  const redimensionNamedExtrusion=()=>{
    if(!pointerSelection||!pointerSourceArchive||pendingImport||loadingFile)return;
    try{
      if(liveHistory.current!==history)throw Error('Displayed source changed. Reselect the contour.');
      const body=generalBodies.find(b=>b.extrudeId===generalTargetId);
      if(!body)throw Error('Select the exact named extrusion/body to reconfigure.');
      if(!generalDraft.depth.trim())throw Error('Enter a positive depth.');
      const result=redimensionGeneralProfileExtrusion(history,pointerSelection,pointerSourceArchive,
        body.extrudeId,body.bodyId,Number(generalDraft.depth));
      acceptHistory(result.history);setSelected(body.extrudeId);setSketchMode(false);
      setMessage('Reconfigured '+body.extrudeId+' to '+result.depthMm+' mm at revision '+
        result.history.document.revision+'; dependent cuts invalidated. Preview only; STEP revoked.');
    }catch(e){setMessage('Named extrusion edit refused; journal retained: '+String(e));}
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
      if(!modelHoleIsCartesian(liveHistory.current,hole))
        throw Error('Edge-anchored hole: edit its source-fenced along/inset/radius dimensions in the selected-edge panel.');
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
  const patternCircular=()=>{
    try{
      if(Object.values(orbitDraft).some(value=>!value.trim()))
        throw Error('Enter a source hole, instance count, pivot and signed sweep.');
      const previous=liveHistory.current;
      const result=patternModelCircularHoles(previous,{
        sourceHoleId:orbitDraft.sourceHoleId,
        instances:Number(orbitDraft.instances),
        pivotXmm:Number(orbitDraft.pivotXmm),
        pivotYmm:Number(orbitDraft.pivotYmm),
        sweepDegrees:Number(orbitDraft.sweepDegrees),
      });
      if(result.kind==='refused'){
        setMessage('Bolt circle refused by SKETCH: '+
          (result.candidateFeature.diagnostics.join('; ')||result.reason));
        return;
      }
      acceptHistory(result.history);setSketchMode(true);
      setMessage('Bolt circle committed at revision '+result.history.document.revision+
        ': '+(Number(orbitDraft.instances)-1)+' new independently editable circles, one undo frame. '+
        'Invalidated '+(result.invalidation.invalidatedFeatureIds.join(' → ')||'none')+
        '. Preview only; STEP must rebuild.');
    }catch(e){setMessage('Bolt circle refused: '+(e instanceof Error?e.message:String(e)));}
  };
  const applyRigidTransform=()=>{
    try {
      if(Object.values(rigidDraft).some(value=>!value.trim()))
        throw Error('Enter signed X/Y translations and a rotation angle.');
      const translateXmm=Number(rigidDraft.translateXmm);
      const translateYmm=Number(rigidDraft.translateYmm);
      const rotateDegrees=Number(rigidDraft.rotateDegrees);
      const result=transformSelectedModelHoles(liveHistory.current,{
        holeIds:layoutIds,translateXmm,translateYmm,rotateDegrees,
      });
      if(result.kind==='refused'){
        setMessage('Rigid transform refused by SKETCH/profile admission: '+
          (result.candidateFeature.diagnostics.join('; ')||result.reason));
        return;
      }
      acceptHistory(result.history);
      setRigidDraft({translateXmm:'0',translateYmm:'0',rotateDegrees:'0'});
      setSketchMode(true);
      setMessage(`Revision ${result.history.document.revision}: rigidly repositioned ${layoutIds.length} authored holes in ONE undoable SKETCH transaction. Stable IDs/radii kept, STEP revoked. Invalidated: ${result.invalidation.invalidatedFeatureIds.join(' → ')||'none'}.`);
    }catch(e){setMessage('Rigid transform refused: '+(e instanceof Error?e.message:String(e)));}
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
  const stampSelection=()=>{
    try{
      if(pendingImport)throw Error('Finish the pending project replacement first.');
      if(Object.values(stampDraft).some(v=>!v.trim()))
        throw Error('Enter signed X and Y copy displacements.');
      const outcome=stampSelectedModelHoles(liveHistory.current,{
        holeIds:layoutIds,deltaXmm:Number(stampDraft.deltaXmm),deltaYmm:Number(stampDraft.deltaYmm),
      });
      if(outcome.result.kind==='refused'){
        setMessage('Selected-hole stamp refused by SKETCH: '+
          (outcome.result.candidateFeature.diagnostics.join('; ')||outcome.result.reason));
        return;
      }
      acceptHistory(outcome.result.history);
      setLayoutSelected([...outcome.copiedHoleIds]);
      setActiveHole(outcome.copiedHoleIds[0]??null);
      setSketchMode(true);
      setMessage(`Revision ${outcome.result.history.document.revision}: stamped ${outcome.copiedHoleIds.length} solved holes into independent authored sketch circles in ONE undoable SKETCH transaction. Through-cuts require an authored cut feature; old STEP invalidated.`);
    }catch(e){setMessage('Selected-hole stamp refused: '+(e instanceof Error?e.message:String(e)));}
  };
  const removeSelection=()=>{
    try{
      if(pendingImport)throw Error('Finish the pending project replacement first.');
      const result=removeSelectedModelHoles(liveHistory.current,layoutIds);
      if(result.kind==='refused'){
        setMessage('Selected-hole removal refused by SKETCH: '+
          (result.candidateFeature.diagnostics.join('; ')||result.reason));
        return;
      }
      const count=layoutIds.length;
      acceptHistory(result.history);
      setLayoutSelected([]);
      setActiveHole(null);
      setSketchMode(true);
      setMessage(`Revision ${result.history.document.revision}: removed ${count} selected custom holes in ONE undoable SKETCH transaction. Undo restores the same identities; STEP invalidated.`);
    }catch(e){setMessage('Selected-hole removal refused: '+(e instanceof Error?e.message:String(e)));}
  };
  const removeHole=(id:ModelHole)=>{
    try{
      const result=modelHoleIsCartesian(liveHistory.current,id)
        ?removeModelHole(liveHistory.current,id)
        :removeModelEdgeHole(liveHistory.current,id);
      if(result.kind==='refused'){setMessage('Remove refused: '+result.reason);return;}
      acceptHistory(result.history);
      setMessage(`Removed ${id}; undo restores the same semantic identity; native STEP requires rebuild.`);
    }catch(e){setMessage('Remove refused: '+String(e));}
  };
  const dragHole=(hole:ModelHole,x:number,y:number,selectedIds:readonly ModelHole[]=[hole])=>{
    try{
      const previous=liveHistory.current;
      if(selectedIds.some(id=>!modelHoleIsCartesian(previous,id)))
        throw Error('Edge-anchored holes must be repositioned with the selected-edge dimensions; no unanchored drag was applied.');
      const isGroup=selectedIds.length>1&&selectedIds.includes(hole);
      const source=isGroup?modelHoleValues(previous)[hole]:null;
      if(isGroup&&!source)throw Error('Dragged hole no longer exists.');
      const result=isGroup
        ?moveModelHoleGroup(previous,selectedIds,x-source!.x,y-source!.y)
        :moveModelHoleCenter(previous,hole,x,y);
      if(result.kind==='refused'){
        setMessage(`Drag refused: ${result.candidateFeature.diagnostics.join('; ') || result.reason}`);
        return false;
      }
      acceptHistory(result.history);setActiveHole(hole);
      setLayoutSelected(isGroup?[...selectedIds]:[hole]);
      setMessage(isGroup
        ?`Moved ${selectedIds.length} selected hole centres together by (${x-source!.x}, ${y-source!.y}) mm in ONE undoable SKETCH transaction. Native STEP requires rebuild.`
        :`Moved ${hole} center to (${x}, ${y}) mm in one undoable sketch transaction; native STEP requires rebuild.`);
      return true;
    }catch(e){setMessage('Hole drag refused: '+String(e));return false;}
  };
  const nudgeActiveHoles=(direction:string,fast:boolean)=>{
    if(!renderSketch||!displayedActiveHole||circleDrawing.phase!=='idle'||
        pendingImport||loadingFile)return false;
    const step=fast?10:1;
    const dx=direction==='ArrowRight'?step:direction==='ArrowLeft'?-step:0;
    const dy=direction==='ArrowUp'?step:direction==='ArrowDown'?-step:0;
    if(!dx&&!dy)return false;
    const ids=layoutIds.length>1&&layoutIds.includes(displayedActiveHole)
      ?layoutIds:[displayedActiveHole];
    try{
      if(ids.some(id=>!modelHoleIsCartesian(liveHistory.current,id))){
        setMessage('Nudge blocked: edit edge-anchored holes via the source-fenced along/inset/radius dimensions.');
        return true;
      }
      const result=nudgeModelHoleSelection(liveHistory.current,ids,dx,dy);
      if(result.kind==='refused'){
        setMessage('Hole nudge refused by SKETCH: '+
          (result.candidateFeature.diagnostics.join('; ')||result.reason));
      }else{
        acceptHistory(result.history);
        setActiveHole(displayedActiveHole);
        setLayoutSelected([...ids]);
        setMessage(`Nudged ${ids.length} hole(s) by (${dx}, ${dy}) mm in ONE undoable SKETCH transaction. Native STEP revoked.`);
      }
    }catch(e){setMessage('Hole nudge refused: '+(e instanceof Error?e.message:String(e)));}
    return true;
  };
  const dragHoleDiameter=(hole:ModelHole,diameterMm:number)=>{
    try{
      if(!modelHoleIsCartesian(liveHistory.current,hole))
        throw Error('Use the selected-edge panel to edit the edge-anchored radius.');
      const result=editModelHole(liveHistory.current,hole,'diameter',diameterMm,'require_admissible');
      if(result.kind==='refused'){
        setMessage('Diameter resize refused by SKETCH: '+
          (result.candidateFeature.diagnostics.join('; ')||result.reason));return false;
      }
      acceptHistory(result.history);setActiveHole(hole);
      setMessage(`Revision ${result.history.document.revision}: resized ${hole} circular cut to Ø${diameterMm} mm in one admitted RUNTIME/SKETCH transaction. Dependent plate/cut invalidated; old STEP revoked.`);
      return true;
    }catch(e){setMessage('Diameter resize refused: '+(e instanceof Error?e.message:String(e)));return false;}
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
  const openModelFile=async(file:File,origin:'file'|'recovery'='file')=>{
    cancelActiveImport();
    const ticket=loadTicket.current;
    const abort=new AbortController();
    importAbort.current=abort;
    // Never apply an archive until the user explicitly confirms replacement.
    setPendingImport(null);
    importStarted.current=performance.now();
    setImportTrace([{stage:'file_selected',elapsedMs:0}]);
    console.info('INTUIT3D_IMPORT_STAGE file_selected +0ms');
    setLoadingFile(file.name);
    setImportStage('reading');
    noteImportStage('worker_reading');
    setMessage(null);
    try{
      if(file.size>MAX_MODEL_ARCHIVE_BYTES)throw Error('Archive exceeds 4 MiB');
      // Transfer the File handle, not its decoded JSON, to the Worker. Reading
      // File.text(), RUNTIME.reopen, undo validation and SKETCH inspection all
      // run off Firefox's main/UI thread; no synchronous fallback is allowed.
      const incoming=await validateModelFileInWorker(file,{
        signal:abort.signal,
        onProgress:stage=>{
          if(ticket===loadTicket.current&&!abort.signal.aborted){
            setImportStage(stage);
            noteImportStage(stage==='reading'?'worker_reading':
              stage==='validating'?'worker_validating':'worker_transferring');
          }
        },
      });
      if(ticket!==loadTicket.current||abort.signal.aborted)return;
      setPendingImport({file:file.name,history:incoming,origin});
      noteImportStage('confirmation_ready');
    }catch(e){
      if(ticket===loadTicket.current&&!abort.signal.aborted){
        noteImportStage('rejected');
        setMessage('Open rejected (current model retained): '+String(e));
      }
    }finally{
      if(ticket===loadTicket.current){
        importAbort.current=null;
        setLoadingFile(null);
      }
    }
  };
  const restoreLocal=async(id:string)=>{
    try{
      // Do not read a record while this session's latest write is unfinished.
      await recoveryWriteQueue.current;
      const source=await readLocalRecovery(id);
      checkedModelArchiveSize(source);
      await openModelFile(new File([source],'local-recovery.i3d-model.json',
        {type:'application/json'}),'recovery');
    }catch(e){setMessage('Local recovery could not be opened; current model retained: '+String(e));}
  };
  const forgetLocal=async(id:string)=>{
    try{
      await recoveryWriteQueue.current;
      await deleteLocalRecovery(id);
      await refreshRecovery();
      setMessage('Local recovery checkpoint forgotten. Current model unchanged.');
    }catch(e){setMessage('Could not forget local recovery: '+String(e));}
  };
  const load=(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.target.value=''; // Allow retrying the same rejected file.
    if(file)void openModelFile(file);
  };
  const prepareNewEmptySketch=()=>{
    cancelActiveImport();
    setPendingImport({file:'New genuinely empty CAD sketch',
      history:newModelEmptySketchSession('workbench.empty.'+crypto.randomUUID()),origin:'new'});
  };
  const startBlankDrawing=()=>{
    if(pendingImport||loadingFile)return;
    try {
      const draft=startModelBlankContour(liveHistory.current);
      setBlankDraft(draft);setSketchMode(true);setCircleDrawing({phase:'idle'});
      setProfilePickMode(false);setPointerSelection(null);setPointerSourceArchive(null);setPointerHandleId('');
      setMessage('Place 3–12 sketch-local vertices. Close admits one solver-owned contour; Escape cancels with no journal change.');
    }catch(error){setMessage('Cannot begin outline: '+String(error));}
  };
  const addBlankVertex=(point:SketchLocalPoint)=>{
    if(!blankDraft||pendingImport||loadingFile)return;
    if(blankDraft.expectedArchive!==serializeModelSession(liveHistory.current)){
      setBlankDraft(null);setMessage('Outline cancelled: authoritative project changed.');return;
    }
    const step=appendBlankContourPoint(blankDraft,point);
    if(step.kind==='refused'){setMessage(step.reason);return;}
    setBlankDraft(step.draft);setMessage(null);
  };
  const closeBlankDrawing=()=>{
    if(!blankDraft||pendingImport||loadingFile)return;
    try {
      const outcome=commitModelBlankContour(liveHistory.current,nativeSession.current!,blankDraft);
      if(outcome.kind==='refused'){setMessage('Close refused: '+outcome.reason);return;}
      acceptHistory(outcome.history);
      setPointerSelection(outcome.selection);setPointerSourceArchive(serializeModelSession(outcome.history));setPointerHandleId('');
      setSketchMode(true);setSelected('sketch.plate');
      setMessage('Closed '+blankDraft.vertices.length+' pointer vertices as one authoritative SKETCH/RUNTIME revision '+
        outcome.history.document.revision+'. Select the solver-owned profile for editing. Native STEP is stale/pending.');
    }catch(error){setMessage('Close refused; authoritative source retained: '+String(error));}
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
    if(pendingImport.origin!=='new')noteImportStage('replacement_confirmed');
    // Imported archives already exist on disk; newly created projects do not.
    setNeedsArchiveExport(pendingImport.origin!=='file');
    const plateRows=modelFeatureTimeline(pendingImport.history).filter(row=>row.featureId==='plate');
    const hasPlate=plateRows.some(row=>row.active);
    // A removed extrusion remains the selected recoverable tombstone after
    // reopening; only a never-extruded sketch selects the source sketch.
    setSketchMode(!hasPlate);setSelected(plateRows.length?'plate':'sketch.plate');
    setActiveHole(null);setPendingImport(null);setFeatureCombo(null);
    setMessage(pendingImport.origin==='recovery'?'Local recovery restored as an unexported authoritative model; save an archive to retain a filesystem copy.':'Model archive reopened with durable feature IDs, undo/redo and no cached meshes.');
  };
  // STEP stays in the RUNTIME live session until the very moment the user
  // downloads it. Edits, undo, archive replacement and provider changes revoke it.
  const downloadCachedStep=()=>{
    // Take one source-fenced receipt with its own defensive byte copy. A valid
    // previous STEP may survive a failed native retry for the SAME archive:
    // downloading those bytes must identify them as LAST GOOD, not latest.
    const coordinator=nativeSession.current;
    const state=coordinator?.refresh();
    const receipt=coordinator?.currentStepReceipt();
    const step=receipt?.step;
    const availability=state?.stepAvailability;
    if(!receipt||!step||!state||
        (availability!=='current'&&availability!=='last_good')||
        state.projectId!==receipt.source.projectId||
        state.revision!==receipt.source.revision){
      setNativeReport('No current source-bound STEP receipt: build this exact journal revision again.');
      return;
    }
    const filename=sourceBoundStepFilename(receipt.source.projectId,receipt.source.revision,receipt.producer.backend);
    const objectUrl=URL.createObjectURL(new Blob([new Uint8Array(step.bytes)],{type:'model/step'}));
    try{
      const link=document.createElement('a');
      link.href=objectUrl;link.download=filename;
      document.body.appendChild(link);link.click();link.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
    const pinned=receipt.producer.backend==='OCCT-cxx-8.0.1';
    const status=availability==='last_good'
      ?'LAST GOOD — retained from a previous verified attempt, NOT the latest native result'
      :'CURRENT — latest verified source-bound STEP';
    setNativeReport(`${pinned?'Pinned OCCT8 C++':'Experimental OCP'} STEP download requested · ${status} · revision ${receipt.source.revision} · ${step.bytes.byteLength} bytes · SHA-256 ${step.sha256}. Verify that the file reached Downloads. Same-engine verified bytes only; not independent STEP geometry verification; independent external CAD readback is not asserted.`);
  };
  /** One real user click => ONE atomic RUNTIME capture => one ZIP download.
   * A synthetic/OCP receipt cannot make this gate ready, and no payload is
   * sampled from separate mutable React/model/STEP variables after capture. */
  const downloadPinnedEvidence=()=>{
    const capture=nativeSession.current?.captureCurrentStepEvidence();
    if(!capture){
      setPinnedEvidenceReady(false);
      setNativeReport('Pinned STEP custody unavailable: no current-revision OCCT8 C++ receipt. Rebuild with the pinned provider; experimental OCP is not acceptable.');
      return;
    }
    try {
      const zip=buildPinnedStepEvidenceZip(capture);
      const filename=pinnedStepEvidenceFilename(
        capture.receipt.source.projectId,capture.receipt.source.revision);
      const objectUrl=URL.createObjectURL(new Blob([new Uint8Array(zip)],{type:'application/zip'}));
      try {
        const link=document.createElement('a');
        link.href=objectUrl;link.download=filename;
        document.body.appendChild(link);link.click();link.remove();
      }finally{setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
      setNativeReport('Pinned OCCT8 source-custody ZIP download requested · revision '+
        capture.receipt.source.revision+'. Contains exact archive, receipt and unchanged native STEP from one user click. Independently validate its physical geometry before claiming product acceptance.');
    }catch(error){
      setNativeReport('Pinned STEP custody refused: '+
        (error instanceof Error?error.message:String(error)));
    }
  };
  const rebuildNative=async(action:'prepare'|'experimental-step'|'pinned-evidence')=>{
    const id=++nativeTicket.current;
    const current=liveHistory.current;
    setNativeBusy(true);setPinnedEvidenceReady(false);setNativeReport(null);setNativeEvidence(null);
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
      const pinned=!!nativeSession.current?.currentStepReceipt({requiredBackend:'OCCT-cxx-8.0.1'});
      setPinnedEvidenceReady(pinned);
      if(action==='pinned-evidence') downloadPinnedEvidence();
      else if(action==='experimental-step') downloadCachedStep();
      else setNativeReport(`${pinned?'Pinned OCCT8 C++ STEP prepared':'Experimental STEP prepared (OCP prototype)'} · revision ${outcome.source.revision} · SHA-256 ${step.sha256}. Use Download current STEP to publish these revision-fenced bytes. Same-engine readback only; not independent STEP.`);
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
      if(e.key==='Escape'&&blankDraft){
        e.preventDefault();setBlankDraft(null);
        setMessage('Uncommitted outline cancelled. No CAD revision or undo frame created.');return;
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
      // Global Undo/Redo must still work with focused thickness/diameter sliders.
      // Only arrow nudges defer to their own local keyboard handlers.
      if(target?.closest('input,textarea,select,[contenteditable=true]'))return;
      if(!command&&!e.altKey&&!target?.closest('[role=slider]') &&
          ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) &&
          nudgeActiveHoles(e.key,e.shiftKey)){
        e.preventDefault();return;
      }
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
        <button className="ribbon-button" data-testid="runtime-new-empty-sketch"
          title="Create a truly empty SKETCH document; replacement confirmation required"
          onClick={prepareNewEmptySketch}>New empty sketch</button>
        <button className="ribbon-button" data-testid="runtime-save-archive" title="Save authoritative model archive (Ctrl+S)" onClick={save}>Save model archive</button>
        <button className="ribbon-button" title="Open authoritative model archive (Ctrl+O), or drop one JSON archive on the workbench" onClick={()=>fileInput.current?.click()}>Open model archive</button>
        <button type="button" className="ribbon-button" data-testid="runtime-import-trace-download"
          disabled={!importTrace.length} onClick={downloadImportTrace}
          title="Local, privacy-safe stage trace for the last file-selection attempt; no archive contents">
          Download import stage trace</button>
        <button className="ribbon-button" onClick={()=>{
          if(window.confirm('Leave the model-backed editor? Export your model archive first; the model session will close.'))onClose();
        }}>Preview sandbox</button>
        <input ref={fileInput} type="file" accept=".json,.i3d-model.json,application/json" className="runtime-file-input" onChange={load}
          aria-label="Open INTUIT model archive" />
      </div>
    </header>
    <details className="runtime-local-recovery" data-testid="runtime-local-recovery">
      <summary data-testid="runtime-local-recovery-toggle">Browser-local crash recovery · {recoveryStatus==='checking'?'checking local storage':recoveryStatus==='error'?'storage unavailable':recoveryEntries.length+' checkpoint(s)'}</summary>
      <p>After your first edit, a bounded, local-only RUNTIME model archive is checkpointed in this browser.
        It contains the actual journal and undo/redo frames, not meshes or STEP. Browser storage can be
        cleared or evicted: <strong>downloaded model archives remain essential.</strong>
        Recovering always validates in the isolated Worker and requires confirmation.</p>
      {recoveryError&&<p role="status" data-testid="runtime-local-recovery-error">{recoveryError}</p>}
      {recoveryStatus==='ready'&&!recoveryEntries.length&&<p>No previous local drafts in this browser.</p>}
      {recoveryEntries.map(entry=><div className="runtime-local-recovery-entry" key={entry.id}>
        <span>{entry.projectId} · revision {entry.revision} · {entry.undoFrames} undo / {entry.redoFrames} redo
          {' '}· {new Date(entry.updatedAt).toLocaleString()} · {entry.exportRequested?'download requested':'unexported draft'}
          {entry.id===recoverySessionId.current?' · this tab':''}</span>
        <button type="button" className="ribbon-button" data-testid={'runtime-recovery-restore-'+entry.id}
          disabled={!!pendingImport||!!loadingFile}
          onClick={()=>void restoreLocal(entry.id)}>Review &amp; restore</button>
        <button type="button" className="ribbon-button" data-testid={'runtime-recovery-forget-'+entry.id}
          disabled={!!pendingImport||!!loadingFile}
          onClick={()=>void forgetLocal(entry.id)}>Forget</button>
      </div>)}
    </details>
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
      <div className="ribbon-group" data-testid="runtime-blank-outline-tools">
        <span className="ribbon-label">FROM EMPTY</span>
        <button type="button" className={blankDraft?'ribbon-button active':'ribbon-button'}
          data-testid="runtime-outline-tool" disabled={!emptySketch||!!pendingImport||!!loadingFile}
          onClick={()=>blankDraft?(setBlankDraft(null),setMessage('Uncommitted outline cancelled.')):startBlankDrawing()}>
          {blankDraft?'Cancel outline':'Draw outline'}</button>
      </div>
      <div className="ribbon-group" data-testid="runtime-profile-pointer-tools">
        <span className="ribbon-label">SKETCH PROFILE</span>
        <button type="button" className={profilePickMode?'ribbon-button active':'ribbon-button'}
          data-testid="runtime-profile-select-mode" aria-pressed={profilePickMode}
          disabled={!geom||!!pendingImport||!!loadingFile||circleDrawing.phase!=='idle'}
          onClick={()=>{
            setSketchMode(true);setProfilePickMode(previous=>!previous);
            setMessage('Click strictly inside an admitted sketch contour to select it. Boundary/void hits are refused.');
          }}>{profilePickMode?'Cancel contour selection':'Select contour'}</button>
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
        REAL INTENT + SKETCH · VIEWPORT IS PREVIEW · NO EXACT KERNEL IN VIEWPORT</span>
        <span className="stage-chip" data-testid="runtime-native-step-state"
          title={nativeIndicator.detail}>{nativeIndicator.label}</span></div>
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
          <div className="view-label"><strong>{renderSketch?'Sketch XY · solved profiles':cutActive||generalCutActive?'3D cut-intent preview':'3D uncut extrusion preview'}</strong>
            <span>{geom?'Public SKETCH solver + profile admission':'Invalid or unresolved geometry'}</span></div>
          <span className={geom?'preview-tag':'preview-tag stale'}>{geom?'TESSELLATED PREVIEW · NOT EXACT':'NO CURRENT VALID MESH'}</span>
        </div>
        <div className="viewport-stage">
          {emptySketch?<BlankSketchCanvas draft={blankDraft} disabled={!!pendingImport||!!loadingFile}
              runtimeReady={structuralContourRuntimeAvailable()}
              onBegin={startBlankDrawing} onPoint={addBlankVertex}
              onUndoPoint={()=>setBlankDraft(previous=>previous?undoBlankContourVertex(previous):null)}
              onCancel={()=>{setBlankDraft(null);setMessage('Uncommitted outline cancelled. No revision created.');}}
              onClose={closeBlankDrawing}/>:
           geom?<RuntimeGeometryViewport profile={geom.profile} thickness={geom.thickness} sketchMode={renderSketch}
              sketchProjectKey={history.document.projectId}
              onHoleMove={circleDrawing.phase==='idle'&&!profilePickMode?dragHole:undefined}
              onHoleDiameterEdit={circleDrawing.phase==='idle'&&!profilePickMode?dragHoleDiameter:undefined}
              onHoleSelect={(id,additive=false)=>{
                setActiveHole(id);
                setLayoutSelected(previous=>additive
                  ?previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]
                  :[id]);
              }} selectedHoleId={displayedActiveHole} selectedHoleIds={layoutIds}
              onDimensionEdit={legacySketch&&circleDrawing.phase==='idle'&&!profilePickMode?dragDimension:undefined}
              onThicknessEdit={plateActive?(mm)=>update('thickness',mm):undefined}
              circleDrawing={circleDrawing}
              onCirclePick={circleDrawing.phase!=='idle'?pickCirclePoint:undefined}
              onProfilePick={profilePickMode&&circleDrawing.phase==='idle'?pickProfile:undefined}
              profileEditHandle={!profilePickMode&&circleDrawing.phase==='idle'&&!tabDraft
                 ?(closedHandle??tabbedHandle??pointerDragHandle):undefined}
              contourVertexHandles={!profilePickMode&&circleDrawing.phase==='idle'&&!tabDraft&&
                !pendingImport&&!loadingFile?contourVertexHandles:undefined}
              onContourVertexPick={selectContourVertex}
              onContourVertexDrag={dragUnselectedContourVertex}
              onProfileHandleDrag={(handleId,x,y)=>closedHandle?dragDrawnVertex(handleId,x,y):
                 tabbedHandle?editTabVertex(handleId,x,y):dragProfile(handleId,x,y)}
               tabPoints={tabDraft?.points}
               tabEdge={tabSourceEdge??null}
               onTabPoint={tabDraft?(x,y,precise)=>addTabPoint(x,y,precise):undefined}
              contourEdges={!tabDraft&&!profilePickMode&&circleDrawing.phase==='idle'&&!pendingImport&&!loadingFile
                ?closedEdges?.edges:undefined}
              selectedContourEdgeId={selectedContourEdgeId}
              onContourEdgePick={setSelectedContourEdgeId}
              onContourEdgeDrag={(id,start,target)=>editDrawnEdge(id,start,target)}
              onContourEdgeOffset={(id,amount)=>editDrawnEdge(id,undefined,undefined,amount)}/>:
            <div className="empty-overlay" data-testid="runtime-empty">Current dimensions cannot produce an admitted sketch profile. No previous mesh is represented as current.</div>}
          {geom&&!renderSketch&&displayedActiveHole&&layoutIds.length===1&&
            layoutIds[0]===displayedActiveHole&&
            <SolidHoleQuickEdit
              key={displayedActiveHole+':'+history.document.revision}
              holeId={displayedActiveHole} hole={holes[displayedActiveHole]}
              editable={modelHoleIsCartesian(history,displayedActiveHole)}
              disabled={!!pendingImport||!!loadingFile}
              onMove={(x,y)=>{
                if(liveHistory.current.document.revision!==history.document.revision){
                  setMessage('Selected hole edit refused: model revision advanced. Reinspect the current solved hole.');
                  return false;
                }
                return dragHole(displayedActiveHole,x,y);
              }}
              onDiameter={diameter=>{
                if(liveHistory.current.document.revision!==history.document.revision){
                  setMessage('Selected bore edit refused: model revision advanced. Reinspect the current solved hole.');
                  return false;
                }
                return dragHoleDiameter(displayedActiveHole,diameter);
              }}/>}
          {geom&&<div className="runtime-mesh-caption" data-testid="runtime-boundary">
            {renderSketch?'Admitted 2D sketch':cutActive||generalCutActive?'Cut-intent preview':'Uncut extrusion preview'} · {geom.profile.outer.length} outline vertices · {geom.profile.holes.length} displayed circular holes · {plateActive||generalSolid?geom.thickness+' mm extrude preview':'no solid yet'} · no Boolean proof
          </div>}
          {sketchMode&&circleDrawing.phase!=='idle'&&<div className="runtime-mesh-caption" data-testid="runtime-circle-stage" role="status">
            {circleDrawing.phase==='centre'?'CIRCLE · Click a centre inside the plate':
              `CIRCLE · Centre (${circleDrawing.center.x}, ${circleDrawing.center.y}) mm · Click radius`}
            {' · Escape to cancel · no journal edit until second click'}
          </div>}
          <div className="viewport-hint">{renderSketch?(circleDrawing.phase!=='idle'?
            'Circle tool: centre click → radius click; profile admission rejects overlaps or outside holes':
            'Drag chosen semantic contour edges, vertex/diameter handles or hole centres. Focus an edge or dimension and press arrows (Shift: 0.1 mm); click a hole then press arrows to nudge 1 mm (Shift: 10 mm), Ctrl-select for a group.'):
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
        <div className="inspector-section" data-testid="runtime-general-profile-authoring">
          <div className="section-head">SELECTED PROFILE → NAMED BODY · FEATUREOPS v1</div>
          <p className="microcopy" data-testid="runtime-general-source">
            {generalCandidate
              ?'Selected SKETCH cycle: '+generalCandidate
              :'Select the actual solved contour in Sketch XY. Source must be current and unambiguous.'}
            {' '}Only a real FEATUREOPS/RUNTIME journal commit produces a feature; generalized
            geometry is analytic preview, not pinned-C++ STEP.
          </p>
          <label className="runtime-scalar"><span>New extrusion feature ID</span>
            <span className="runtime-scalar-control"><input type="text"
              data-testid="runtime-general-extrude-id" value={generalDraft.extrudeId}
              onChange={e=>setGeneralDraft(p=>({...p,extrudeId:e.target.value}))}/></span>
          </label>
          <label className="runtime-scalar"><span>New output body ID</span>
            <span className="runtime-scalar-control"><input type="text"
              data-testid="runtime-general-body-id" value={generalDraft.bodyId}
              onChange={e=>setGeneralDraft(p=>({...p,bodyId:e.target.value}))}/></span>
          </label>
          <label className="runtime-scalar"><span>Extrusion depth · mm</span>
            <span className="runtime-scalar-control"><input type="number" step="any"
              data-testid="runtime-general-depth" min="0.001" max="10000"
              value={generalDraft.depth}
              onChange={e=>setGeneralDraft(p=>({...p,depth:e.target.value}))}/></span>
          </label>
          <button type="button" className="ribbon-button"
            data-testid="runtime-general-create-extrude"
            disabled={!canGeneralCommit} onClick={authorNamedExtrusion}>
            Extrude selected profile into named body</button>
          <label className="runtime-scalar"><span>Existing target body · explicit</span>
            <span className="runtime-scalar-control">
              <select data-testid="runtime-general-target" value={generalBodies.some(
                  b=>b.extrudeId===generalTargetId)?generalTargetId:''}
                onChange={e=>setGeneralTargetId(e.target.value)}>
                <option value="">Choose target body…</option>
                {generalBodies.map(b=><option key={b.extrudeId} value={b.extrudeId}>
                  {b.bodyId} · {b.extrudeId} · {b.depthMm} mm
                </option>)}
              </select>
            </span>
          </label>
          <label className="runtime-scalar"><span>New cut feature ID</span>
            <span className="runtime-scalar-control"><input type="text"
              data-testid="runtime-general-cut-id" value={generalDraft.cutId}
              onChange={e=>setGeneralDraft(p=>({...p,cutId:e.target.value}))}/></span>
          </label>
          <button type="button" className="ribbon-button"
            data-testid="runtime-general-create-cut"
            disabled={!canGeneralCommit||!generalBodies.some(b=>b.extrudeId===generalTargetId)}
            onClick={authorNamedCut}>Cut explicitly selected named body</button>
          <button type="button" className="ribbon-button"
            data-testid="runtime-general-edit-depth"
            disabled={!canGeneralCommit||!generalBodies.some(b=>b.extrudeId===generalTargetId)}
            onClick={redimensionNamedExtrusion}>Reconfigure selected body depth</button>
          <div data-testid="runtime-general-body-status">
            {generalBodies.map(b=><p className="microcopy" key={b.extrudeId}>
              <strong>{b.bodyId}</strong> · {b.extrudeId} · {b.depthMm} mm ·
              {' '}{report.features.find(f=>f.featureId===b.extrudeId)?.status}
            </p>)}
          </div>
          <p className="microcopy">New profile cuts remain pending_exact_provider; downstream
            Boolean/STEP is unsupported until an independent pinned native qualification.
            Edits, Undo/Redo and Worker save/reopen retain the authoritative semantic IDs.</p>
        </div>
        <div className="inspector-section" data-testid="runtime-pointer-profile-editor">
          <div className="section-head">SOLVED CONTOUR · SEMANTIC DIRECT EDIT</div>
          {pointerSelection?<div className="runtime-hole-add">
            <strong data-testid="runtime-pointer-profile-selected">{closedInventory?'Drawn outline · '+closedInventory.contourId:
                pointerInventory?.kind==='pointer_editable_handles'
                  ?pointerInventory.semanticProfileId:'Selection expired / no admitted handles'}</strong>
            {closedInventory?<>
              <label className="runtime-scalar"><span>Selected drawn vertex</span>
                <span className="runtime-scalar-control">
                  <select data-testid="runtime-drawn-vertex-select"
                    aria-label="Explicit drawn contour vertex" value={pointerHandleId}
                    onChange={event=>setPointerHandleId(event.target.value)}>
                    <option value="">Choose a vertex…</option>
                    {closedInventory.handles.map(handle=><option key={handle.handleId} value={handle.handleId}>
                      {handle.kind==='origin'?'Origin':'Vertex '+handle.index} · {handle.handleId}
                    </option>)}
                  </select>
                </span>
              </label>
              <p className="microcopy">Click a blue contour vertex in the sketch to
                select its source-owned handle, or use the list for keyboard/overlapping vertices.
                Selection does not edit the model.</p>
              {closedHandle&&<ClosedContourVertexEditor
                key={pointerSourceArchive+':'+closedHandle.handleId}
                handle={closedHandle} disabled={!!pendingImport||!!loadingFile}
                onCommit={target=>dragDrawnVertex(closedHandle.handleId,target.x,target.y)}/>}
              {closedEdges&&<div className="runtime-hole-add" data-testid="runtime-contour-edge-editor">
                <strong>Whole-edge normal offset · solver-owned</strong>
                <label className="runtime-scalar"><span>Semantic edge</span>
                  <span className="runtime-scalar-control"><select
                    data-testid="runtime-contour-edge-select" aria-label="Select source contour edge"
                    value={closedEdges.edges.some(e=>e.edgeId===selectedContourEdgeId)?selectedContourEdgeId:''}
                    onChange={event=>setSelectedContourEdgeId(event.target.value)}>
                    <option value="">Choose an edge…</option>
                    {closedEdges.edges.map((edge,i)=><option key={edge.edgeId} value={edge.edgeId}>
                      Edge {i+1} · {edge.edgeId} · {edge.lengthMm.toFixed(3)} mm
                    </option>)}
                  </select></span>
                </label>
                <label className="runtime-scalar"><span>Signed outward offset · mm</span>
                  <span className="runtime-scalar-control"><input type="number" step="any"
                    data-testid="runtime-contour-edge-distance" aria-label="Signed normal edge offset in millimetres"
                    value={edgeOffsetDraft} onChange={event=>setEdgeOffsetDraft(event.target.value)}/></span>
                </label>
                <button type="button" className="ribbon-button"
                  data-testid="runtime-contour-edge-commit"
                  disabled={!closedEdges.edges.some(e=>e.edgeId===selectedContourEdgeId)||!!pendingImport||!!loadingFile}
                  onClick={()=>editDrawnEdge(selectedContourEdgeId,undefined,undefined,
                    edgeOffsetDraft.trim()?Number(edgeOffsetDraft):NaN)}>Offset selected edge</button>
                <p className="microcopy">Drag an admitted edge normal to itself, or enter a signed distance.
                  The source-owned SKETCH planner validates all vertices and associated holes;
                  RUNTIME journals one undoable edit. Tangential drag cannot translate the edge.
                  Focus an edge and use ArrowUp/Down for 1 mm (Shift 0.1 mm) nudges.</p>
              <button type="button" className="ribbon-button"
                   data-testid="runtime-tab-start"
                   disabled={!selectedContourEdgeId||!!pendingImport||!!loadingFile||!!tabDraft}
                   onClick={beginTab}>Insert tab on selected edge</button>
                 {tabDraft&&<div data-testid="runtime-tab-draft">
                   <strong>Two-point tab draft · {tabDraft.points.length}/2</strong>
                   <p className="microcopy">Click two positions in Sketch XY, then adjust their
                     sketch-local X/Y values before committing. This is SKETCH-only, not native STEP.
                     Escape or Cancel discards uncommitted points without a revision.</p>
                   {tabDraft.points.map((point,i)=><div className="runtime-hole-add" key={i}
                     data-testid={`runtime-tab-draft-fields-${i}`}>
                     <strong>Tab vertex {i+1} · uncommitted</strong>
                     {(['x','y'] as const).map(axis=><label className="runtime-scalar" key={axis}>
                       <span>{axis.toUpperCase()} · mm</span>
                       <span className="runtime-scalar-control"><input type="number" step="any"
                         key={`${tabDraft.expectedArchive}:${i}:${axis}:${point[axis]}`}
                         defaultValue={point[axis]} disabled={!!pendingImport||!!loadingFile}
                         data-testid={`runtime-tab-draft-${i}-${axis}`}
                         aria-label={`Tab vertex ${i+1} ${axis.toUpperCase()} in millimetres`}
                         onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}
                         onBlur={event=>{
                           const value=event.currentTarget.value;
                           if(!value.trim()||!Number.isFinite(Number(value))||Math.abs(Number(value))>10000){
                             event.currentTarget.value=String(point[axis]);
                           }
                           editTabDraftCoordinate(i,axis,value);
                         }}/><small>mm</small></span>
                     </label>)}
                   </div>)}
                   {tabDraft.points.length===2&&<p className="microcopy" role="status"
                     data-testid="runtime-tab-preflight">
                     {tabPreflight?.kind==='admissible'
                       ?'SKETCH preview admissible for this source and edge; final RUNTIME re-admission required.'
                       :'SKETCH preview refused: '+(tabPreflight?.reason??'source changed or preview unavailable')+
                         '. Correct the draft dimensions or Cancel; no model revision was written.'}
                   </p>}
                   <button type="button" className="ribbon-button" data-testid="runtime-tab-commit"
                     disabled={tabPreflight?.kind!=='admissible'||!!pendingImport||!!loadingFile}
                     onClick={commitTab}>Commit tab</button>
                   <button type="button" className="ribbon-button" data-testid="runtime-tab-cancel"
                     onClick={()=>{setTabDraft(null);setMessage('Tab cancelled; no model revision.');}}>Cancel tab</button>
                 </div>}
               </div>}
              <p className="microcopy">Move a chosen original vertex with the amber sketch handle
                or precise X/Y fields. Only source-fenced, full-SKETCH admitted edits
                become an undoable RUNTIME revision; unsupported profiles remain preview-only.</p>
            </>:tabbedInventory?<>
              <div data-testid="runtime-tabbed-contour">
                <strong>Source-owned tab · {tabbedInventory.tabId}</strong>
                <p className="microcopy">Retired edge {tabbedInventory.retiredEdgeId} is not selectable.
                  This six-vertex outline is SKETCH-admitted analytic geometry; pinned C++ STEP is unqualified for this topology.</p>
                <label className="runtime-scalar"><span>Selected tabbed vertex</span>
                  <span className="runtime-scalar-control"><select
                    data-testid="runtime-tab-vertex-select" aria-label="Selected tabbed contour vertex"
                    value={tabbedHandle?.handleId??''} onChange={event=>setPointerHandleId(event.target.value)}>
                    <option value="">Choose a source vertex…</option>
                    {tabbedInventory.handles.map((handle,i)=><option key={handle.handleId} value={handle.handleId}>
                      {handle.kind==='inserted'?'Inserted tab vertex ':handle.kind==='origin'?'Origin ':'Original vertex '}
                      {i+1} · {handle.handleId}
                    </option>)}
                  </select></span>
                </label>
                <p className="microcopy">Click a blue tab vertex in Sketch XY to select
                  its persisted semantic ID; use the list for overlapping vertices.</p>
                {tabbedHandle&&<ClosedContourVertexEditor
                  key={pointerSourceArchive+':'+tabbedHandle.handleId}
                  handle={tabbedHandle} disabled={!!pendingImport||!!loadingFile}
                  onCommit={target=>editTabVertex(tabbedHandle.handleId,target.x,target.y)}/>}
              </div>
            </>:pointerInventory?.kind==='pointer_editable_handles'?<>
              <label className="runtime-scalar"><span>Drag handle</span>
                <span className="runtime-scalar-control">
                  <select data-testid="runtime-pointer-profile-handle"
                    aria-label="Explicit semantic profile handle" value={pointerHandleId}
                    onChange={event=>setPointerHandleId(event.target.value)}>
                    <option value="">Choose semantic handle…</option>
                    {pointerHandles.map(handle=><option key={handle.handleId} value={handle.handleId}>
                      {handle.handleId} · {handle.kind} {handle.dimensionKind??''}
                    </option>)}
                  </select>
                </span>
              </label>
              <p className="microcopy">One amber handle appears on the sketch after explicit selection. Drag and release to commit one solver-admitted, undoable constraint change. Colocated handles are never chosen by nearest-hit guessing.</p>
              {pointerDragHandle&&<ProfileNumericEditor
                key={history.document.projectId+':'+history.document.revision+':'+pointerDragHandle.handleId}
                handle={pointerDragHandle} disabled={!!pendingImport||!!loadingFile}
                onCommit={target=>dragProfile(pointerDragHandle.handleId,target.x,target.y)}/>}
              
            </>:<p className="microcopy">The sketch source changed or this contour is unsolved. Reselect the current solved contour; no stale drag is permitted.</p>}
            <button type="button" className="ribbon-button" data-testid="runtime-pointer-profile-clear"
              onClick={()=>{setTabDraft(null);setPointerSelection(null);setPointerSourceArchive(null);setPointerHandleId('');setProfilePickMode(false);}}>
              Clear profile selection</button>
          </div>:<p className="microcopy">
            Choose “Select contour”, then click within a solved sketch face.
            This is a source-fenced analytic SKETCH operation; disjoint/multi-contour native geometry remains unsupported.
          </p>}
        </div>
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
        <HistoricalEditInspector key={history.document.projectId+':'+history.document.revision}
          history={history} disabled={!!pendingImport||!!loadingFile}
          onCommit={(next,source)=>{
            if(liveHistory.current!==source)return false;
            acceptHistory(next);return true;
          }} onMessage={setMessage}/>
        <div className="inspector-section">
          <div className="section-head">EDIT RETROSPECTIVE DIMENSIONS</div>
          {sketchValues?(['width','depth','holeDiameter','holePitch'] as const).map(field=><ScalarInput
             key={field+':'+history.document.revision} field={field}
             value={sketchValues[field]} onCommit={update}/>):<p className="microcopy" data-testid="runtime-structural-sketch-dimensions">
             This contour does not use the mounting-plate template's width/height/hole constraints.
             Select a solver-owned contour handle to edit its authentic dimensions.
           </p>}
          {values?<ScalarInput key={'thickness:'+history.document.revision}
             field="thickness" value={values.thickness} onCommit={update}/>:plateActive?<p className="microcopy">
             Extrusion thickness is model-owned. This drawn contour has no seeded fixture dimensions; use the extrusion control and selected handles.
           </p>:generalSolid?<p data-testid="runtime-general-solid-guidance" className="microcopy">
             Named body {generalSelectedBody?.bodyId} has a {generalSelectedBody?.depthMm} mm
             source-bound extrusion preview. Reconfigure its depth in Selected Profile → Named Body;
             choose the target body explicitly for a cut. No native B-rep or STEP is certified.
           </p>:plateAuthored?<p
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
          <SelectedEdgeHoleEditor history={history} disabled={!!pendingImport||!!loadingFile}
            onAccept={(next,id)=>{acceptHistory(next);setSketchMode(true);setActiveHole(id);}}
            onMessage={setMessage}/>
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
          <div className="runtime-hole-add" data-testid="runtime-hole-orbit">
            <strong>Bolt circle · selected source · one-shot</strong>
            <p className="microcopy">Copy a real solved circular hole around an explicit pivot. A full 360° sweep places instances evenly without duplicating the source; a partial signed sweep includes both endpoints. Overlapping or outside holes are refused atomically. The copies are independent SKETCH circles, not an associative feature.</p>
            <label className="runtime-scalar"><span>Source hole</span>
              <span className="runtime-scalar-control">
                <select data-testid="runtime-orbit-source" aria-label="Bolt circle source hole"
                  value={orbitDraft.sourceHoleId} onChange={e=>setOrbitDraft(prev=>({...prev,sourceHoleId:e.target.value}))}>
                  {!Object.hasOwn(holes,orbitDraft.sourceHoleId)&&<option value={orbitDraft.sourceHoleId}>Unavailable: {orbitDraft.sourceHoleId}</option>}
                  {Object.keys(holes).map(id=><option key={id} value={id}>{id}</option>)}
                </select>
              </span>
            </label>
            {(['instances','pivotXmm','pivotYmm','sweepDegrees'] as const).map(field=><label className="runtime-scalar" key={field}>
              <span>{field==='instances'?'Total holes incl. source':field==='pivotXmm'?'Pivot X':field==='pivotYmm'?'Pivot Y':'Signed sweep'}</span>
              <span className="runtime-scalar-control">
                <input data-testid={'runtime-orbit-'+field} type="number"
                  aria-label={field==='instances'?'Bolt circle total instances':field==='pivotXmm'?'Bolt circle pivot X':field==='pivotYmm'?'Bolt circle pivot Y':'Bolt circle sweep degrees'}
                  step={field==='instances'?1:'any'}
                  min={field==='instances'?2:field==='sweepDegrees'?-360:undefined}
                  max={field==='instances'?32:field==='sweepDegrees'?360:undefined}
                  value={orbitDraft[field]}
                  onChange={e=>setOrbitDraft(prev=>({...prev,[field]:e.target.value}))}/>
                {field==='instances'?null:<small>{field==='sweepDegrees'?'°':'mm'}</small>}
              </span>
            </label>)}
            <button type="button" className="ribbon-button runtime-native-export"
              data-testid="runtime-orbit-commit"
              disabled={!!pendingImport||!Object.keys(holes).length}
              onClick={patternCircular}>Create bolt circle</button>
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
            <div className="runtime-hole-add" data-testid="runtime-selected-hole-stamp">
              <strong>Duplicate selected holes · one-shot translation</strong>
              <p className="microcopy">Select 1–32 existing solved holes above, choose a signed displacement and stamp independent copies in one undoable journal operation. The original centres/diameters are preserved. Physical plate-rim and overlap checks run before SKETCH admission; no unqualified geometry is published.</p>
              {(['deltaXmm','deltaYmm'] as const).map(field=><label className="runtime-scalar" key={field}>
                <span>{field==='deltaXmm'?'Copy offset X':'Copy offset Y'}</span>
                <span className="runtime-scalar-control">
                  <input type="number" step="any" data-testid={'runtime-stamp-'+field}
                    aria-label={field==='deltaXmm'?'Stamp selected X offset':'Stamp selected Y offset'}
                    value={stampDraft[field]}
                    onChange={e=>setStampDraft(previous=>({...previous,[field]:e.target.value}))}/>
                  <small>mm</small>
                </span>
              </label>)}
              <button type="button" className="ribbon-button runtime-native-export"
                data-testid="runtime-stamp-apply" disabled={!!pendingImport||layoutIds.length===0}
                onClick={stampSelection}>Duplicate selected holes</button>
              <button type="button" className="ribbon-button"
                data-testid="runtime-stamp-remove-selected"
                disabled={!!pendingImport||layoutIds.length===0||layoutIds.some(id=>id==='holeA'||id==='holeB')}
                onClick={removeSelection}>Remove selected custom holes</button>
              <p className="microcopy">Batch removal is also one undoable edit. Base holes A/B cannot be removed because plate dimensions reference them. A successful operation revokes cached native STEP and keeps the source sketch authoritative.</p>
            </div>
            <div className="runtime-hole-add" data-testid="runtime-rigid-transform">
              <strong>Rigidly rotate/move selected holes · one transaction</strong>
              <p className="microcopy">Select two or more holes above, then rotate them about their authoritative centre (mean of selected fixed centres). Signed rotation is anticlockwise, followed by X/Y translation. This is a one-shot journal edit, not an associative transform.</p>
              {(['translateXmm','translateYmm','rotateDegrees'] as const).map(field=><label className="runtime-scalar" key={field}>
                <span>{field==='translateXmm'?'X translation':field==='translateYmm'?'Y translation':'Signed rotation'}</span>
                <span className="runtime-scalar-control">
                  <input type="number" step="any" data-testid={`runtime-rigid-${field}`}
                    aria-label={field==='translateXmm'?'Rigid X translation':field==='translateYmm'?'Rigid Y translation':'Rigid rotation degrees'}
                    value={rigidDraft[field]}
                    onChange={e=>setRigidDraft(previous=>({...previous,[field]:e.target.value}))}/>
                  <small>{field==='rotateDegrees'?'°':'mm'}</small>
                </span>
              </label>)}
              <button type="button" className="ribbon-button runtime-native-export"
                data-testid="runtime-rigid-apply" disabled={!!pendingImport||layoutIds.length<2}
                onClick={applyRigidTransform}>Rotate / move selected holes</button>
              <p className="microcopy">Undo restores every selected centre in one step. Collision/out-of-profile proposals are refused and old STEP receipts cannot be reused.</p>
            </div>
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
            {modelHoleIsCartesian(history,hole)?HOLE_FIELDS.map(field=><HoleScalarInput
              key={`${hole}.${field}.${history.document.revision}`}
              hole={hole} field={field} value={holes[hole][field]} onCommit={editHole}/>):
              <p className="microcopy" data-testid={`runtime-anchored-hole-${hole}`}>
                Edge-anchored position and radius use signed relative constraints. Edit or remove them in the selected-contour edge panel; generic fixed-centre gestures are intentionally blocked.
              </p>}
          </div>)}
          <p className="microcopy">Every added circle has a stable authored ID and fixed-centre/radius constraints. Drag its centre or amber diameter handle, edit its diameter here, undo/redo, or save and reopen the authoritative model. The base A/B diameter handles also drag. Add/remove requires SKETCH admission; preview and native STEP must rebuild after edits.</p>
        </div>
        <div className="inspector-section runtime-native" data-testid="runtime-native-panel">
          <div className="section-head">LOCAL NATIVE STEP · SOURCE-FENCED</div>
          <p className="microcopy" data-testid="runtime-native-provider-state" role="status">
            <strong>{nativeIndicator.label}</strong> · {nativeIndicator.detail}
          </p>
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
              }}/> Live native rebuild after each accepted edit (250 ms coalescing)</span>
          </label>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-build" onClick={()=>void rebuildNative('prepare')}
            disabled={!geom || !cutActive || !!pendingImport || nativeBusy || !nativeUrl.trim() || !/^[a-f0-9]{64}$/.test(nativeToken.trim())}>
            {nativeBusy?'Rebuilding local solid…':'Rebuild local solid + STEP'}
          </button>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-export" onClick={()=>void rebuildNative('experimental-step')}
            disabled={!geom || !cutActive || !!pendingImport || nativeBusy || !nativeUrl.trim() || !/^[a-f0-9]{64}$/.test(nativeToken.trim())}>
            {nativeBusy?'Building source-bound STEP…':'Build and download current STEP'}
          </button>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-download-cached"
            disabled={nativeBusy || !!pendingImport || !nativeSession.current?.currentStep()}
            onClick={downloadCachedStep}>{nativeSnapshot.stepAvailability==='last_good'
              ?'Download retained last-good STEP':'Download current STEP'}</button>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-evidence-zip"
            disabled={nativeBusy || !!pendingImport || !pinnedEvidenceReady}
            onClick={downloadPinnedEvidence}>Download pinned STEP evidence ZIP</button>
          <button type="button" className="ribbon-button runtime-native-export"
            data-testid="runtime-native-build-pinned-evidence"
            disabled={!geom || !cutActive || !!pendingImport || nativeBusy || !nativeUrl.trim() || !/^[a-f0-9]{64}$/.test(nativeToken.trim())}
            onClick={()=>void rebuildNative('pinned-evidence')}>
            {nativeBusy?'Evaluating native source…':'Build pinned STEP + download evidence ZIP'}
          </button>
          <p className="microcopy">Single-action source custody: evaluate this authoritative journal revision, then atomically capture the returned RUNTIME archive, pinned C++ receipt and STEP bytes into one ZIP. A missing/stale or experimental OCP provider returns a refusal, without a substitute ZIP. The existing two-step build and download controls remain available.</p>
          <p className="microcopy">Pinned OCCT 8.0.1 C++ only: this button enables after a revision-matched native result. It captures the authoritative model archive, producer receipt and exact STEP bytes together in one ZIP for independent CAD verification. A missing/stale/OCP result cannot publish evidence. The ZIP alone does not prove native build provenance or external STEP interoperability.</p>
          {nativeBusy&&<button type="button" className="ribbon-button"
            data-testid="runtime-native-cancel" onClick={()=>{invalidateNative();setNativeReport('Native evaluation cancelled; no STEP published.');}}>Cancel native evaluation</button>}
          {nativeEvidence&&<div className="runtime-native-evidence" data-testid="runtime-native-evidence" role="status">
            <strong>Native provider result · revision {nativeEvidence.revision}</strong>
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
    <footer className="statusbar">LOCAL MODEL + SKETCH · INTENT JOURNAL · VIEWPORT PREVIEW ONLY · DROP MODEL JSON TO OPEN
      <span className="status-spacer"/> {report.revision} accepted journal events · {nativeIndicator.label}</footer>
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
      <p data-testid="runtime-import-stage">Stage: {importStage==='reading'
        ?'Reading selected file in isolated worker'
        :importStage==='validating'?'Checking authoritative journal, undo history and sketch'
        :'Returning validated model for confirmation'}.</p>
      <p>Checking {loadingFile} in an isolated worker. Your current model remains unchanged;
        you can cancel without authoring a new revision.</p>
      <div className="recovery-actions">
        <button type="button" data-testid="runtime-import-processing-cancel"
          onClick={()=>{noteImportStage('cancelled');cancelActiveImport();setMessage('Archive import cancelled; current model retained.');}}>
          Cancel import</button>
          <button type="button" data-testid="runtime-import-trace-processing"
            onClick={downloadImportTrace}>Download privacy-safe stage trace</button>
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
        <button data-testid="runtime-import-review-cancel" onClick={()=>{if(pendingImport.origin!=='new')noteImportStage('cancelled');cancelActiveImport();setPendingImport(null);}}>Cancel</button>
        <button data-testid="runtime-import-review-confirm" onClick={useIncoming}>Replace with model archive</button>
        {pendingImport.origin!=='new'&&<button type="button" data-testid="runtime-import-trace-review"
          onClick={downloadImportTrace}>Download privacy-safe stage trace</button>}
      </div>
    </section></div>}
  </div>;
}
