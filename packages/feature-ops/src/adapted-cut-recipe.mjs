/**
 * User-selected target-profile adaptation of an existing ordered machining
 * recipe. INTENT creates real features; RUNTIME is the sole journal authority.
 * No implicit sketch clone, body transform, native Boolean or STEP assertion.
 */
import {CUT_RECIPE_COPY_FORMAT,inspectCutRecipeCopy} from './cut-recipe-copy.mjs';
export const ADAPTED_RECIPE_FORMAT='intuit3d.feature-ops.adapted-cut-recipe';
export const ADAPTED_RECIPE_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
  a.length===b.length&&a.every((x,i)=>x===b[i]);
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const status=(r,id)=>r.features?.find(x=>x.featureId===id)?.status;
function fail(msg){throw new TypeError('adapted-cut-recipe: '+msg);}
function exact(x,fields,label){
  if(!plain(x)||Object.keys(x).length!==fields.length||
     fields.some(k=>!Object.hasOwn(x,k))||
     Object.keys(x).some(k=>!fields.includes(k)))fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!ID.test(x))fail('invalid '+label);return x;}
function extent(x){
  exact(x,x?.kind==='blind'?['kind','depthMm']:['kind'],'extent');
  if(x.kind==='through_all')return;
  if(x.kind!=='blind'||!Number.isFinite(x.depthMm)||x.depthMm<=0)
    fail('invalid positive blind depth');
}
const baseFields=['format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','units','frame','sourceBodyId','targetBodyId',
  'sourceCutFeatureIds','targetAfterBodyWriterId'];
const applyFields=[...baseFields,'expectedSourceCuts','targetCuts',
  'newCutFeatureIds','eventIds'];
function context(history,request,services,fields){
  exact(request,fields,'request');
  if(request.format!==ADAPTED_RECIPE_FORMAT||request.version!==1||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported contract, units or frame');
  const {runtime,model,sketch,discovery,cutChain}=services??{};
  if(!runtime?.commit||!runtime?.inspect||!runtime?.diff||!model?.featuresOf||
     !model?.serializeProject||!sketch?.validateSketch||
     !discovery?.discoverPlateProfiles||!discovery?.admitDiscoveredPlateProfile||
     !cutChain?.previewBodyCutAppend||!cutChain?.inspectBodyCutChain)
    fail('accepted INTENT SKETCH RUNTIME services required');
  const selected=Object.fromEntries(baseFields.map(k=>[k,request[k]]));
  selected.format=CUT_RECIPE_COPY_FORMAT;
  // Reuse accepted source-cut, terminal, canonical document and RUNTIME
  // admission checks; do not duplicate body lineage or sketch inference.
  const inventory=inspectCutRecipeCopy(history,selected,services);
  return {inventory,runtime,model,sketch,discovery,cutChain};
}
export function inspectAdaptableCutRecipe(history,request,services){
  const x=context(history,request,services,baseFields).inventory;
  return {format:ADAPTED_RECIPE_FORMAT,version:1,kind:'adaptation_inspection',
    projectId:x.projectId,revision:x.revision,documentFence:x.documentFence,
    units:'mm',frame:'local_xy',sourceBodyId:x.sourceBodyId,
    targetBodyId:x.targetBodyId,sourceCuts:x.sourceCuts,
    sourceWriterOrder:x.sourceWriterOrder,targetWriterOrder:x.targetWriterOrder,
    targetAfterBodyWriterId:x.targetAfterBodyWriterId,
    targetCutsMustBeExplicit:true,providerStatus:'pending_exact_provider',
    exactAuthority:false,independentInteroperability:false};
}
export function applyAdaptedCutRecipe(history,request,services){
  const p=context(history,request,services,applyFields);
  const {inventory,model,runtime,sketch,discovery,cutChain}=p;
  const original=inventory.sourceCuts;
  if(!eq(request.expectedSourceCuts,original))fail('stale source cut selection');
  if(!Array.isArray(request.targetCuts)||request.targetCuts.length!==original.length)
    fail('one target source and extent required per cut');
  const cutIds=request.newCutFeatureIds, eventIds=request.eventIds;
  if(!Array.isArray(cutIds)||!Array.isArray(eventIds)||
     cutIds.length!==original.length||eventIds.length!==original.length)
    fail('one new feature and event ID required per cut');
  const features=model.featuresOf(history.document),byId=new Map(features.map(f=>[f.id,f]));
  const used=new Set([...features.map(f=>f.id),
    ...features.flatMap(f=>f.writeTargets??[]),
    ...history.document.journal.map(e=>e.eventId)]);
  const fresh=[...cutIds,...eventIds];
  fresh.forEach(v=>id(v,'feature/event ID'));
  if(new Set(fresh).size!==fresh.length||fresh.some(v=>used.has(v)))
    fail('duplicate or used feature/event ID');
  const reportBefore=runtime.inspect(history),seen=new Set();
  let adapted=false;
  const targets=request.targetCuts.map((cut,i)=>{
    exact(cut,['sourceCutFeatureId','sourceSketchId','profileCandidateId','extent'],
      'adapted target cut');
    if(id(cut.sourceCutFeatureId,'source cut ID')!==original[i].sourceCutFeatureId)
      fail('source cut order differs from inspection');
    const sketchId=id(cut.sourceSketchId,'target SKETCH ID');
    if(typeof cut.profileCandidateId!=='string'||
       !cut.profileCandidateId.startsWith('cycle:')||
       cut.profileCandidateId.length>8192)
      fail('invalid target profile selection');
    extent(cut.extent);
    const sk=byId.get(sketchId);
    if(sk?.kind!=='sketch'||!sk.payload?.sketch||!same(sk.writeTargets,[]))
      fail('target SKETCH is not an explicit active source');
    const key=JSON.stringify([sketchId,cut.profileCandidateId]);
    if(!seen.has(key)){
      const solved=sketch.validateSketch(sk.payload.sketch);
      const found=discovery.discoverPlateProfiles(solved);
      if(found.status!=='ready'||found.candidates?.length!==1||
         found.candidates[0].id!==cut.profileCandidateId)
        fail('target SKETCH profile is stale, unresolved or ambiguous');
      const admitted=discovery.admitDiscoveredPlateProfile(
        solved,found,cut.profileCandidateId);
      const present=reportBefore.features?.find(f=>f.featureId===sketchId);
      if(present?.status!=='analytic_profile_only'||
         present.profile?.status!=='analytic_profile_only'||
         !eq(present.profile,admitted))
        fail('target SKETCH disagrees with authoritative RUNTIME');
      seen.add(key);
    }
    if(sketchId!==original[i].sourceSketchId||
       cut.profileCandidateId!==original[i].profileCandidateId||
       !eq(cut.extent,original[i].extent))adapted=true;
    return {sourceCutFeatureId:cut.sourceCutFeatureId,
      sourceSketchId:sketchId,profileCandidateId:cut.profileCandidateId,
      extent:cut.extent};
  });
  if(!adapted)fail('unchanged recipe; use shared-source cut-recipe-copy/v1');
  let staged=history, predecessor=request.targetAfterBodyWriterId;
  const events=[];
  for(let i=0;i<targets.length;i++){
    const t=targets[i];
    const preview=cutChain.previewBodyCutAppend(staged.document,{
      format:'intuit3d.body-cut-chain',version:1,
      expectedProjectId:history.document.projectId,
      expectedRevision:staged.document.revision,eventId:eventIds[i],
      cutFeatureId:cutIds[i],targetBodyId:request.targetBodyId,
      afterBodyWriterId:predecessor,sourceSketchId:t.sourceSketchId,
      profileCandidateId:t.profileCandidateId,extent:t.extent,
      admission:'require_ready'});
    const e=preview?.event,f=e?.feature;
    if(preview.semanticStatus!=='ready'||preview.requiresNativeRebuild!==true||
       preview.exactGeometryAuthority!==false||e?.type!=='feature.create'||
       e.eventId!==eventIds[i]||f?.id!==cutIds[i]||f.kind!=='cut'||
       !same(f.writeTargets,[request.targetBodyId])||
       !same(f.dependsOn,[predecessor,t.sourceSketchId])||
       f.payload?.sourceSketchId!==t.sourceSketchId||
       f.payload?.profileCandidateId!==t.profileCandidateId||
       f.payload?.targetBodyId!==request.targetBodyId||
       f.payload?.units!=='mm'||f.payload?.frame!=='local_xy'||
       f.payload?.throughAll!==(t.extent.kind==='through_all')||
       (t.extent.kind==='blind'?f.payload?.depthMm!==t.extent.depthMm:
         Object.hasOwn(f.payload,'depthMm')))
      fail('INTENT changed or refused selected target cut');
    events.push(e);
    staged=runtime.commit(staged,[e],staged.document.revision);
    predecessor=cutIds[i];
  }
  const next=runtime.commit(history,events,history.document.revision);
  if(next.document.revision!==history.document.revision+events.length||
     next.undoStack.length!==history.undoStack.length+1||
     model.serializeProject(next.document)!==model.serializeProject(staged.document))
    throw new Error('adapted-cut-recipe: atomic commit differs from staged plan');
  const actual=new Map(model.featuresOf(next.document).map(f=>[f.id,f]));
  const report=runtime.inspect(next);
  const copiedCuts=targets.map((t,i)=>{
    const f=actual.get(cutIds[i]),state=status(report,cutIds[i]);
    if(f?.kind!=='cut'||!same(f.writeTargets,[request.targetBodyId])||
       f.payload?.targetBodyId!==request.targetBodyId||
       f.payload?.sourceSketchId!==t.sourceSketchId||
       f.payload?.profileCandidateId!==t.profileCandidateId||
       f.payload?.throughAll!==(t.extent.kind==='through_all')||
       (t.extent.kind==='blind'?f.payload?.depthMm!==t.extent.depthMm:
         Object.hasOwn(f.payload,'depthMm'))||
       !['pending_exact_provider','blocked_dependency'].includes(state))
      throw new Error('adapted-cut-recipe: committed status/identity mismatch');
    return {...t,cutFeatureId:cutIds[i],targetBodyId:request.targetBodyId,
      status:state};
  });
  const invalidation=runtime.diff(history,next);
  if(!cutIds.every(id=>invalidation.invalidatedFeatureIds?.includes(id)))
    throw new Error('adapted-cut-recipe: missing new cut invalidation');
  return {kind:'committed',history:next,report,invalidation,copiedCuts,
    sourceBodyId:request.sourceBodyId,targetBodyId:request.targetBodyId,
    sourceWriterOrder:inventory.sourceWriterOrder,
    targetWriterOrderBefore:inventory.targetWriterOrder,
    targetWriterOrderAfter:[...inventory.targetWriterOrder,...cutIds],
    eventIds:[...eventIds],oneUndoFrame:true,
    sourceSketchSemantics:'explicit_per_cut_source_selection',
    nativeHandoff:{kind:'runtime_evaluation_required',bodyId:request.targetBodyId,
      sourceRevision:next.document.revision,orderedCutFeatureIds:[...cutIds],
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
