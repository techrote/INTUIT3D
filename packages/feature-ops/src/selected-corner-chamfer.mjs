/**
 * FEATUREOPS selected-corner-chamfer/v1 — two independently editable setbacks
 * on a named, extruded, model-owned linear SKETCH contour. The SKETCH adapter
 * owns the bevel geometry, INTENT/RUNTIME own revisioned history and rebuild.
 * No native Boolean, chamfer-on-B-rep or STEP truth is claimed.
 */
export const CORNER_CHAMFER_FORMAT='intuit3d.feature-ops.selected-corner-chamfer';
export const CORNER_CHAMFER_VERSION=1;

const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const row=(report,id)=>report.features?.find(x=>x.featureId===id);
function fail(message){throw new TypeError('feature-ops corner chamfer: '+message);}
function exact(value,fields,label){
  if(!plain(value)||Object.keys(value).length!==fields.length||
     fields.some(k=>!Object.hasOwn(value,k))||
     Object.keys(value).some(k=>!fields.includes(k)))
    fail('invalid '+label);
}
function id(value,label){
  if(typeof value!=='string'||!ID.test(value))fail('invalid '+label);
  return value;
}
const common=['format','version','expectedProjectId','expectedRevision',
  'eventId','units','frame','sourceSketchId','extrudeFeatureId','targetBodyId',
  'expectedCutFeatureIds','selection','chamferId'];

function preflight(history,request,services,mode){
  const fields=mode==='create'?[...common,'cornerPointId','incomingMm','outgoingMm']:
    mode==='edit'?[...common,'incomingMm','outgoingMm']:
      [...common,'handleId','target'];
  exact(request,fields,'versioned command');
  if(request.format!==CORNER_CHAMFER_FORMAT||request.version!==1||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported protocol, units or frame');
  if(!history?.document||request.expectedProjectId!==history.document.projectId||
     !Number.isSafeInteger(request.expectedRevision)||
     request.expectedRevision!==history.document.revision)
    throw new Error('feature-ops corner chamfer: stale project/revision');
  const sourceSketchId=id(request.sourceSketchId,'source sketch');
  const extrudeFeatureId=id(request.extrudeFeatureId,'extrusion');
  const targetBodyId=id(request.targetBodyId,'body');
  const chamferId=id(request.chamferId,'chamfer');
  const eventId=id(request.eventId,'event');
  if(new Set([sourceSketchId,extrudeFeatureId,targetBodyId,chamferId]).size!==4)
    fail('aliased semantic identities');
  exact(request.selection,['candidateId','sourceSignature'],'profile selection');
  if(typeof request.selection.candidateId!=='string'||
     !request.selection.candidateId.startsWith('cycle:')||
     request.selection.candidateId.length>8192||
     typeof request.selection.sourceSignature!=='string')
    fail('invalid selected profile fence');
  if(!Array.isArray(request.expectedCutFeatureIds)||
     request.expectedCutFeatureIds.length>64||
     new Set(request.expectedCutFeatureIds).size!==request.expectedCutFeatureIds.length)
    fail('invalid dependent cut selection');
  request.expectedCutFeatureIds.forEach(x=>id(x,'cut id'));
  const {runtime,model,sketch,discovery,chamfer}=services??{};
  if(typeof runtime?.commit!=='function'||typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||typeof sketch?.serializeSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof chamfer?.createSelectedCornerChamfer!=='function'||
     typeof chamfer?.inspectSelectedCornerChamfer!=='function'||
     typeof chamfer?.editSelectedCornerChamfer!=='function'||
     typeof chamfer?.dragSelectedCornerChamferHandle!=='function')
    fail('accepted RUNTIME, INTENT, SKETCH and chamfer services required');
  const features=model.featuresOf(history.document);
  const source=features.find(f=>f.id===sourceSketchId);
  const extrude=features.find(f=>f.id===extrudeFeatureId);
  if(source?.kind!=='sketch'||!source.payload?.sketch||
     !equal(source.writeTargets,[])||
     extrude?.kind!=='extrude'||!equal(extrude.writeTargets,[targetBodyId])||
     extrude.payload?.sourceSketchId!==sourceSketchId||
     !extrude.dependsOn?.includes(sourceSketchId))
    fail('selected sketch/extrusion does not author the named body');
  // A cut is downstream of the extrusion or its ordered predecessors; never
  // silently choose a different body or let a stale inspector omit a cut.
  const actualCuts=features.filter(f=>f.kind==='cut'&&
    f.writeTargets?.includes(targetBodyId)).map(f=>f.id);
  if(!equal(actualCuts,request.expectedCutFeatureIds))
    fail('dependent body cut selection changed');
  const cuts=actualCuts.map(fid=>features.find(f=>f.id===fid));
  if(cuts.some(f=>!equal(f.writeTargets,[targetBodyId])||
       f.payload?.targetBodyId!==targetBodyId)||
     features.some(f=>f.id!==extrudeFeatureId&&
       f.writeTargets?.includes(targetBodyId)&&f.kind!=='cut'))
    fail('ambiguous body writer lineage');
  const current=sketch.validateSketch(source.payload.sketch);
  const stamp=sketch.serializeSketch(current);
  if(request.selection.sourceSignature!==stamp)
    fail('stale selected SKETCH source signature');
  if(Object.hasOwn(source.payload,'selectedProfileSelection')&&
     !equal(source.payload.selectedProfileSelection,request.selection))
    fail('persisted profile selection differs from request');
  if(mode!=='create'&&
     !equal(source.payload.selectedProfileSelection,request.selection))
    fail('edited chamfer requires a persisted current selection');
  const discovered=discovery.discoverPlateProfiles(current);
  if(discovered.status!=='ready'||discovered.candidates?.length!==1||
     discovered.candidates[0].id!==request.selection.candidateId)
    fail('selected contour is missing or ambiguous');
  const admitted=discovery.admitDiscoveredPlateProfile(
    current,discovered,request.selection.candidateId);
  const before=runtime.inspect(history);
  if(row(before,sourceSketchId)?.status!=='analytic_profile_only'||
     !equal(row(before,sourceSketchId).profile,admitted)||
     row(before,extrudeFeatureId)?.status!=='preview_only'||
     row(before,extrudeFeatureId).bodyId!==targetBodyId||
     actualCuts.some(fid=>!['pending_exact_provider','blocked_dependency']
       .includes(row(before,fid)?.status)))
    fail('RUNTIME did not admit the selected sketch/body dependency chain');
  return {runtime,model,sketch,discovery,chamfer,source,current,stamp,
    sourceSketchId,extrudeFeatureId,targetBodyId,chamferId,eventId,actualCuts};
}

function apply(history,request,services,mode){
  const s=preflight(history,request,services,mode);
  if(mode==='create')id(request.cornerPointId,'selected corner point');
  if(mode==='drag'){
    id(request.handleId,'chamfer handle');
    exact(request.target,['x','y'],'drag target');
    if(!Number.isFinite(request.target.x)||!Number.isFinite(request.target.y))
      fail('finite drag target required');
  }
  const command=mode==='create'?
    {kind:'create-corner-chamfer',version:1,sourceSignature:s.stamp,
      chamferId:s.chamferId,cornerPointId:request.cornerPointId,
      incomingMm:request.incomingMm,outgoingMm:request.outgoingMm}:
    mode==='edit'?
      {kind:'edit-corner-chamfer',version:1,sourceSignature:s.stamp,
        chamferId:s.chamferId,incomingMm:request.incomingMm,
        outgoingMm:request.outgoingMm}:
      {version:1,sourceSignature:s.stamp,chamferId:s.chamferId,
        handleId:request.handleId,target:request.target};
  const result=mode==='create'?
    s.chamfer.createSelectedCornerChamfer(s.current,request.selection,command):
    mode==='edit'?
      s.chamfer.editSelectedCornerChamfer(s.current,request.selection,command):
      s.chamfer.dragSelectedCornerChamferHandle(s.current,request.selection,command);
  if(result?.kind!=='accepted')
    fail('SKETCH refused '+(result?.reason??'unknown chamfer request'));
  if(result.previewOnly!==true||result.nativeExact!==false||
     result.exactBrepAvailable!==false||result.independentStepQualified!==false||
     result.sourceSignature!==s.stamp||result.chamferId!==s.chamferId||
     !result.sketch||!result.selection||result.solverStatus!=='solved'||
     result.degreesOfFreedom!==0)
    fail('SKETCH returned inconsistent authority, identity or solver state');
  const nextSketch=s.sketch.validateSketch(result.sketch);
  const nextSignature=s.sketch.serializeSketch(nextSketch);
  if(nextSignature!==result.nextSourceSignature||
     result.selection.sourceSignature!==nextSignature||
     result.selection.candidateId!==result.nextCandidateId)
    fail('SKETCH successor signature or profile selection mismatch');
  const discovered=s.discovery.discoverPlateProfiles(nextSketch);
  if(discovered.status!=='ready'||discovered.candidates?.length!==1||
     discovered.candidates[0].id!==result.nextCandidateId)
    fail('successor contour is not uniquely admitted');
  s.discovery.admitDiscoveredPlateProfile(nextSketch,discovered,result.nextCandidateId);
  const next=s.runtime.commit(history,[{
    eventId:s.eventId,type:'feature.edit',featureId:s.sourceSketchId,
    patch:{payload:{...s.source.payload,sketch:nextSketch,
      selectedProfileSelection:result.selection}}
  }],request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+1||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops corner chamfer: not one atomic undo frame');
  const stored=s.model.featuresOf(next.document).find(f=>f.id===s.sourceSketchId);
  const report=s.runtime.inspect(next);
  if(!equal(stored?.payload?.selectedProfileSelection,result.selection)||
     s.sketch.serializeSketch(stored.payload.sketch)!==nextSignature||
     row(report,s.sourceSketchId)?.status!=='analytic_profile_only'||
     row(report,s.extrudeFeatureId)?.status!=='preview_only'||
     s.actualCuts.some(fid=>!['pending_exact_provider','blocked_dependency']
       .includes(row(report,fid)?.status)))
    throw new Error('feature-ops corner chamfer: committed contour/body not admitted');
  const invalidation=s.runtime.diff(history,next);
  if(![s.sourceSketchId,s.extrudeFeatureId,...s.actualCuts].every(
    fid=>invalidation?.invalidatedFeatureIds?.includes(fid)))
    throw new Error('feature-ops corner chamfer: dependent body invalidation incomplete');
  const inspection=s.chamfer.inspectSelectedCornerChamfer(
    nextSketch,result.selection,s.chamferId);
  if(inspection.kind!=='selected_corner_chamfer'||
     inspection.chamferId!==s.chamferId)
    throw new Error('feature-ops corner chamfer: saved geometry not inspectable');
  return {kind:'committed',history:next,report,invalidation,
    semanticIds:{sourceSketchId:s.sourceSketchId,extrudeFeatureId:s.extrudeFeatureId,
      targetBodyId:s.targetBodyId,chamferId:s.chamferId,cutFeatureIds:s.actualCuts},
    selectedProfile:result.selection,chamfer:inspection,
    gesture:result.gesture??null,status:'analytic_profile_only',
    nativeHandoff:{kind:'rebuild_selected_profile_body',bodyId:s.targetBodyId,
      extrusionId:s.extrudeFeatureId,sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}

/** Two independently dimensioned setbacks on a user-selected convex corner. */
export function authorSelectedCornerChamfer(history,request,services){
  return apply(history,request,services,'create');
}
/** Retrospective numeric edit without replacing the chamfer or body IDs. */
export function editSelectedCornerChamfer(history,request,services){
  return apply(history,request,services,'edit');
}
/** Commit SKETCH's projected setback handle drag as one model journal step. */
export function dragSelectedCornerChamfer(history,request,services){
  return apply(history,request,services,'drag');
}
