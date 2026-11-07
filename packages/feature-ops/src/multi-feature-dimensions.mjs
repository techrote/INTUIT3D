/**
 * FEATUREOPS multi-feature-dimensions/v1.
 *
 * One revision-fenced, undoable authoring transaction edits extrusion depths
 * and/or ordered blind/through-all cuts across explicitly named bodies.
 * INTENT owns journal/previews/dependencies; SKETCH owns profile admission;
 * RUNTIME owns evaluation. This module never computes or claims a B-rep.
 */
export const MULTI_FEATURE_DIMENSIONS_FORMAT='intuit3d.feature-ops.multi-feature-dimensions';
export const MULTI_FEATURE_DIMENSIONS_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function fail(message){throw new TypeError('feature-ops multi-dimensions: '+message);}
function exact(x,names,label){
  if(!plain(x)||Object.keys(x).length!==names.length||
     names.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!names.includes(k)))
    fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!ID.test(x))fail('invalid '+label);return x;}
function positive(x,label){
  if(typeof x!=='number'||!Number.isFinite(x)||x<=0)fail('positive finite '+label+' in mm required');
  return x;
}
function extent(x,label){
  exact(x,x?.kind==='blind'?['kind','depthMm']:['kind'],label);
  if(x.kind==='through_all')return;
  if(x.kind!=='blind')fail('invalid '+label+' kind');
  positive(x.depthMm,label+'.depthMm');
}
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
  a.every((x,i)=>x===b[i]);
const row=(report,featureId)=>report.features?.find(f=>f.featureId===featureId);

/** Validate an actual current SKETCH selection and its RUNTIME evaluation. */
function admittedSketch(sketchId,candidateId,features,report,services,cache){
  if(typeof candidateId!=='string'||!candidateId.startsWith('cycle:')||
     candidateId.length>8192)fail('explicit canonical SKETCH profile required');
  const key=JSON.stringify([sketchId,candidateId]);
  if(cache.has(key))return;
  const feature=features.get(sketchId);
  if(feature?.kind!=='sketch'||!feature.payload?.sketch||
     !same(feature.writeTargets,[]))fail('selected authored SKETCH missing');
  const authored=services.sketch.validateSketch(feature.payload.sketch);
  const discovered=services.discovery.discoverPlateProfiles(authored);
  if(discovered?.status!=='ready'||discovered.candidates?.length!==1||
     discovered.candidates[0].id!==candidateId)
    fail('selected SKETCH profile missing, stale or ambiguous');
  const selected=services.discovery.admitDiscoveredPlateProfile(
    authored,discovered,candidateId);
  const actual=row(report,sketchId);
  if(actual?.status!=='analytic_profile_only'||
     actual.profile?.status!=='analytic_profile_only'||
     JSON.stringify(actual.profile)!==JSON.stringify(selected))
    fail('RUNTIME has not admitted selected SKETCH profile');
  cache.add(key);
}

/**
 * Commit 2–16 dimension changes in a single undo frame. Each edit has an
 * independent explicit expected-value selection, target body and event ID.
 * INTENT previews each cut extent against the SAME original revision;
 * no intermediate state is exposed as a successful user operation.
 *
 * Edit shape 'extrusion_depth':
 * {kind,eventId,extrudeFeatureId,targetBodyId,sourceSketchId,
 *  profileCandidateId,fromDepthMm,toDepthMm}
 *
 * Edit shape 'cut_extent':
 * {kind,eventId,cutFeatureId,targetBodyId,afterBodyWriterId,
 *  sourceSketchId,profileCandidateId,fromExtent,toExtent}
 */
export function editMultipleBodyDimensions(history,request,services){
  exact(request,['format','version','expectedProjectId','expectedRevision',
    'units','frame','edits'],'request');
  if(request.format!==MULTI_FEATURE_DIMENSIONS_FORMAT||
     request.version!==MULTI_FEATURE_DIMENSIONS_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported protocol or millimetre local_xy frame');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     history.document.projectId!==request.expectedProjectId||
     history.document.revision!==request.expectedRevision)
    throw new Error('feature-ops multi-dimensions: stale project/revision');
  if(!Array.isArray(request.edits)||request.edits.length<2||
     request.edits.length>16)fail('2–16 edits required');
  // Reject malformed entries before consulting the model or RUNTIME services.
  for(const edit of request.edits)
    if(!plain(edit)||!['extrusion_depth','cut_extent'].includes(edit.kind))
      fail('invalid dimension edit entry');
  const {runtime,model,sketch,discovery,cutChain}=services??{};
  if(typeof runtime?.commit!=='function'||typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof cutChain?.inspectBodyCutChain!=='function'||
     typeof cutChain?.inspectBodyCutExtent!=='function'||
     typeof cutChain?.previewBodyCutExtentEdit!=='function')
    fail('accepted INTENT/SKETCH/RUNTIME services required');
  const originals=model.featuresOf(history.document);
  const byId=new Map(originals.map(feature=>[feature.id,feature]));
  const before=runtime.inspect(history);
  const sketchCache=new Set(),bodyChainCache=new Map(),editIds=new Set(),eventIds=new Set();
  const events=[],expected=[];
  function chain(bodyId,selectedFeatureId){
    if(!bodyChainCache.has(bodyId))
      bodyChainCache.set(bodyId,cutChain.inspectBodyCutChain(history.document,bodyId));
    const found=bodyChainCache.get(bodyId);
    if(found?.status!=='ready'||found.projectId!==request.expectedProjectId||
       found.revision!==request.expectedRevision||
       !found.bodyWriterIds?.includes(selectedFeatureId))
      fail('body has stale, ambiguous or missing ordered writer chain');
    return found;
  }
  for(const raw of request.edits){
    if(raw?.kind==='extrusion_depth'){
      exact(raw,['kind','eventId','extrudeFeatureId','targetBodyId',
        'sourceSketchId','profileCandidateId','fromDepthMm','toDepthMm'],
        'extrusion selection');
      const eventId=id(raw.eventId,'eventId');
      const featureId=id(raw.extrudeFeatureId,'extrudeFeatureId');
      const bodyId=id(raw.targetBodyId,'targetBodyId');
      const sketchId=id(raw.sourceSketchId,'sourceSketchId');
      if(new Set([featureId,bodyId,sketchId]).size!==3)fail('aliased extrude/body/sketch');
      positive(raw.fromDepthMm,'fromDepthMm');
      positive(raw.toDepthMm,'toDepthMm');
      if(raw.fromDepthMm===raw.toDepthMm)fail('no-op extrusion depth');
      if(editIds.has(featureId)||eventIds.has(eventId))fail('duplicate feature/event ID');
      editIds.add(featureId);eventIds.add(eventId);
      const feature=byId.get(featureId);
      if(feature?.kind!=='extrude'||!same(feature.writeTargets,[bodyId])||
         !same(feature.dependsOn,[sketchId])||
         feature.payload?.sourceSketchId!==sketchId||
         feature.payload?.thicknessMm!==raw.fromDepthMm||
         feature.payload?.units!=='mm'||feature.payload?.frame!=='local_xy'||
         row(before,featureId)?.status!=='preview_only')
        fail('selected extrusion source/body/depth changed');
      chain(bodyId,featureId);
      admittedSketch(sketchId,raw.profileCandidateId,byId,before,services,sketchCache);
      events.push({eventId,type:'feature.edit',featureId,
        patch:{payload:{...feature.payload,thicknessMm:raw.toDepthMm}}});
      expected.push({kind:raw.kind,featureId,bodyId,
        original:feature,to:raw.toDepthMm});
    }else if(raw?.kind==='cut_extent'){
      exact(raw,['kind','eventId','cutFeatureId','targetBodyId',
        'afterBodyWriterId','sourceSketchId','profileCandidateId',
        'fromExtent','toExtent'],'cut selection');
      const eventId=id(raw.eventId,'eventId');
      const featureId=id(raw.cutFeatureId,'cutFeatureId');
      const bodyId=id(raw.targetBodyId,'targetBodyId');
      const sketchId=id(raw.sourceSketchId,'sourceSketchId');
      const afterId=id(raw.afterBodyWriterId,'afterBodyWriterId');
      if(new Set([featureId,bodyId,sketchId,afterId]).size!==4)
        fail('aliased cut/body/sketch/predecessor');
      extent(raw.fromExtent,'fromExtent');extent(raw.toExtent,'toExtent');
      if(JSON.stringify(raw.fromExtent)===JSON.stringify(raw.toExtent))
        fail('no-op cut extent');
      if(editIds.has(featureId)||eventIds.has(eventId))fail('duplicate feature/event ID');
      editIds.add(featureId);eventIds.add(eventId);
      const feature=byId.get(featureId);
      if(feature?.kind!=='cut'||!same(feature.writeTargets,[bodyId])||
         !same(feature.dependsOn,[afterId,sketchId])||
         feature.payload?.targetBodyId!==bodyId||
         feature.payload?.sourceSketchId!==sketchId||
         feature.payload?.profileCandidateId!==raw.profileCandidateId||
         feature.payload?.units!=='mm'||feature.payload?.frame!=='local_xy'||
         feature.payload?.throughAll!==(raw.fromExtent.kind==='through_all')||
         (raw.fromExtent.kind==='blind' ?
           feature.payload?.depthMm!==raw.fromExtent.depthMm :
           Object.hasOwn(feature.payload,'depthMm')))
        fail('selected cut body/source/predecessor/extent changed');
      const predecessor=byId.get(afterId);
      if(!predecessor||!['cut','extrude'].includes(predecessor.kind)||
         !same(predecessor.writeTargets,[bodyId])||
         (predecessor.kind==='cut'&&predecessor.payload?.targetBodyId!==bodyId))
        fail('selected predecessor is not a writer of target body');
      const writerChain=chain(bodyId,featureId);
      if(!writerChain.bodyWriterIds.includes(afterId))fail('predecessor not in body chain');
      const inspected=cutChain.inspectBodyCutExtent(history.document,featureId,bodyId);
      if(inspected?.projectId!==request.expectedProjectId||
         inspected.revision!==request.expectedRevision||
         inspected.semanticStatus!=='ready'||
         JSON.stringify(inspected.extent)!==JSON.stringify(raw.fromExtent))
        fail('INTENT cut extent inspection mismatches selection');
      admittedSketch(sketchId,raw.profileCandidateId,byId,before,services,sketchCache);
      if(!['pending_exact_provider','blocked_dependency'].includes(row(before,featureId)?.status))
        fail('cut is not preserved pending native intent');
      const preview=cutChain.previewBodyCutExtentEdit(history.document,{
        format:'intuit3d.body-cut-extent-edit',version:1,
        expectedProjectId:request.expectedProjectId,
        expectedRevision:request.expectedRevision,
        eventId,cutFeatureId:featureId,targetBodyId:bodyId,
        fromExtent:raw.fromExtent,toExtent:raw.toExtent,admission:'require_ready'
      });
      const event=preview?.event;
      if(preview.semanticStatus!=='ready'||event?.type!=='feature.edit'||
         event.eventId!==eventId||event.featureId!==featureId||
         event.patch?.payload?.sourceSketchId!==sketchId||
         event.patch?.payload?.targetBodyId!==bodyId||
         event.patch?.payload?.profileCandidateId!==raw.profileCandidateId||
         event.patch?.payload?.throughAll!==(raw.toExtent.kind==='through_all')||
         (raw.toExtent.kind==='blind'?
           event.patch.payload.depthMm!==raw.toExtent.depthMm:
           Object.hasOwn(event.patch.payload,'depthMm')))
        fail('INTENT returned mismatched or inadmissible cut extent preview');
      events.push(event);
      expected.push({kind:raw.kind,featureId,bodyId,original:feature,to:raw.toExtent});
    }else fail('unsupported dimension edit kind');
  }
  const next=runtime.commit(history,events,request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+events.length)
    throw new Error('feature-ops multi-dimensions: unexpected committed revision');
  const updated=new Map(model.featuresOf(next.document).map(f=>[f.id,f]));
  const after=runtime.inspect(next);
  const statuses=[];
  for(const item of expected){
    const actual=updated.get(item.featureId);
    const prior=item.original;
    if(!actual||actual.kind!==prior.kind||
       !same(actual.dependsOn,prior.dependsOn)||
       !same(actual.writeTargets,prior.writeTargets)||
       actual.payload?.sourceSketchId!==prior.payload.sourceSketchId)
      throw new Error('feature-ops multi-dimensions: feature identity or dependency changed');
    const status=row(after,item.featureId)?.status;
    if(item.kind==='extrusion_depth'){
      if(actual.payload.thicknessMm!==item.to||
         actual.payload.units!=='mm'||actual.payload.frame!=='local_xy'||
         status!=='preview_only')
        throw new Error('feature-ops multi-dimensions: committed extrusion differs');
    }else{
      if(actual.payload.targetBodyId!==item.bodyId||
         actual.payload.profileCandidateId!==prior.payload.profileCandidateId||
         actual.payload.throughAll!==(item.to.kind==='through_all')||
         (item.to.kind==='blind'?
           actual.payload.depthMm!==item.to.depthMm:
           Object.hasOwn(actual.payload,'depthMm'))||
         !['pending_exact_provider','blocked_dependency'].includes(status))
        throw new Error('feature-ops multi-dimensions: committed cut differs');
    }
    statuses.push({featureId:item.featureId,bodyId:item.bodyId,status});
  }
  const invalidation=runtime.diff(history,next);
  if(!expected.every(item=>invalidation?.invalidatedFeatureIds?.includes(item.featureId)))
    throw new Error('feature-ops multi-dimensions: missing dependent rebuild invalidation');
  return {
    kind:'committed',history:next,report:after,invalidation,statuses,
    editedFeatureIds:expected.map(e=>e.featureId),
    undoFramesAdded:1,
    nativeHandoffs:expected.filter(e=>e.kind==='cut_extent').map(e=>({
      kind:'runtime_evaluation_required',cutFeatureId:e.featureId,
      bodyId:e.bodyId,sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false
    })),
    exactAuthority:false,independentInteroperability:false
  };
}

// Read-only, revision-fenced multi-select inspection and WORKBENCH Apply adapter.
export {inspectSelectedFeatureDimensions,prepareSelectedFeatureDimensionEdits}
  from './multi-feature-dimension-inspector.mjs';
