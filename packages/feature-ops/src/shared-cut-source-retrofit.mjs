/**
 * FEATUREOPS shared-cut-source-retrofit/v1.
 *
 * Replace the selected SKETCH source of several already authored body cuts
 * in a single gesture. INTENT owns the journal preview and structural repair;
 * SKETCH owns admitted profiles; RUNTIME owns commit, evaluation and replay.
 * No claim is made about executed Booleans, B-rep validity or STEP export.
 */
export const SHARED_CUT_SOURCE_FORMAT =
  'intuit3d.feature-ops.shared-cut-source-retrofit';
export const SHARED_CUT_SOURCE_VERSION = 1;

const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const fail=m=>{throw new TypeError('feature-ops shared cut source: '+m);};
function exact(value,fields,label){
  if(!plain(value)||Object.keys(value).length!==fields.length||
     fields.some(k=>!Object.hasOwn(value,k))||
     Object.keys(value).some(k=>!fields.includes(k)))fail('invalid '+label);
}
function id(value,label){
  if(typeof value!=='string'||!ID.test(value))fail('invalid '+label);
  return value;
}
function candidate(value){
  if(typeof value!=='string'||!value.startsWith('cycle:')||
     value.length<=6||value.length>8192)
    fail('explicit canonical SKETCH profile required');
  return value;
}
const row=(report,featureId)=>report.features?.find(x=>x.featureId===featureId);
const same=(a,b)=>Array.isArray(a)&&a.length===1&&a[0]===b;

/**
 * Consumer command: Replace the source profile of 2–16 named cuts, optionally
 * retire a fully displaced source sketch, and return one undoable edit.
 *
 * Every replacement source must ALREADY be an authored, uniquely admitted
 * SKETCH feature in the same document. It is never synthesized from a mesh.
 * The chosen original target, source and cycle are optimistic edit fences.
 */
export function replaceSharedCutProfiles(history,request,services){
  exact(request,Object.hasOwn(request??{},'retireSketch')?
    ['format','version','expectedProjectId','expectedRevision','units','frame',
     'edits','retireSketch']:
    ['format','version','expectedProjectId','expectedRevision','units','frame',
     'edits'],'request');
  if(request.format!==SHARED_CUT_SOURCE_FORMAT||
     request.version!==SHARED_CUT_SOURCE_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported format, units or frame');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     history.document.revision!==request.expectedRevision||
     history.document.projectId!==request.expectedProjectId)
    throw new Error('feature-ops shared cut source: stale project/revision');
  if(!Array.isArray(request.edits)||request.edits.length<2||
     request.edits.length>16)fail('2–16 explicitly selected cuts required');
  const {runtime,model,sketch,discovery,cutSource}=services??{};
  if(typeof runtime?.commit!=='function'||typeof runtime.inspect!=='function'||
     typeof runtime.diff!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof cutSource?.previewCutProfileSourceBatch!=='function')
    fail('accepted INTENT cut-profile-source, SKETCH and RUNTIME services required');
  const features=model.featuresOf(history.document);
  const byId=new Map(features.map(f=>[f.id,f]));
  const before=runtime.inspect(history);
  const seenCuts=new Set(),seenEvents=new Set();
  const admitted=new Map();
  const edits=request.edits.map(raw=>{
    exact(raw,['eventId','cutFeatureId','targetBodyId','expectedSourceSketchId',
      'expectedProfileCandidateId','sourceSketchId','profileCandidateId',
      'releasePreviousSketchDependency'],'cut selection');
    const eventId=id(raw.eventId,'eventId');
    const cutFeatureId=id(raw.cutFeatureId,'cutFeatureId');
    const targetBodyId=id(raw.targetBodyId,'targetBodyId');
    const oldSketchId=id(raw.expectedSourceSketchId,'expectedSourceSketchId');
    const newSketchId=id(raw.sourceSketchId,'sourceSketchId');
    const oldProfileId=candidate(raw.expectedProfileCandidateId);
    const newProfileId=candidate(raw.profileCandidateId);
    if(typeof raw.releasePreviousSketchDependency!=='boolean')
      fail('explicit old dependency release choice required');
    if(seenCuts.has(cutFeatureId)||seenEvents.has(eventId))
      fail('duplicate cut or journal event selection');
    seenCuts.add(cutFeatureId);seenEvents.add(eventId);
    if([cutFeatureId,targetBodyId,oldSketchId,newSketchId].some(x=>x===eventId)||
       cutFeatureId===targetBodyId||cutFeatureId===newSketchId||
       targetBodyId===newSketchId||
       (oldSketchId===newSketchId&&oldProfileId===newProfileId))
      fail('aliased or unchanged cut source selection');
    const cut=byId.get(cutFeatureId);
    if(cut?.kind!=='cut'||!same(cut.writeTargets,targetBodyId)||
       cut.payload?.targetBodyId!==targetBodyId||
       cut.payload?.sourceSketchId!==oldSketchId||
       cut.payload?.profileCandidateId!==oldProfileId||
       cut.payload?.units!=='mm'||cut.payload?.frame!=='local_xy'||
       !cut.dependsOn?.includes(oldSketchId))
      fail('selected cut source, frame or explicit target has changed');
    const nextSource=byId.get(newSketchId);
    if(nextSource?.kind!=='sketch'||!nextSource.payload?.sketch||
       !Array.isArray(nextSource.writeTargets)||
       nextSource.writeTargets.length!==0)
      fail('replacement must be an existing authored SKETCH');
    const cacheKey=newSketchId+'\u0000'+newProfileId;
    if(!admitted.has(cacheKey)){
      const authored=sketch.validateSketch(nextSource.payload.sketch);
      const proposed=discovery.discoverPlateProfiles(authored);
      if(proposed?.status!=='ready'||proposed.candidates?.length!==1||
         proposed.candidates[0].id!==newProfileId)
        fail('replacement SKETCH profile stale, unsolved or ambiguous');
      const proof=discovery.admitDiscoveredPlateProfile(authored,proposed,newProfileId);
      const runtimeSource=row(before,newSketchId);
      if(runtimeSource?.status!=='analytic_profile_only'||
         runtimeSource.profile?.status!=='analytic_profile_only'||
         JSON.stringify(runtimeSource.profile)!==JSON.stringify(proof))
        fail('RUNTIME has not admitted the chosen SKETCH revision');
      admitted.set(cacheKey,proof);
    }
    return {eventId,cutFeatureId,targetBodyId,
      expectedSourceSketchId:oldSketchId,expectedProfileCandidateId:oldProfileId,
      sourceSketchId:newSketchId,profileCandidateId:newProfileId,
      releasePreviousSketchDependency:raw.releasePreviousSketchDependency};
  });
  let retireSketch;
  if(Object.hasOwn(request,'retireSketch')){
    exact(request.retireSketch,['eventId','featureId'],'retired sketch');
    retireSketch={eventId:id(request.retireSketch.eventId,'retire eventId'),
      featureId:id(request.retireSketch.featureId,'retire featureId')};
    if(seenEvents.has(retireSketch.eventId)||
       !edits.some(e=>e.expectedSourceSketchId===retireSketch.featureId))
      fail('retirement must name a displaced sketch and distinct event');
  }
  const preview=cutSource.previewCutProfileSourceBatch(history.document,{
    format:'intuit3d.cut-profile-source-batch',version:1,
    expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,admission:'require_ready',
    edits,...(retireSketch?{retireSketch}:{})
  });
  if(preview.exactGeometryAuthority!==false||
     preview.requiresSketchAdmission!==true||
     preview.requiresNativeRebuild!==true||
     preview.newlyAuthoredSketchId!==null||
     preview.events?.length!==edits.length+(retireSketch?1:0)||
     JSON.stringify(preview.editedCutIds)!==JSON.stringify(edits.map(e=>e.cutFeatureId))||
     !preview.cutStatuses?.every(x=>x.status==='ready'))
    fail('INTENT did not accept the complete source replacement');
  const next=runtime.commit(history,preview.events,request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+preview.events.length||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops shared cut source: non-atomic journal commit');
  const saved=new Map(model.featuresOf(next.document).map(f=>[f.id,f]));
  const report=runtime.inspect(next);
  const results=edits.map(e=>{
    const cut=saved.get(e.cutFeatureId);
    if(cut?.kind!=='cut'||!same(cut.writeTargets,e.targetBodyId)||
       cut.payload?.targetBodyId!==e.targetBodyId||
       cut.payload?.sourceSketchId!==e.sourceSketchId||
       cut.payload?.profileCandidateId!==e.profileCandidateId||
       !cut.dependsOn?.includes(e.sourceSketchId)||
       (e.releasePreviousSketchDependency&&e.expectedSourceSketchId!==e.sourceSketchId&&
        cut.dependsOn.includes(e.expectedSourceSketchId)))
      throw new Error('feature-ops shared cut source: committed lineage mismatch');
    const status=row(report,e.cutFeatureId)?.status;
    if(!['pending_exact_provider','blocked_dependency'].includes(status))
      throw new Error('feature-ops shared cut source: native state falsely admitted');
    return {cutFeatureId:e.cutFeatureId,targetBodyId:e.targetBodyId,
      sourceSketchId:e.sourceSketchId,profileCandidateId:e.profileCandidateId,
      status,nativeHandoff:{kind:'runtime_evaluation_required',
        cutFeatureId:e.cutFeatureId,bodyId:e.targetBodyId,
        sourceRevision:next.document.revision,
        compatibility:'not_claimed_ask_RUNTIME_provider',
        exactAuthority:false,independentInteroperability:false}};
  });
  if(retireSketch&&saved.has(retireSketch.featureId))
    throw new Error('feature-ops shared cut source: displaced sketch not retired');
  const invalidation=runtime.diff(history,next);
  if(!results.every(x=>invalidation?.invalidatedFeatureIds?.includes(x.cutFeatureId)))
    throw new Error('feature-ops shared cut source: dependent rebuild not invalidated');
  return {kind:'committed',history:next,report,invalidation,
    editedCutIds:preview.editedCutIds,retiredSketchId:retireSketch?.featureId??null,
    cuts:results,semanticStatus:'ready',exactAuthority:false,
    independentInteroperability:false};
}
