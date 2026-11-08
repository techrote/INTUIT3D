/**
 * FEATUREOPS coordinated-body-cuts/v1.
 * One selected SKETCH profile, 2–8 explicitly named body terminals, and one
 * independently ordered pocket per body. This is a coordinated user action,
 * NOT a cross-body Boolean, inferred assembly registration, or native export.
 * Authoritative feature events come from INTENT's body-cut-chain previews.
 */
export const COORDINATED_CUT_FORMAT='intuit3d.feature-ops.coordinated-body-cuts';
export const COORDINATED_CUT_VERSION=1;
const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function fail(message){throw new TypeError('feature-ops coordinated cuts: '+message);}
function exact(x,fields,label){
  if(!plain(x)||Object.keys(x).length!==fields.length||
     fields.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!fields.includes(k)))
    fail('invalid '+label);
}
function id(x,name){if(typeof x!=='string'||!IDENT.test(x))fail('invalid '+name);return x;}
function candidate(x){
  if(typeof x!=='string'||!x.startsWith('cycle:')||x.length>8192)
    fail('explicit SKETCH cycle profile required');
  return x;
}
function extent(x){
  exact(x,x?.kind==='blind'?['kind','depthMm']:['kind'],'extent');
  if(x.kind==='through_all')return;
  if(x.kind!=='blind'||typeof x.depthMm!=='number'||!Number.isFinite(x.depthMm)||x.depthMm<=0)
    fail('positive blind depth or through_all required');
}
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
  a.length===b.length&&a.every((x,i)=>x===b[i]);
const row=(report,featureId)=>report.features?.find(x=>x.featureId===featureId);
function initial(history,request,services,fieldNames,mode){
  exact(request,fieldNames,'request');
  if(request.format!==COORDINATED_CUT_FORMAT||
     request.version!==COORDINATED_CUT_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported version, units or frame');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     request.expectedRevision!==history.document.revision||
     request.expectedProjectId!==history.document.projectId)
    throw new Error('feature-ops coordinated cuts: stale project/revision');
  const {runtime,model,sketch,discovery,cutChain}=services??{};
  if(typeof runtime?.commit!=='function'||typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof cutChain?.inspectBodyCutChain!=='function'||
     typeof cutChain?.previewBodyCutAppend!=='function'||
     (mode==='edit'&&(typeof cutChain?.inspectBodyCutExtent!=='function'||
       typeof cutChain?.previewBodyCutExtentEdit!=='function')))
    fail('accepted INTENT body-cut-chain, SKETCH and RUNTIME services required');
  const sourceSketchId=id(request.sourceSketchId,'sourceSketchId');
  const profileCandidateId=candidate(request.profileCandidateId);
  if(!Array.isArray(request.cuts)||request.cuts.length<2||request.cuts.length>8)
    fail('2–8 explicit cut/body selections required');
  const features=model.featuresOf(history.document);
  const byId=new Map(features.map(x=>[x.id,x]));
  const source=byId.get(sourceSketchId);
  if(source?.kind!=='sketch'||!source.payload?.sketch||!same(source.writeTargets,[]))
    fail('selected authored SKETCH source unavailable');
  const authored=sketch.validateSketch(source.payload.sketch);
  const proposed=discovery.discoverPlateProfiles(authored);
  if(proposed.status!=='ready'||proposed.candidates?.length!==1||
     proposed.candidates[0].id!==profileCandidateId)
    fail('selected SKETCH profile missing, stale or ambiguous');
  const admitted=discovery.admitDiscoveredPlateProfile(authored,proposed,profileCandidateId);
  const before=runtime.inspect(history);
  const proof=row(before,sourceSketchId);
  if(proof?.status!=='analytic_profile_only'||proof.profile?.status!=='analytic_profile_only'||
     JSON.stringify(proof.profile)!==JSON.stringify(admitted))
    fail('RUNTIME has not admitted selected SKETCH profile');
  return {runtime,model,cutChain,byId,before,sourceSketchId,profileCandidateId};
}
function uniqueCuts(cuts,sourceId){
  const bodies=new Set(),cutIds=new Set(),eventIds=new Set();
  for(const x of cuts){
    if(bodies.has(x.targetBodyId))fail('duplicate target body');
    if(cutIds.has(x.cutFeatureId))fail('duplicate cut feature');
    if(eventIds.has(x.eventId))fail('duplicate eventId');
    if(x.cutFeatureId===sourceId||x.targetBodyId===sourceId||
       x.cutFeatureId===x.targetBodyId)
      fail('aliased source, cut or target body');
    bodies.add(x.targetBodyId);cutIds.add(x.cutFeatureId);eventIds.add(x.eventId);
  }
  if(cuts.some(x=>cutIds.has(x.targetBodyId)||
      cuts.some(y=>x.cutFeatureId===y.afterBodyWriterId)))
    fail('cross-target alias or using newly created cuts as predecessors');
}
function predecessor(context,history,x){
  const {byId,before,cutChain}=context;
  const last=byId.get(x.afterBodyWriterId);
  if(!last||!['cut','extrude'].includes(last.kind)||
     !same(last.writeTargets,[x.targetBodyId])||
     (last.kind==='cut'&&last.payload?.targetBodyId!==x.targetBodyId))
    fail('selected predecessor does not write target body');
  const chain=cutChain.inspectBodyCutChain(history.document,x.targetBodyId);
  if(chain?.status!=='ready'||chain.projectId!==history.document.projectId||
     chain.revision!==history.document.revision||
     chain.eligibleAfterWriterId!==x.afterBodyWriterId)
    fail('selected body has no unique matching terminal writer');
  const status=row(before,x.afterBodyWriterId)?.status;
  if(last.kind==='extrude'?status!=='preview_only':
     !['pending_exact_provider','blocked_dependency'].includes(status))
    fail('predecessor is not an admitted body operation');
  return chain;
}
const handoff=(cutId,bodyId,rev)=>({
  kind:'runtime_evaluation_required',cutFeatureId:cutId,bodyId,
  sourceRevision:rev,compatibility:'not_claimed_ask_RUNTIME_provider',
  exactAuthority:false,independentInteroperability:false
});
function result(history,request,context,next,details){
  const report=context.runtime.inspect(next);
  const stored=new Map(context.model.featuresOf(next.document).map(f=>[f.id,f]));
  const statuses=[];
  for(const x of details){
    const cut=stored.get(x.cutFeatureId);
    if(cut?.kind!=='cut'||!same(cut.writeTargets,[x.targetBodyId])||
       cut.payload?.targetBodyId!==x.targetBodyId||
       cut.payload?.sourceSketchId!==context.sourceSketchId||
       cut.payload?.profileCandidateId!==context.profileCandidateId||
       cut.payload?.throughAll!==(x.extent.kind==='through_all')||
       (x.extent.kind==='blind'?cut.payload?.depthMm!==x.extent.depthMm:
         Object.hasOwn(cut.payload,'depthMm')))
      throw new Error('feature-ops coordinated cuts: committed identity/extent mismatch');
    const status=row(report,x.cutFeatureId)?.status;
    if(!['pending_exact_provider','blocked_dependency'].includes(status))
      throw new Error('feature-ops coordinated cuts: invalid native authority state');
    statuses.push({cutFeatureId:x.cutFeatureId,targetBodyId:x.targetBodyId,
      afterBodyWriterId:x.afterBodyWriterId,extent:x.extent,status,
      nativeHandoff:handoff(x.cutFeatureId,x.targetBodyId,next.document.revision)});
  }
  const invalidation=context.runtime.diff(history,next);
  if(!details.every(x=>invalidation?.invalidatedFeatureIds?.includes(x.cutFeatureId)))
    throw new Error('feature-ops coordinated cuts: missing dependency invalidation');
  return {kind:'committed',history:next,report,invalidation,
    sourceSketchId:context.sourceSketchId,
    selectedProfileId:context.profileCandidateId,cuts:statuses,
    semanticStatus:'ready',exactAuthority:false,independentInteroperability:false};
}

/**
 * Drill / pocket one explicitly chosen source profile into several independently
 * named bodies in ONE undo frame. INTENT creates each full writer event.
 * Every preview is verified before any mutation; one bad body aborts the batch.
 */
export function authorCoordinatedBodyCuts(history,request,services){
  const context=initial(history,request,services,
    ['format','version','expectedProjectId','expectedRevision','units','frame',
     'sourceSketchId','profileCandidateId','cuts'],'create');
  const detail=request.cuts.map(raw=>{
    exact(raw,['cutFeatureId','targetBodyId','afterBodyWriterId','eventId','extent'],'cut');
    const x={cutFeatureId:id(raw.cutFeatureId,'cutFeatureId'),
      targetBodyId:id(raw.targetBodyId,'targetBodyId'),
      afterBodyWriterId:id(raw.afterBodyWriterId,'afterBodyWriterId'),
      eventId:id(raw.eventId,'eventId'),extent:raw.extent};
    extent(x.extent);return x;
  });
  uniqueCuts(detail,context.sourceSketchId);
  const events=[];
  for(const x of detail){
    if(context.byId.has(x.cutFeatureId))fail('cut feature identity already occupied');
    if(x.afterBodyWriterId===x.cutFeatureId||
       x.afterBodyWriterId===context.sourceSketchId)
      fail('aliased predecessor');
    predecessor(context,history,x);
    const staged=context.cutChain.previewBodyCutAppend(history.document,{
      format:'intuit3d.body-cut-chain',version:1,
      expectedProjectId:request.expectedProjectId,
      expectedRevision:request.expectedRevision,eventId:x.eventId,
      cutFeatureId:x.cutFeatureId,targetBodyId:x.targetBodyId,
      afterBodyWriterId:x.afterBodyWriterId,
      sourceSketchId:context.sourceSketchId,
      profileCandidateId:context.profileCandidateId,
      extent:x.extent,admission:'require_ready'
    });
    const f=staged?.event?.feature;
    if(staged.semanticStatus!=='ready'||staged.event.type!=='feature.create'||
       staged.event.eventId!==x.eventId||f?.id!==x.cutFeatureId||
       !same(f.writeTargets,[x.targetBodyId])||
       f.payload?.targetBodyId!==x.targetBodyId||
       f.payload?.sourceSketchId!==context.sourceSketchId||
       f.payload?.profileCandidateId!==context.profileCandidateId||
       f.payload?.throughAll!==(x.extent.kind==='through_all')||
       (x.extent.kind==='blind'?f.payload?.depthMm!==x.extent.depthMm:
         Object.hasOwn(f.payload,'depthMm')))
      fail('INTENT refused or altered selected cut preview');
    events.push(staged.event);
  }
  const next=context.runtime.commit(history,events,request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+events.length||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops coordinated cuts: non-atomic commit');
  return result(history,request,context,next,detail);
}

/**
 * Retrospectively revise every chosen body pocket in one edit/undo frame.
 * Selected original extents, terminal writers, profile and revision are
 * expected-value fences. A stale/invalid second target aborts BOTH edits.
 */
export function reconfigureCoordinatedBodyCutExtents(history,request,services){
  const context=initial(history,request,services,
    ['format','version','expectedProjectId','expectedRevision','units','frame',
     'sourceSketchId','profileCandidateId','cuts'],'edit');
  const detail=request.cuts.map(raw=>{
    exact(raw,['cutFeatureId','targetBodyId','afterBodyWriterId','eventId',
      'fromExtent','toExtent'],'cut edit');
    const x={cutFeatureId:id(raw.cutFeatureId,'cutFeatureId'),
      targetBodyId:id(raw.targetBodyId,'targetBodyId'),
      afterBodyWriterId:id(raw.afterBodyWriterId,'afterBodyWriterId'),
      eventId:id(raw.eventId,'eventId'),
      fromExtent:raw.fromExtent,extent:raw.toExtent};
    extent(x.fromExtent);extent(x.extent);
    if(JSON.stringify(x.fromExtent)===JSON.stringify(x.extent))
      fail('no-op selected extent edit');
    return x;
  });
  uniqueCuts(detail,context.sourceSketchId);
  const events=[];
  for(const x of detail){
    const selected=context.byId.get(x.cutFeatureId);
    if(selected?.kind!=='cut'||!same(selected.writeTargets,[x.targetBodyId])||
       !same(selected.dependsOn,[x.afterBodyWriterId,context.sourceSketchId])||
       selected.payload?.sourceSketchId!==context.sourceSketchId||
       selected.payload?.targetBodyId!==x.targetBodyId||
       selected.payload?.profileCandidateId!==context.profileCandidateId||
       selected.payload?.units!=='mm'||selected.payload?.frame!=='local_xy'||
       selected.payload?.throughAll!==(x.fromExtent.kind==='through_all')||
       (x.fromExtent.kind==='blind'?
         selected.payload?.depthMm!==x.fromExtent.depthMm:
         Object.hasOwn(selected.payload,'depthMm')))
      fail('selected cut/profile/body/original extent has changed');
    const chain=context.cutChain.inspectBodyCutChain(history.document,x.targetBodyId);
    if(chain?.status!=='ready'||!chain.bodyWriterIds?.includes(x.cutFeatureId)||
       !chain.bodyWriterIds?.includes(x.afterBodyWriterId))
      fail('selected body has ambiguous writers');
    const inspected=context.cutChain.inspectBodyCutExtent(history.document,
      x.cutFeatureId,x.targetBodyId);
    if(inspected?.projectId!==request.expectedProjectId||
       inspected.revision!==request.expectedRevision||
       inspected.semanticStatus!=='ready'||
       JSON.stringify(inspected.extent)!==JSON.stringify(x.fromExtent))
      fail('selected original extent is stale or unresolved');
    if(!['pending_exact_provider','blocked_dependency'].includes(
      row(context.before,x.cutFeatureId)?.status))
      fail('cut is not a recoverable native-pending operation');
    const staged=context.cutChain.previewBodyCutExtentEdit(history.document,{
      format:'intuit3d.body-cut-extent-edit',version:1,
      expectedProjectId:request.expectedProjectId,
      expectedRevision:request.expectedRevision,eventId:x.eventId,
      cutFeatureId:x.cutFeatureId,targetBodyId:x.targetBodyId,
      fromExtent:x.fromExtent,toExtent:x.extent,admission:'require_ready'
    });
    const payload=staged?.event?.patch?.payload;
    if(staged?.semanticStatus!=='ready'||staged.event.type!=='feature.edit'||
       staged.event.eventId!==x.eventId||staged.event.featureId!==x.cutFeatureId||
       payload?.sourceSketchId!==context.sourceSketchId||
       payload?.targetBodyId!==x.targetBodyId||
       payload?.profileCandidateId!==context.profileCandidateId||
       payload?.throughAll!==(x.extent.kind==='through_all')||
       (x.extent.kind==='blind'?payload?.depthMm!==x.extent.depthMm:
         Object.hasOwn(payload,'depthMm')))
      fail('INTENT refused or altered selected extent edit');
    events.push(staged.event);
  }
  const next=context.runtime.commit(history,events,request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+events.length||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops coordinated cuts: non-atomic retrospective edit');
  const revised=result(history,request,context,next,detail);
  const stored=new Map(context.model.featuresOf(next.document).map(x=>[x.id,x]));
  for(const x of detail){
    const original=context.byId.get(x.cutFeatureId);
    const actual=stored.get(x.cutFeatureId);
    if(!same(actual?.dependsOn,original.dependsOn)||
       !same(actual?.writeTargets,original.writeTargets))
      throw new Error('feature-ops coordinated cuts: retrospective edit changed lineage');
  }
  return {...revised,previousExtents:detail.map(x=>({
    cutFeatureId:x.cutFeatureId,extent:x.fromExtent
  }))};
}
