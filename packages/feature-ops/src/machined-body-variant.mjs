/**
 * FEATUREOPS machined-body-variant/v1: author a new explicit body extrusion
 * and 2–8 body-targeted machining cuts as ONE undoable user action.
 *
 * This composes accepted profile-solid and cut-recipe planners on disposable
 * histories; it does not implement a second solver, topology mapper, or journal.
 * Source and target SKETCHes are independently selected, never transformed.
 */
import {PROFILE_OPS_FORMAT,authorProfileExtrusion} from './profile-solid.mjs';
import {ADAPTED_RECIPE_FORMAT,inspectAdaptableCutRecipe,
  applyAdaptedCutRecipe} from './adapted-cut-recipe.mjs';
import {CUT_RECIPE_COPY_FORMAT,copyCutRecipeToBody} from './cut-recipe-copy.mjs';

export const MACHINED_VARIANT_FORMAT='intuit3d.feature-ops.machined-body-variant';
export const MACHINED_VARIANT_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const baseFields=['format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','units','frame','sourceBodyId','sourceCutFeatureIds',
  'baseSketchId','baseProfileCandidateId','depthMm','newExtrudeFeatureId',
  'newBodyId','newExtrudeEventId'];
const applyFields=[...baseFields,'expectedSourceCuts','targetCuts',
  'newCutFeatureIds','cutEventIds'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function fail(msg){throw new TypeError('machined-body-variant: '+msg);}
function exact(x,fields,label){
  if(!plain(x)||Object.keys(x).length!==fields.length||
     fields.some(k=>!Object.hasOwn(x,k))||
     Object.keys(x).some(k=>!fields.includes(k)))fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!ID.test(x))fail('invalid '+label);return x;}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function extentEqual(a,b){
  return plain(a)&&plain(b)&&a.kind===b.kind&&
    (a.kind==='through_all'||
      (a.kind==='blind'&&a.depthMm===b.depthMm));
}
function sameRecipe(targets,original){
  return targets.every((t,i)=>t.sourceCutFeatureId===original[i].sourceCutFeatureId&&
    t.sourceSketchId===original[i].sourceSketchId&&
    t.profileCandidateId===original[i].profileCandidateId&&
    extentEqual(t.extent,original[i].extent));
}
function requireServices(services){
  const {model,runtime}=services??{};
  if(typeof model?.featuresOf!=='function'||
     typeof model?.serializeProject!=='function'||
     typeof runtime?.commit!=='function'||
     typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function')fail('accepted INTENT and RUNTIME services required');
  return {model,runtime};
}
function context(history,request,services,fields){
  exact(request,fields,'request');
  if(request.format!==MACHINED_VARIANT_FORMAT||
     request.version!==MACHINED_VARIANT_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported version, units or frame');
  const s=requireServices(services);
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     request.expectedProjectId!==history.document.projectId||
     request.expectedRevision!==history.document.revision||
     request.expectedDocumentFence!==s.model.serializeProject(history.document))
    fail('stale project, revision or canonical archive');
  id(request.sourceBodyId,'sourceBodyId');
  id(request.baseSketchId,'baseSketchId');
  id(request.newBodyId,'newBodyId');
  if(request.sourceBodyId===request.newBodyId)fail('new body cannot be source body');
  if(!Array.isArray(request.sourceCutFeatureIds)||
     request.sourceCutFeatureIds.length<2||request.sourceCutFeatureIds.length>8||
     new Set(request.sourceCutFeatureIds).size!==request.sourceCutFeatureIds.length)
    fail('select 2–8 distinct ordered machining cuts');
  request.sourceCutFeatureIds.forEach(x=>id(x,'sourceCutFeatureId'));
  if(typeof request.baseProfileCandidateId!=='string'||
     !request.baseProfileCandidateId.startsWith('cycle:')||
     request.baseProfileCandidateId.length>8192)
    fail('explicit SKETCH base profile required');
  if(typeof request.depthMm!=='number'||!Number.isFinite(request.depthMm)||
     request.depthMm<=0)fail('positive finite extrusion depth in mm required');
  if(fields===applyFields&&(!Array.isArray(request.newCutFeatureIds)||
     !Array.isArray(request.cutEventIds)))
    fail('fresh per-cut feature/event arrays required');
  const newIds=[request.newExtrudeFeatureId,request.newBodyId,
    request.newExtrudeEventId,
    ...(fields===applyFields?[...request.newCutFeatureIds??[],
      ...request.cutEventIds??[]]:[])];
  newIds.forEach(x=>id(x,'new feature/body/event ID'));
  if(new Set(newIds).size!==newIds.length)fail('new semantic/event identities alias');
  const features=s.model.featuresOf(history.document);
  const occupied=new Set([...features.map(f=>f.id),
    ...features.flatMap(f=>f.writeTargets??[]),
    ...history.document.journal.map(e=>e.eventId)]);
  if(newIds.some(x=>occupied.has(x)))fail('new feature/body/event identity already used');
  return s;
}
function plan(history,request,services,fields){
  const s=context(history,request,services,fields);
  // Stage the base extrusion only. It is NOT returned to the caller as a
  // committed project and can be safely abandoned on any later refusal.
  const extrusion=authorProfileExtrusion(history,{
    format:PROFILE_OPS_FORMAT,version:1,
    eventId:request.newExtrudeEventId,
    expectedRevision:request.expectedRevision,
    sourceSketchId:request.baseSketchId,
    profileCandidateId:request.baseProfileCandidateId,
    extrudeFeatureId:request.newExtrudeFeatureId,
    outputBodyId:request.newBodyId,depthMm:request.depthMm,
    units:'mm',frame:'local_xy'},services);
  const staged=extrusion.history;
  const selection={format:ADAPTED_RECIPE_FORMAT,version:1,
    expectedProjectId:staged.document.projectId,
    expectedRevision:staged.document.revision,
    expectedDocumentFence:s.model.serializeProject(staged.document),
    units:'mm',frame:'local_xy',
    sourceBodyId:request.sourceBodyId,targetBodyId:request.newBodyId,
    sourceCutFeatureIds:request.sourceCutFeatureIds,
    targetAfterBodyWriterId:request.newExtrudeFeatureId};
  const inspected=inspectAdaptableCutRecipe(staged,selection,services);
  return {s,extrusion,selection,inspected};
}

/** Read-only, source-fenced inspection for Create machined variant UI. */
export function inspectMachinedBodyVariant(history,request,services){
  const {inspected}=plan(history,request,services,baseFields);
  return {format:MACHINED_VARIANT_FORMAT,version:1,kind:'variant_inspection',
    projectId:request.expectedProjectId,revision:request.expectedRevision,
    documentFence:request.expectedDocumentFence,
    units:'mm',frame:'local_xy',
    sourceBodyId:request.sourceBodyId,newBodyId:request.newBodyId,
    baseSketchId:request.baseSketchId,
    selectedBaseProfileId:request.baseProfileCandidateId,
    depthMm:request.depthMm,
    sourceWriterOrder:inspected.sourceWriterOrder,
    sourceCuts:inspected.sourceCuts,
    targetCutsMustBeExplicit:true,atomicBodyAndRecipe:true,
    providerStatus:'pending_exact_provider',
    exactAuthority:false,independentInteroperability:false};
}

/**
 * Create a fully machined variant, including new base body and ordered cuts,
 * as one RUNTIME commit / one undo frame. Accepted INTENT cut append previews
 * and RUNTIME sketch admission run on disposable histories first.
 */
export function createMachinedBodyVariant(history,request,services){
  const {s,extrusion,selection,inspected}=plan(history,request,services,applyFields);
  if(!equal(request.expectedSourceCuts,inspected.sourceCuts))
    fail('stale source recipe inspection');
  if(!Array.isArray(request.targetCuts)||
     request.targetCuts.length!==inspected.sourceCuts.length)
    fail('one explicit selected target sketch and extent per source cut required');
  if(!Array.isArray(request.newCutFeatureIds)||
     !Array.isArray(request.cutEventIds)||
     request.newCutFeatureIds.length!==inspected.sourceCuts.length||
     request.cutEventIds.length!==inspected.sourceCuts.length)
    fail('one fresh feature and event ID required per cut');
  // The unchanged-copy branch must be just as strict as adapted target
  // selection: never silently ignore unknown geometry fields.
  for(const cut of request.targetCuts){
    exact(cut,['sourceCutFeatureId','sourceSketchId','profileCandidateId','extent'],
      'target cut');
    const e=cut.extent;
    exact(e,e?.kind==='blind'?['kind','depthMm']:['kind'],'target extent');
    if(e.kind!=='through_all'&&
       (e.kind!=='blind'||typeof e.depthMm!=='number'||
        !Number.isFinite(e.depthMm)||e.depthMm<=0))
      fail('invalid target machining depth');
  }
  const copied=sameRecipe(request.targetCuts,inspected.sourceCuts);
  const forwarded={...selection,expectedSourceCuts:inspected.sourceCuts,
    newCutFeatureIds:request.newCutFeatureIds,
    eventIds:request.cutEventIds};
  const adapted=copied
    ?copyCutRecipeToBody(extrusion.history,{
      ...forwarded,format:CUT_RECIPE_COPY_FORMAT},services)
    :applyAdaptedCutRecipe(extrusion.history,{
      ...forwarded,targetCuts:request.targetCuts},services);
  const staged=adapted.history;
  const journalPrefix=history.document.journal;
  if(!Array.isArray(staged.document.journal)||
     staged.document.journal.length!==journalPrefix.length+1+request.targetCuts.length||
     !equal(staged.document.journal.slice(0,journalPrefix.length),journalPrefix))
    throw new Error('machined-body-variant: staged journal differs from source');
  const events=staged.document.journal.slice(journalPrefix.length);
  if(events[0]?.eventId!==request.newExtrudeEventId||
     events.slice(1).some((e,i)=>e.eventId!==request.cutEventIds[i]))
    throw new Error('machined-body-variant: staged event identities changed');
  // The ONLY real application commit. No partial body on a failed second cut.
  const next=s.runtime.commit(history,events,history.document.revision);
  if(next.document.revision!==history.document.revision+events.length||
     next.undoStack.length!==history.undoStack.length+1||
     s.model.serializeProject(next.document)!==s.model.serializeProject(staged.document))
    throw new Error('machined-body-variant: atomic source mismatch');
  const report=s.runtime.inspect(next);
  const states=new Map(report.features.map(f=>[f.featureId,f]));
  const features=new Map(s.model.featuresOf(next.document).map(f=>[f.id,f]));
  const base=features.get(request.newExtrudeFeatureId);
  if(base?.kind!=='extrude'||base.payload?.thicknessMm!==request.depthMm||
     base.payload?.sourceSketchId!==request.baseSketchId||
     !equal(base.writeTargets,[request.newBodyId])||
     states.get(base.id)?.status!=='preview_only')
    throw new Error('machined-body-variant: base extrusion not admitted');
  const cuts=request.newCutFeatureIds.map((cutFeatureId,i)=>{
    const f=features.get(cutFeatureId),target=request.targetCuts[i];
    const state=states.get(cutFeatureId)?.status;
    if(f?.kind!=='cut'||!equal(f.writeTargets,[request.newBodyId])||
       f.payload?.targetBodyId!==request.newBodyId||
       f.payload?.sourceSketchId!==target.sourceSketchId||
       f.payload?.profileCandidateId!==target.profileCandidateId||
       f.payload?.throughAll!==(target.extent.kind==='through_all')||
       (target.extent.kind==='blind'?
         f.payload?.depthMm!==target.extent.depthMm:
         Object.hasOwn(f.payload,'depthMm'))||
       !['pending_exact_provider','blocked_dependency'].includes(state))
      throw new Error('machined-body-variant: cut geometry/identity/status mismatch');
    return {sourceCutFeatureId:target.sourceCutFeatureId,cutFeatureId,
      sourceSketchId:target.sourceSketchId,extent:target.extent,
      targetBodyId:request.newBodyId,status:state};
  });
  const invalidation=s.runtime.diff(history,next);
  if(![request.newExtrudeFeatureId,...request.newCutFeatureIds]
    .every(x=>invalidation.invalidatedFeatureIds?.includes(x)))
    throw new Error('machined-body-variant: lost dependency invalidation');
  return {kind:'committed',history:next,report,invalidation,
    sourceBodyId:request.sourceBodyId,newBodyId:request.newBodyId,
    newExtrudeFeatureId:request.newExtrudeFeatureId,
    baseSketchId:request.baseSketchId,depthMm:request.depthMm,
    copiedCuts:cuts,sourceWriterOrder:inspected.sourceWriterOrder,
    newBodyWriterOrder:[request.newExtrudeFeatureId,...request.newCutFeatureIds],
    sourceSketchSemantics:copied?'shared_source_profiles':'explicit_per_cut_source_selection',
    eventIds:events.map(x=>x.eventId),oneUndoFrame:true,
    nativeHandoff:{kind:'runtime_evaluation_required',bodyId:request.newBodyId,
      sourceRevision:next.document.revision,
      orderedCutFeatureIds:[...request.newCutFeatureIds],
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
