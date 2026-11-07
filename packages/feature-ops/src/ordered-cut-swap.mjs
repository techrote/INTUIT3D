/**
 * FEATUREOPS ordered-cut-swap/v1. INTENT owns the body dependency DAG and
 * undoable journal, SKETCH owns profile admission, RUNTIME owns evaluation.
 * This API does not execute a Boolean or attest physical STEP.
 */
export const ORDERED_CUT_SWAP_FORMAT='intuit3d.feature-ops.ordered-cut-swap';
export const ORDERED_CUT_SWAP_VERSION=1;
const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function fail(reason){throw new TypeError('feature-ops cut swap: '+reason);}
function exact(x,fields,label){
  if(!plain(x)||Object.keys(x).length!==fields.length||
    fields.some(f=>!Object.hasOwn(x,f))||Object.keys(x).some(f=>!fields.includes(f)))
    fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!IDENT.test(x))fail('invalid '+label);return x;}
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>x===b[i]);
const row=(report,id)=>report?.features?.find(x=>x.featureId===id);
function extent(x){
  exact(x,x?.kind==='blind'?['kind','depthMm']:['kind'],'cut extent');
  if(x.kind==='through_all')return;
  if(x.kind!=='blind'||typeof x.depthMm!=='number'||!Number.isFinite(x.depthMm)||x.depthMm<=0)
    fail('positive finite blind depth required');
}
function sourceProof(selection,feature,byId,services,report,bodyId){
  exact(selection,['cutFeatureId','sourceSketchId','profileCandidateId','extent'],'cut selection');
  const cutId=id(selection.cutFeatureId,'cut feature');
  const sketchId=id(selection.sourceSketchId,'source sketch');
  if(typeof selection.profileCandidateId!=='string'||
     !selection.profileCandidateId.startsWith('cycle:')||selection.profileCandidateId.length>8192)
    fail('explicit canonical SKETCH profile required');
  extent(selection.extent);
  if(feature?.id!==cutId||feature.kind!=='cut'||!same(feature.writeTargets,[bodyId])||
     feature.payload?.targetBodyId!==bodyId||feature.payload?.sourceSketchId!==sketchId||
     feature.payload?.profileCandidateId!==selection.profileCandidateId||
     feature.payload?.units!=='mm'||feature.payload?.frame!=='local_xy'||
     feature.payload?.throughAll!==(selection.extent.kind==='through_all')||
     (selection.extent.kind==='blind'?feature.payload?.depthMm!==selection.extent.depthMm:
       Object.hasOwn(feature.payload,'depthMm')))
    fail('cut selection no longer matches authored body/source/extent');
  const source=byId.get(sketchId);
  if(source?.kind!=='sketch'||!source.payload?.sketch||!same(source.writeTargets,[]))
    fail('selected authored SKETCH unavailable');
  const sketch=services.sketch.validateSketch(source.payload.sketch);
  const discovery=services.discovery.discoverPlateProfiles(sketch);
  if(discovery?.status!=='ready'||discovery.candidates?.length!==1||
     discovery.candidates[0].id!==selection.profileCandidateId)
    fail('source SKETCH is missing, ambiguous or stale');
  const admitted=services.discovery.admitDiscoveredPlateProfile(sketch,discovery,
    selection.profileCandidateId);
  const sourceState=row(report,sketchId);
  if(sourceState?.status!=='analytic_profile_only'||
     sourceState.profile?.status!=='analytic_profile_only'||
     JSON.stringify(sourceState.profile)!==JSON.stringify(admitted))
    fail('RUNTIME disagrees with selected SKETCH profile');
  const status=row(report,cutId)?.status;
  if(status!=='pending_exact_provider'&&status!=='blocked_dependency')
    fail('selected cut is not a recoverable pending native operation');
}
/**
 * Swap two adjacent cuts in actual body execution order; leave authored
 * timeline chronology unchanged. Native geometry is invalidated, never made up.
 * Explicit selected writer order, profile, extent and revision act as UI fences.
 */
export function swapOrderedBodyCuts(history,request,services){
  exact(request,['format','version','expectedProjectId','expectedRevision',
    'units','frame','targetBodyId','firstCutFeatureId','secondCutFeatureId',
    'expectedWriterOrder','cutSelections','eventIds'],'request');
  if(request.format!==ORDERED_CUT_SWAP_FORMAT||request.version!==ORDERED_CUT_SWAP_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported format/version or local_xy mm frame');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     history.document.revision!==request.expectedRevision||
     history.document.projectId!==request.expectedProjectId)
    throw new Error('feature-ops cut swap: stale project/revision');
  const bodyId=id(request.targetBodyId,'target body');
  const firstId=id(request.firstCutFeatureId,'first cut');
  const secondId=id(request.secondCutFeatureId,'second cut');
  if(new Set([bodyId,firstId,secondId]).size!==3)fail('aliased body or cuts');
  if(!Array.isArray(request.expectedWriterOrder)||request.expectedWriterOrder.length<3||
     new Set(request.expectedWriterOrder).size!==request.expectedWriterOrder.length)
    fail('unique explicit body writer order required');
  request.expectedWriterOrder.forEach(v=>id(v,'body writer'));
  if(!Array.isArray(request.eventIds)||!([2,3].includes(request.eventIds.length))||
     new Set(request.eventIds).size!==request.eventIds.length)
    fail('two or three unique event IDs required');
  request.eventIds.forEach(v=>id(v,'event ID'));
  if(!Array.isArray(request.cutSelections)||request.cutSelections.length!==2||
     !request.cutSelections.every((x,i)=>x?.cutFeatureId===([firstId,secondId][i])))
    fail('two ordered expected cut selections required');
  const {runtime,model,sketch,discovery,cutChain,cutOrder}=services??{};
  if(typeof runtime?.inspect!=='function'||typeof runtime?.diff!=='function'||
     typeof model?.featuresOf!=='function'||typeof sketch?.validateSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof cutChain?.inspectBodyCutChain!=='function'||
     typeof cutOrder?.previewBodyCutSwap!=='function'||
     typeof cutOrder?.commitUndoableBodyCutSwap!=='function')
    fail('accepted INTENT cut-order, SKETCH and RUNTIME services required');
  const chain=cutChain.inspectBodyCutChain(history.document,bodyId);
  // inspectBodyCutChain.bodyWriterIds follows authored chronology, which need
  // not equal dependency execution order after an earlier successful swap.
  if(chain?.status!=='ready'||chain?.projectId!==request.expectedProjectId||
     chain?.revision!==request.expectedRevision||
     !Array.isArray(chain.bodyWriterIds)||
     chain.bodyWriterIds.length!==request.expectedWriterOrder.length||
     !chain.bodyWriterIds.every(id=>request.expectedWriterOrder.includes(id)))
    fail('selected body writer set is stale or ambiguous');
  const index=request.expectedWriterOrder.indexOf(firstId);
  if(index<1||request.expectedWriterOrder[index+1]!==secondId||
     request.eventIds.length!==(index+2<request.expectedWriterOrder.length?3:2))
    fail('cuts are not adjacent or downstream event IDs are missing');
  const features=model.featuresOf(history.document);
  const byId=new Map(features.map(f=>[f.id,f]));
  const before=runtime.inspect(history);
  sourceProof(request.cutSelections[0],byId.get(firstId),byId,services,before,bodyId);
  sourceProof(request.cutSelections[1],byId.get(secondId),byId,services,before,bodyId);
  const modelRequest={format:'intuit3d.body-cut-order',version:1,
    expectedProjectId:request.expectedProjectId,expectedRevision:request.expectedRevision,
    targetBodyId:bodyId,firstCutFeatureId:firstId,secondCutFeatureId:secondId,
    eventIds:request.eventIds};
  // INTENT is the authority for cycles, authored topology and noncommutation.
  const preview=cutOrder.previewBodyCutSwap(history.document,modelRequest);
  const expected=[...request.expectedWriterOrder];
  [expected[index],expected[index+1]]=[expected[index+1],expected[index]];
  if(!same(preview.writerOrderBefore,request.expectedWriterOrder)||
     !same(preview.writerOrderAfter,expected)||preview.events?.length!==request.eventIds.length||
     preview.exactGeometryAuthority!==false||preview.requiresNativeRebuild!==true||
     preview.authoredTimelineChanged!==false)
    fail('INTENT swap preview does not match selected physical cut order');
  const next=cutOrder.commitUndoableBodyCutSwap(history,modelRequest);
  if(next.document.revision!==request.expectedRevision+request.eventIds.length)
    throw new Error('feature-ops cut swap: unexpected committed revision');
  const afterChain=cutChain.inspectBodyCutChain(next.document,bodyId);
  if(afterChain?.status!=='ready'||afterChain.eligibleAfterWriterId!==expected.at(-1))
    throw new Error('feature-ops cut swap: committed body writer chain is not unique');
  const nextFeatures=new Map(model.featuresOf(next.document).map(f=>[f.id,f]));
  for(const original of [byId.get(firstId),byId.get(secondId)]){
    const actual=nextFeatures.get(original.id);
    if(!actual||!same(actual.writeTargets,original.writeTargets)||
       JSON.stringify(actual.payload)!==JSON.stringify(original.payload))
      throw new Error('feature-ops cut swap: cut lost identity, body or authored extent');
  }
  const report=runtime.inspect(next);
  for(const fid of [firstId,secondId]){
    const status=row(report,fid)?.status;
    if(!['pending_exact_provider','blocked_dependency'].includes(status))
      throw new Error('feature-ops cut swap: unexpected post-swap native status');
  }
  const invalidation=runtime.diff(history,next);
  if(![firstId,secondId].every(fid=>invalidation?.invalidatedFeatureIds?.includes(fid)))
    throw new Error('feature-ops cut swap: native invalidation missing swapped cut');
  return {kind:'committed',history:next,report,invalidation,
    writerOrderBefore:preview.writerOrderBefore,writerOrderAfter:preview.writerOrderAfter,
    structuralInvalidation:preview.invalidation,authoredTimelineChanged:false,
    semanticIds:{bodyId,firstCutId:firstId,secondCutId:secondId},
    statuses:[firstId,secondId].map(fid=>({cutFeatureId:fid,status:row(report,fid).status})),
    nativeHandoff:{kind:'runtime_evaluation_required',bodyId,
      fromRevision:request.expectedRevision,sourceRevision:next.document.revision,
      orderedWriterIds:expected,compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}