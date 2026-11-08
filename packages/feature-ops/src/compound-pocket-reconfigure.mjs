/**
 * FEATUREOPS compound-pocket-reconfigure/v1.
 *
 * Re-source and change the blind/through extent of 2-8 existing selected cuts
 * in ONE undo frame, even when they belong to different bodies. Both halves
 * are staged by accepted INTENT previews before RUNTIME sees a transaction.
 * SKETCH admission and runtime evaluation remain authoritative; this never
 * executes a Boolean or grants STEP/physical geometry authority.
 */
export const COMPOUND_POCKET_FORMAT='intuit3d.feature-ops.compound-pocket-reconfigure';
export const COMPOUND_POCKET_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const own=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const fail=x=>{throw new TypeError('feature-ops compound pocket: '+x);};
function exact(x,fields,label){
  if(!own(x)||Object.keys(x).length!==fields.length||
     fields.some(k=>!Object.hasOwn(x,k))||
     Object.keys(x).some(k=>!fields.includes(k)))
    fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!ID.test(x))fail('invalid '+label);return x;}
function candidate(x){
  if(typeof x!=='string'||!x.startsWith('cycle:')||
     x.length<=6||x.length>8192)fail('explicit canonical SKETCH cycle required');
  return x;
}
function extent(x,label){
  exact(x,x?.kind==='blind'?['kind','depthMm']:['kind'],label);
  if(x.kind==='through_all')return;
  if(x.kind!=='blind'||typeof x.depthMm!=='number'||
     !Number.isFinite(x.depthMm)||x.depthMm<=0)
    fail('positive finite blind depth required for '+label);
}
const same=(a,b)=>Array.isArray(a)&&a.length===1&&a[0]===b;
const row=(report,featureId)=>report.features?.find(f=>f.featureId===featureId);
function getServices(services){
  const {runtime,model,sketch,discovery,cutSource,cutChain,transactions}=services??{};
  if(typeof runtime?.commit!=='function'||typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof cutSource?.previewCutProfileSourceBatch!=='function'||
     typeof cutChain?.inspectBodyCutChain!=='function'||
     typeof cutChain?.inspectBodyCutExtent!=='function'||
     typeof cutChain?.previewBodyCutExtentEdit!=='function'||
     typeof transactions?.previewTransaction!=='function')
    fail('accepted INTENT, SKETCH, transaction and RUNTIME services required');
  return {runtime,model,sketch,discovery,cutSource,cutChain,transactions};
}

/**
 * One UI Apply: replace a selected SKETCH source AND change its pocket extent,
 * for 2-8 explicitly selected cuts. A displaced sketch can be retired only
 * when the accepted INTENT preview proves that every reference is gone.
 *
 * The two accepted previews per selected cut are replayed in order, not
 * combined into a home-grown model patch. Nothing is committed until every
 * preview, all source admissions and the complete final transaction validate.
 */
export function reconfigureCompoundPockets(history,request,services){
  exact(request,Object.hasOwn(request??{},'retireSketch')?
    ['format','version','expectedProjectId','expectedRevision','units','frame',
     'edits','retireSketch']:
    ['format','version','expectedProjectId','expectedRevision','units','frame',
     'edits'],'request');
  if(request.format!==COMPOUND_POCKET_FORMAT||
     request.version!==COMPOUND_POCKET_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported format, units or frame');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     history.document.projectId!==request.expectedProjectId||
     history.document.revision!==request.expectedRevision)
    throw new Error('feature-ops compound pocket: stale project/revision');
  if(!Array.isArray(request.edits)||request.edits.length<2||
     request.edits.length>8)fail('2-8 selected pocket changes required');
  // Malformed requests must not reach the model or runtime even for inspection.
  const selectedCuts=new Set(),eventIds=new Set();
  for(const e of request.edits){
    exact(e,['sourceEventId','extentEventId','cutFeatureId','targetBodyId',
      'afterBodyWriterId','expectedSourceSketchId','expectedProfileCandidateId',
      'sourceSketchId','profileCandidateId','releasePreviousSketchDependency',
      'fromExtent','toExtent'],'selected pocket');
    for(const field of ['sourceEventId','extentEventId','cutFeatureId',
      'targetBodyId','afterBodyWriterId','expectedSourceSketchId','sourceSketchId'])
      id(e[field],field);
    candidate(e.expectedProfileCandidateId);candidate(e.profileCandidateId);
    extent(e.fromExtent,'fromExtent');extent(e.toExtent,'toExtent');
    if(JSON.stringify(e.fromExtent)===JSON.stringify(e.toExtent)||
       (e.expectedSourceSketchId===e.sourceSketchId&&
        e.expectedProfileCandidateId===e.profileCandidateId))
      fail('both profile source and extent must change');
    if(typeof e.releasePreviousSketchDependency!=='boolean')
      fail('explicit dependency release choice required');
    if(selectedCuts.has(e.cutFeatureId)||
       eventIds.has(e.sourceEventId)||eventIds.has(e.extentEventId)||
       e.sourceEventId===e.extentEventId||
       new Set([e.cutFeatureId,e.targetBodyId,e.afterBodyWriterId,
         e.expectedSourceSketchId]).size!==4)
      fail('duplicate cut/event or aliased body lineage');
    selectedCuts.add(e.cutFeatureId);
    eventIds.add(e.sourceEventId);eventIds.add(e.extentEventId);
  }
  if(Object.hasOwn(request,'retireSketch')){
    exact(request.retireSketch,['eventId','featureId'],'retired sketch');
    id(request.retireSketch.eventId,'retirement eventId');
    id(request.retireSketch.featureId,'retired sketch ID');
    if(eventIds.has(request.retireSketch.eventId)||
       !request.edits.some(e=>e.expectedSourceSketchId===request.retireSketch.featureId))
      fail('retirement must select a displaced sketch and a fresh event');
  }

  const s=getServices(services);
  const features=s.model.featuresOf(history.document);
  const byId=new Map(features.map(f=>[f.id,f]));
  const before=s.runtime.inspect(history);
  const admitted=new Set();
  for(const e of request.edits){
    const cut=byId.get(e.cutFeatureId);
    if(cut?.kind!=='cut'||!same(cut.writeTargets,e.targetBodyId)||
       cut.payload?.targetBodyId!==e.targetBodyId||
       cut.payload?.sourceSketchId!==e.expectedSourceSketchId||
       cut.payload?.profileCandidateId!==e.expectedProfileCandidateId||
       cut.payload?.units!=='mm'||cut.payload?.frame!=='local_xy'||
       !cut.dependsOn?.includes(e.expectedSourceSketchId)||
       !cut.dependsOn?.includes(e.afterBodyWriterId))
      fail('selected cut source/target/order has changed');
    const predecessor=byId.get(e.afterBodyWriterId);
    if(!predecessor||!['cut','extrude'].includes(predecessor.kind)||
       !same(predecessor.writeTargets,e.targetBodyId)||
       (predecessor.kind==='cut'&&
        predecessor.payload?.targetBodyId!==e.targetBodyId))
      fail('predecessor is not an authored writer of selected body');
    const chain=s.cutChain.inspectBodyCutChain(history.document,e.targetBodyId);
    if(chain?.status!=='ready'||chain.projectId!==request.expectedProjectId||
       chain.revision!==request.expectedRevision||
       !chain.bodyWriterIds?.includes(e.cutFeatureId)||
       !chain.bodyWriterIds?.includes(e.afterBodyWriterId))
      fail('ambiguous or stale selected body writer chain');
    const inspected=s.cutChain.inspectBodyCutExtent(
      history.document,e.cutFeatureId,e.targetBodyId);
    if(inspected?.projectId!==request.expectedProjectId||
       inspected.revision!==request.expectedRevision||
       inspected.semanticStatus!=='ready'||
       JSON.stringify(inspected.extent)!==JSON.stringify(e.fromExtent))
      fail('selected original pocket extent changed');
    if(!['pending_exact_provider','blocked_dependency'].includes(
       row(before,e.cutFeatureId)?.status))
      fail('selected cut has no recoverable semantic intent');
    const sketchFeature=byId.get(e.sourceSketchId);
    if(sketchFeature?.kind!=='sketch'||!sketchFeature.payload?.sketch||
       !Array.isArray(sketchFeature.writeTargets)||
       sketchFeature.writeTargets.length!==0)
      fail('replacement source must be an authored SKETCH');
    const key=JSON.stringify([e.sourceSketchId,e.profileCandidateId]);
    if(!admitted.has(key)){
      const source=s.sketch.validateSketch(sketchFeature.payload.sketch);
      const found=s.discovery.discoverPlateProfiles(source);
      if(found?.status!=='ready'||found.candidates?.length!==1||
         found.candidates[0].id!==e.profileCandidateId)
        fail('replacement profile stale or ambiguous');
      const proof=s.discovery.admitDiscoveredPlateProfile(
        source,found,e.profileCandidateId);
      const current=row(before,e.sourceSketchId);
      if(current?.status!=='analytic_profile_only'||
         current.profile?.status!=='analytic_profile_only'||
         JSON.stringify(current.profile)!==JSON.stringify(proof))
        fail('RUNTIME has not admitted replacement SKETCH');
      admitted.add(key);
    }
  }
  const sourcePreview=s.cutSource.previewCutProfileSourceBatch(history.document,{
    format:'intuit3d.cut-profile-source-batch',version:1,
    expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,admission:'require_ready',
    edits:request.edits.map(e=>({
      eventId:e.sourceEventId,cutFeatureId:e.cutFeatureId,
      targetBodyId:e.targetBodyId,
      expectedSourceSketchId:e.expectedSourceSketchId,
      expectedProfileCandidateId:e.expectedProfileCandidateId,
      sourceSketchId:e.sourceSketchId,profileCandidateId:e.profileCandidateId,
      releasePreviousSketchDependency:e.releasePreviousSketchDependency
    })),
    ...(Object.hasOwn(request,'retireSketch')?{retireSketch:request.retireSketch}:{})
  });
  const expectedSourceEvents=request.edits.length+
    (Object.hasOwn(request,'retireSketch')?1:0);
  if(sourcePreview?.exactGeometryAuthority!==false||
     sourcePreview.requiresSketchAdmission!==true||
     sourcePreview.requiresNativeRebuild!==true||
     sourcePreview.events?.length!==expectedSourceEvents||
     JSON.stringify(sourcePreview.editedCutIds)!==
       JSON.stringify(request.edits.map(e=>e.cutFeatureId))||
     !sourcePreview.cutStatuses?.every(x=>x.status==='ready'))
    fail('INTENT refused complete source reattachment');
  const events=[...sourcePreview.events];
  let staged=sourcePreview.document;
  for(const e of request.edits){
    const extentPreview=s.cutChain.previewBodyCutExtentEdit(staged,{
      format:'intuit3d.body-cut-extent-edit',version:1,
      expectedProjectId:request.expectedProjectId,
      expectedRevision:staged.revision,
      eventId:e.extentEventId,cutFeatureId:e.cutFeatureId,
      targetBodyId:e.targetBodyId,
      fromExtent:e.fromExtent,toExtent:e.toExtent,
      admission:'require_ready'
    });
    if(extentPreview?.exactGeometryAuthority!==false||
       extentPreview?.requiresNativeRebuild!==true||
       extentPreview?.semanticStatus!=='ready'||
       extentPreview?.event?.type!=='feature.edit'||
       extentPreview.event.eventId!==e.extentEventId||
       extentPreview.event.featureId!==e.cutFeatureId||
       extentPreview.document?.revision!==staged.revision+1)
      fail('INTENT refused a changed cut extent');
    events.push(extentPreview.event);
    staged=extentPreview.document;
  }
  // The complete journal must validate from the original revision as a
  // single undoable transaction (including optional source retirement).
  const finalPreview=s.transactions.previewTransaction(
    history.document,events,request.expectedRevision);
  if(finalPreview.document.revision!==request.expectedRevision+events.length||
     JSON.stringify(finalPreview.document)!==JSON.stringify(staged))
    fail('combined INTENT staging does not reproduce one atomic history');
  const next=s.runtime.commit(history,events,request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+events.length||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops compound pocket: transaction was not atomic');
  const updated=new Map(s.model.featuresOf(next.document).map(f=>[f.id,f]));
  const report=s.runtime.inspect(next);
  const cuts=request.edits.map(e=>{
    const cut=updated.get(e.cutFeatureId);
    if(cut?.kind!=='cut'||!same(cut.writeTargets,e.targetBodyId)||
       cut.payload?.sourceSketchId!==e.sourceSketchId||
       cut.payload?.profileCandidateId!==e.profileCandidateId||
       cut.payload?.targetBodyId!==e.targetBodyId||
       !cut.dependsOn?.includes(e.sourceSketchId)||
       cut.payload?.throughAll!==(e.toExtent.kind==='through_all')||
       (e.toExtent.kind==='blind'?cut.payload?.depthMm!==e.toExtent.depthMm:
         Object.hasOwn(cut.payload,'depthMm'))||
       (e.releasePreviousSketchDependency&&
        e.expectedSourceSketchId!==e.sourceSketchId&&
        cut.dependsOn.includes(e.expectedSourceSketchId)))
      throw new Error('feature-ops compound pocket: committed target/source/extent mismatch');
    const status=row(report,e.cutFeatureId)?.status;
    if(!['pending_exact_provider','blocked_dependency'].includes(status))
      throw new Error('feature-ops compound pocket: unexpected geometry authority');
    return {cutFeatureId:e.cutFeatureId,targetBodyId:e.targetBodyId,
      sourceSketchId:e.sourceSketchId,profileCandidateId:e.profileCandidateId,
      extent:e.toExtent,status,
      nativeHandoff:{kind:'runtime_evaluation_required',
        cutFeatureId:e.cutFeatureId,bodyId:e.targetBodyId,
        sourceRevision:next.document.revision,
        compatibility:'not_claimed_ask_RUNTIME_provider',
        exactAuthority:false,independentInteroperability:false}};
  });
  if(Object.hasOwn(request,'retireSketch')&&updated.has(request.retireSketch.featureId))
    throw new Error('feature-ops compound pocket: displaced sketch still active');
  const invalidation=s.runtime.diff(history,next);
  if(!cuts.every(c=>invalidation?.invalidatedFeatureIds?.includes(c.cutFeatureId)))
    throw new Error('feature-ops compound pocket: dependency rebuild was not invalidated');
  return {kind:'committed',history:next,report,invalidation,
    editedCutIds:cuts.map(c=>c.cutFeatureId),cuts,
    retiredSketchId:request.retireSketch?.featureId??null,
    undoFramesAdded:1,semanticStatus:'ready',
    exactAuthority:false,independentInteroperability:false};
}
