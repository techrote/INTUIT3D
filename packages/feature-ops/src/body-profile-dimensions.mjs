/**
 * FEATUREOPS body-profile-dimensions/v1: edit actual authored, selected
 * SKETCH dimensions of a model-owned extrusion. This is a consumer bridge:
 * SKETCH owns solving/admission, RUNTIME owns journaling/rebuild and the
 * provider owns physical geometry. No B-rep or STEP result is fabricated.
 */
export const BODY_PROFILE_DIMENSIONS_FORMAT='intuit3d.feature-ops.body-profile-dimensions';
export const BODY_PROFILE_DIMENSIONS_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const row=(r,id)=>r.features?.find(x=>x.featureId===id);
const fail=x=>{throw new TypeError('feature-ops body profile dimensions: '+x);};
function exact(value,fields,label){
  if(!plain(value)||Object.keys(value).length!==fields.length||
    fields.some(k=>!Object.hasOwn(value,k))||
    Object.keys(value).some(k=>!fields.includes(k)))fail('invalid '+label);
}
function id(value,label){
  if(typeof value!=='string'||!ID.test(value))fail('invalid '+label);
  return value;
}
const selectionFields=['candidateId','sourceSignature'];
const common=['format','version','expectedProjectId','expectedRevision','units',
  'frame','sourceSketchId','extrudeFeatureId','targetBodyId','selection'];
function closure(features,sourceId){
  const dependencies=new Set([sourceId]);
  let progress=true;
  while(progress){
    progress=false;
    for(const f of features)if(!dependencies.has(f.id)&&
      f.dependsOn?.some(x=>dependencies.has(x))){
      dependencies.add(f.id);progress=true;
    }
  }
  return [...dependencies].sort();
}
function preflight(history,request,services,mode){
  const fields=mode==='inspect'?common:mode==='edit'?
    [...common,'expectedAffectedFeatureIds','eventId','changes']:
    [...common,'expectedAffectedFeatureIds','eventId','handleId','target'];
  exact(request,fields,'versioned request');
  if(request.format!==BODY_PROFILE_DIMENSIONS_FORMAT||
    request.version!==BODY_PROFILE_DIMENSIONS_VERSION||
    request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported format, version, units or frame');
  if(!history?.document||
    request.expectedProjectId!==history.document.projectId||
    !Number.isSafeInteger(request.expectedRevision)||
    request.expectedRevision!==history.document.revision)
    throw new Error('feature-ops body profile dimensions: stale project/revision');
  const sourceSketchId=id(request.sourceSketchId,'source sketch ID');
  const extrudeFeatureId=id(request.extrudeFeatureId,'extrusion ID');
  const targetBodyId=id(request.targetBodyId,'body ID');
  if(new Set([sourceSketchId,extrudeFeatureId,targetBodyId]).size!==3)
    fail('aliased sketch/extrusion/body IDs');
  exact(request.selection,selectionFields,'selected profile fence');
  if(typeof request.selection.candidateId!=='string'||
     !request.selection.candidateId.startsWith('cycle:')||
     request.selection.candidateId.length>8192||
     typeof request.selection.sourceSignature!=='string')
    fail('explicit canonical SKETCH profile and signature required');
  const {runtime,model,sketch,discovery,profileDimensions}=services??{};
  if(typeof runtime?.commit!=='function'||typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||typeof sketch?.serializeSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof profileDimensions?.inspectSelectedProfileDimensions!=='function'||
     typeof profileDimensions?.editSelectedProfileDimensions!=='function'||
     typeof profileDimensions?.dragSelectedProfileDimension!=='function')
    fail('accepted INTENT/SKETCH/RUNTIME/dimension services required');
  const features=model.featuresOf(history.document);
  const source=features.find(f=>f.id===sourceSketchId);
  const extrude=features.find(f=>f.id===extrudeFeatureId);
  if(source?.kind!=='sketch'||!source.payload?.sketch||
     !same(source.writeTargets,[])||extrude?.kind!=='extrude'||
     !same(extrude.writeTargets,[targetBodyId])||
     extrude.payload?.sourceSketchId!==sourceSketchId||
     !extrude.dependsOn?.includes(sourceSketchId))
    fail('selected sketch/extrusion do not author explicitly named body');
  if(features.some(f=>f.id!==extrudeFeatureId&&f.kind==='extrude'&&
     f.writeTargets?.includes(targetBodyId)))
    fail('ambiguous extrusion body owner');
  const affectedFeatureIds=closure(features,sourceSketchId);
  if(mode!=='inspect'){
    id(request.eventId,'event ID');
    if(!Array.isArray(request.expectedAffectedFeatureIds)||
       new Set(request.expectedAffectedFeatureIds).size!==
       request.expectedAffectedFeatureIds.length||
       !request.expectedAffectedFeatureIds.every(x=>typeof x==='string')||
       !same([...request.expectedAffectedFeatureIds].sort(),affectedFeatureIds))
      fail('stale or incomplete transitive affected-feature selection');
  }
  const current=sketch.validateSketch(source.payload.sketch);
  const signature=sketch.serializeSketch(current);
  if(signature!==request.selection.sourceSignature||
     !same(source.payload.selectedProfileSelection,request.selection))
    fail('stale or unpersisted source/profile selection');
  const proposed=discovery.discoverPlateProfiles(current);
  if(proposed.status!=='ready'||proposed.candidates?.length!==1||
     proposed.candidates[0].id!==request.selection.candidateId)
    fail('selected contour is missing, changed or ambiguous');
  const admitted=discovery.admitDiscoveredPlateProfile(
    current,proposed,request.selection.candidateId);
  const before=runtime.inspect(history);
  if(row(before,sourceSketchId)?.status!=='analytic_profile_only'||
     !same(row(before,sourceSketchId).profile,admitted)||
     row(before,extrudeFeatureId)?.status!=='preview_only'||
     row(before,extrudeFeatureId).bodyId!==targetBodyId)
    fail('RUNTIME has not admitted selected solved sketch/body');
  const dimensions=profileDimensions.inspectSelectedProfileDimensions(
    current,request.selection);
  if(dimensions.kind!=='selected_profile_dimensions'||
     dimensions.solverStatus!=='solved'||
     dimensions.sourceSignature!==signature)
    fail('selected SKETCH dimensions are not solvable/editable');
  return {runtime,model,sketch,discovery,profileDimensions,features,source,
    current,signature,affectedFeatureIds,dimensions,
    sourceSketchId,extrudeFeatureId,targetBodyId,before};
}
/** Inspect first: the returned affected list is an explicit apply-time fence. */
export function inspectSelectedBodyProfileDimensions(history,request,services){
  const s=preflight(history,request,services,'inspect');
  return {kind:'body_profile_dimensions',format:BODY_PROFILE_DIMENSIONS_FORMAT,
    version:1,projectId:history.document.projectId,
    revision:history.document.revision,sourceSignature:s.signature,
    selection:request.selection,semanticIds:{
      sourceSketchId:s.sourceSketchId,extrudeFeatureId:s.extrudeFeatureId,
      targetBodyId:s.targetBodyId},
    affectedFeatureIds:s.affectedFeatureIds,
    dimensions:s.dimensions.dimensions,solverStatus:'solved',
    status:'analytic_profile_only',previewOnly:true,exactAuthority:false,
    independentInteroperability:false};
}
function apply(history,request,services,mode){
  const s=preflight(history,request,services,mode);
  let result;
  if(mode==='edit'){
    if(!Array.isArray(request.changes)||request.changes.length<1||
      request.changes.length>16)fail('1–16 dimensions required');
    const accepted=new Map(s.dimensions.dimensions.map(d=>[d.constraintId,d.value]));
    const seen=new Set();
    const changes=request.changes.map(change=>{
      exact(change,['constraintId','expectedValueMm','valueMm'],'dimension change');
      id(change.constraintId,'constraint ID');
      if(seen.has(change.constraintId)||!accepted.has(change.constraintId)||
        !Number.isFinite(change.expectedValueMm)||
        !Number.isFinite(change.valueMm)||
        accepted.get(change.constraintId)!==change.expectedValueMm)
        fail('stale, duplicate, non-finite or unselected dimension');
      seen.add(change.constraintId);
      return {constraintId:change.constraintId,value:change.valueMm};
    });
    result=s.profileDimensions.editSelectedProfileDimensions(
      s.current,request.selection,{kind:'edit-selected-dimensions',version:1,
        sourceSignature:s.signature,changes});
  }else{
    id(request.handleId,'semantic dimension handle');
    exact(request.target,['x','y'],'pointer target');
    if(!Number.isFinite(request.target.x)||!Number.isFinite(request.target.y))
      fail('finite local_xy pointer target required');
    result=s.profileDimensions.dragSelectedProfileDimension(
      s.current,request.selection,{version:1,sourceSignature:s.signature,
        handleId:request.handleId,target:request.target});
  }
  if(result?.kind!=='accepted')
    fail('SKETCH refused '+(result?.reason??'unsupported dimension edit')+
      (result?.detail?' ('+result.detail+')':''));
  if(result.sourceSignature!==s.signature||result.previewOnly!==true||
     result.nativeExact!==false||result.exactBrepAvailable!==false||
     result.independentStepQualified!==false||
     result.solverStatus!=='solved'||result.degreesOfFreedom!==0)
    fail('SKETCH returned unsupported source/authority/solver evidence');
  const nextSketch=s.sketch.validateSketch(result.sketch);
  const nextStamp=s.sketch.serializeSketch(nextSketch);
  if(nextStamp!==result.nextSourceSignature||
     result.selection?.sourceSignature!==nextStamp||
     result.selection?.candidateId!==result.nextCandidateId)
    fail('SKETCH successor selection/signature mismatch');
  const successorDiscovery=s.discovery.discoverPlateProfiles(nextSketch);
  if(successorDiscovery.status!=='ready'||successorDiscovery.candidates?.length!==1||
     successorDiscovery.candidates[0].id!==result.nextCandidateId)
    fail('successor profile not uniquely admitted');
  const admitted=s.discovery.admitDiscoveredPlateProfile(
    nextSketch,successorDiscovery,result.nextCandidateId);
  const next=s.runtime.commit(history,[{
    eventId:request.eventId,type:'feature.edit',featureId:s.sourceSketchId,
    patch:{payload:{...s.source.payload,sketch:nextSketch,
      selectedProfileSelection:result.selection}}
  }],request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+1||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops body profile dimensions: not one undo frame');
  const report=s.runtime.inspect(next);
  const stored=s.model.featuresOf(next.document).find(f=>f.id===s.sourceSketchId);
  if(s.sketch.serializeSketch(stored?.payload?.sketch)!==nextStamp||
     !same(stored.payload.selectedProfileSelection,result.selection)||
     row(report,s.sourceSketchId)?.status!=='analytic_profile_only'||
     !same(row(report,s.sourceSketchId).profile,admitted)||
     row(report,s.extrudeFeatureId)?.status!=='preview_only')
    throw new Error('feature-ops body profile dimensions: commit not admitted by RUNTIME');
  const invalidation=s.runtime.diff(history,next);
  if(!s.affectedFeatureIds.every(fid=>
    invalidation?.invalidatedFeatureIds?.includes(fid)))
    throw new Error('feature-ops body profile dimensions: dependent rebuild incomplete');
  return {kind:'committed',format:BODY_PROFILE_DIMENSIONS_FORMAT,version:1,
    history:next,report,invalidation,
    semanticIds:{sourceSketchId:s.sourceSketchId,
      extrudeFeatureId:s.extrudeFeatureId,targetBodyId:s.targetBodyId},
    affectedFeatureIds:s.affectedFeatureIds,selectedProfile:result.selection,
    changedConstraintIds:result.changedConstraintIds,
    changedPointIds:result.changedPointIds,
    changedRadiusIds:result.changedRadiusIds,gesture:result.gesture??null,
    status:'analytic_profile_only',
    nativeHandoff:{kind:'rebuild_selected_profile_body',
      bodyId:s.targetBodyId,extrusionId:s.extrudeFeatureId,
      sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
/** One undoable batch of 1–16 actual solver-bound profile dimensions. */
export function editSelectedBodyProfileDimensions(history,request,services){
  return apply(history,request,services,'edit');
}
/** One semantic constrained handle drag, not an unverified viewport mutation. */
export function dragSelectedBodyProfileDimension(history,request,services){
  return apply(history,request,services,'drag');
}
