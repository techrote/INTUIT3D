/**
 * FEATUREOPS selected-contour-notch/v1.
 * A direct, dimensioned user edit to the authoritative SKETCH driving a named
 * extruded body. SKETCH owns notch geometry; INTENT/RUNTIME own edit and replay.
 * This command is NOT a native Boolean, B-rep, or STEP operation.
 */
export const CONTOUR_NOTCH_FORMAT='intuit3d.feature-ops.selected-contour-notch';
export const CONTOUR_NOTCH_VERSION=1;
const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fail(reason){throw new TypeError('feature-ops contour notch: '+reason);}
function exact(x,keys,label){
  if(!plain(x)||Object.keys(x).length!==keys.length||
     keys.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!keys.includes(k)))
    fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!IDENT.test(x))fail('invalid '+label);return x;}
const reportRow=(report,fid)=>report.features?.find(row=>row.featureId===fid);
const common=['format','version','expectedProjectId','expectedRevision','eventId',
  'units','frame','sourceSketchId','extrudeFeatureId','targetBodyId','selection','notchId'];

function setup(history,request,services,mode){
  const keys=mode==='create'?[...common,'edgeId','fromMm','toMm','depthMm']:
    mode==='dimensions'?[...common,'fromMm','toMm','depthMm']:
      [...common,'handleId','target'];
  exact(request,keys,'request');
  if(request.format!==CONTOUR_NOTCH_FORMAT||request.version!==1||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported contract, unit or coordinate frame');
  if(!history?.document||request.expectedProjectId!==history.document.projectId||
     !Number.isSafeInteger(request.expectedRevision)||
     request.expectedRevision!==history.document.revision)
    throw new Error('feature-ops contour notch: stale project/revision');
  const sourceSketchId=id(request.sourceSketchId,'sourceSketchId');
  const extrudeFeatureId=id(request.extrudeFeatureId,'extrudeFeatureId');
  const targetBodyId=id(request.targetBodyId,'targetBodyId');
  const notchId=id(request.notchId,'notchId');
  const eventId=id(request.eventId,'eventId');
  if(new Set([sourceSketchId,extrudeFeatureId,targetBodyId,notchId]).size!==4)
    fail('aliased semantic identities');
  exact(request.selection,['candidateId','sourceSignature'],'selection');
  if(typeof request.selection.candidateId!=='string'||
     !request.selection.candidateId.startsWith('cycle:')||
     request.selection.candidateId.length>8192||
     typeof request.selection.sourceSignature!=='string')
    fail('invalid selected SKETCH profile fence');
  const {runtime,model,sketch,discovery,notch}=services??{};
  if(typeof runtime?.inspect!=='function'||typeof runtime?.commit!=='function'||
     typeof runtime?.diff!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||typeof sketch?.serializeSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof notch?.createSelectedEdgeNotch!=='function'||
     typeof notch?.inspectSelectedEdgeNotch!=='function'||
     typeof notch?.editSelectedEdgeNotch!=='function'||
     typeof notch?.dragSelectedEdgeNotchHandle!=='function')
    fail('accepted SKETCH notch, INTENT and RUNTIME services required');
  const features=model.featuresOf(history.document);
  const source=features.find(f=>f.id===sourceSketchId);
  const extrude=features.find(f=>f.id===extrudeFeatureId);
  if(source?.kind!=='sketch'||!source.payload?.sketch||
     !same(source.writeTargets,[])||
     extrude?.kind!=='extrude'||!same(extrude.writeTargets,[targetBodyId])||
     extrude.payload?.sourceSketchId!==sourceSketchId||
     !extrude.dependsOn.includes(sourceSketchId))
    fail('selected sketch/extrusion does not author the explicit target body');
  const current=sketch.validateSketch(source.payload.sketch);
  const stamp=sketch.serializeSketch(current);
  if(request.selection.sourceSignature!==stamp)
    fail('stale selected source signature');
  if(Object.hasOwn(source.payload,'selectedProfileSelection') &&
     !same(source.payload.selectedProfileSelection,request.selection))
    fail('persisted selected profile changed; reselect explicitly');
  if(mode!=='create'&&
     !same(source.payload.selectedProfileSelection,request.selection))
    fail('existing notch requires persisted current selection');
  const proposals=discovery.discoverPlateProfiles(current);
  if(proposals.status!=='ready'||proposals.candidates?.length!==1||
     proposals.candidates[0].id!==request.selection.candidateId)
    fail('selected contour ambiguous, missing or changed');
  const admitted=discovery.admitDiscoveredPlateProfile(
    current,proposals,request.selection.candidateId);
  const before=runtime.inspect(history);
  const sketchState=reportRow(before,sourceSketchId);
  const extrudeState=reportRow(before,extrudeFeatureId);
  if(sketchState?.status!=='analytic_profile_only'||
     !same(sketchState.profile,admitted)||
     extrudeState?.status!=='preview_only'||
     extrudeState.bodyId!==targetBodyId)
    fail('RUNTIME has not admitted this selected body and solved sketch');
  return {runtime,model,sketch,discovery,notch,source,extrude,current,stamp,
    sourceSketchId,extrudeFeatureId,targetBodyId,notchId,eventId};
}

function apply(history,request,services,mode){
  const s=setup(history,request,services,mode);
  if(mode==='create')id(request.edgeId,'selected edgeId');
  if(mode==='drag'){
    id(request.handleId,'notch handleId');
    exact(request.target,['x','y'],'drag point');
    if(!Number.isFinite(request.target.x)||!Number.isFinite(request.target.y))
      fail('invalid drag coordinates');
  }
  const cmd=mode==='drag'?
    {version:1,sourceSignature:s.stamp,notchId:s.notchId,
      handleId:request.handleId,target:request.target}:
    {kind:mode==='create'?'create-edge-notch':'edit-edge-notch',
      version:1,sourceSignature:s.stamp,notchId:s.notchId,
      ...(mode==='create'?{edgeId:request.edgeId}:{}),
      fromMm:request.fromMm,toMm:request.toMm,depthMm:request.depthMm};
  const result=mode==='create'?
    s.notch.createSelectedEdgeNotch(s.current,request.selection,cmd):
    mode==='drag'?
      s.notch.dragSelectedEdgeNotchHandle(s.current,request.selection,cmd):
      s.notch.editSelectedEdgeNotch(s.current,request.selection,cmd);
  if(result?.kind!=='accepted')
    fail('SKETCH refused '+(result?.reason??'unknown notch request'));
  if(result.previewOnly!==true||result.nativeExact!==false||
     result.exactBrepAvailable!==false||result.independentStepQualified!==false||
     result.sourceSignature!==s.stamp||
     !result.selection||!result.sketch||
     result.notchId!==s.notchId)
    fail('SKETCH returned unexpected authority or identities');
  const nextSketch=s.sketch.validateSketch(result.sketch);
  if(s.sketch.serializeSketch(nextSketch)!==result.nextSourceSignature||
     result.selection.sourceSignature!==result.nextSourceSignature||
     result.selection.candidateId!==result.nextCandidateId)
    fail('SKETCH returned inconsistent successor selection');
  const proposals=s.discovery.discoverPlateProfiles(nextSketch);
  if(proposals.status!=='ready'||proposals.candidates?.length!==1||
     proposals.candidates[0].id!==result.selection.candidateId)
    fail('successor contour is no longer uniquely admissible');
  const successor=s.discovery.admitDiscoveredPlateProfile(
    nextSketch,proposals,result.selection.candidateId);
  // Both the edited sketch and its successor selection must be journalled
  // together. An old profile candidate must never silently be reused.
  const next=s.runtime.commit(history,[{
    eventId:s.eventId,type:'feature.edit',featureId:s.sourceSketchId,
    patch:{payload:{...s.source.payload,sketch:nextSketch,
      selectedProfileSelection:result.selection}}
  }],request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+1||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops contour notch: commit was not one atomic undo frame');
  const stored=s.model.featuresOf(next.document).find(f=>f.id===s.sourceSketchId);
  const report=s.runtime.inspect(next);
  if(!same(stored?.payload?.selectedProfileSelection,result.selection)||
     s.sketch.serializeSketch(stored?.payload?.sketch)!==result.nextSourceSignature||
     reportRow(report,s.sourceSketchId)?.status!=='analytic_profile_only'||
     !same(reportRow(report,s.sourceSketchId).profile,successor)||
     reportRow(report,s.extrudeFeatureId)?.status!=='preview_only')
    throw new Error('feature-ops contour notch: committed selected profile not admitted');
  const invalidation=s.runtime.diff(history,next);
  if(!invalidation?.invalidatedFeatureIds?.includes(s.sourceSketchId)||
     !invalidation.invalidatedFeatureIds.includes(s.extrudeFeatureId))
    throw new Error('feature-ops contour notch: missing dependent extrusion invalidation');
  const inspection=s.notch.inspectSelectedEdgeNotch(
    nextSketch,result.selection,s.notchId);
  if(inspection.kind!=='selected_edge_notch')
    throw new Error('feature-ops contour notch: persisted notch not inspectable');
  return {kind:'committed',history:next,report,invalidation,
    semanticIds:{sourceSketchId:s.sourceSketchId,
      extrudeFeatureId:s.extrudeFeatureId,targetBodyId:s.targetBodyId,notchId:s.notchId},
    selectedProfile:result.selection,notch:inspection,
    gesture:result.gesture??null,status:'analytic_profile_only',
    nativeHandoff:{kind:'rebuild_selected_profile_body',bodyId:s.targetBodyId,
      extrusionId:s.extrudeFeatureId,sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}

/** Trim a selected, constrained body contour edge; one model undo frame. */
export function authorSelectedContourNotch(history,request,services){
  return apply(history,request,services,'create');
}
/** Retrospectively edit the notch's three actual solver dimensions. */
export function editSelectedContourNotch(history,request,services){
  return apply(history,request,services,'dimensions');
}
/** Commit a named SKETCH notch handle drag as one model edit. */
export function dragSelectedContourNotch(history,request,services){
  return apply(history,request,services,'drag');
}
