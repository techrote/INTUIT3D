/**
 * FEATUREOPS multi-target-cut-recipe/v1.
 * Copy one selected ordered machining block to 2–4 independently selected
 * bodies as ONE authoritative RUNTIME undo frame. Each target may reuse the
 * exact SKETCH sources or explicitly adapt each profile and extent.
 *
 * Only accepted single-target recipe planners may create events. This module
 * neither infers transforms nor claims physical Boolean/STEP authority.
 */
import {CUT_RECIPE_COPY_FORMAT,inspectCutRecipeCopy,
  copyCutRecipeToBody} from './cut-recipe-copy.mjs';
import {ADAPTED_RECIPE_FORMAT,applyAdaptedCutRecipe}
  from './adapted-cut-recipe.mjs';

export const MULTI_TARGET_CUT_RECIPE_FORMAT =
  'intuit3d.feature-ops.multi-target-cut-recipe';
export const MULTI_TARGET_CUT_RECIPE_VERSION=1;
const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const selectionFields=['format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','units','frame','sourceBodyId',
  'sourceCutFeatureIds','targets'];
const applicationFields=[...selectionFields,'expectedSourceCuts','targetPlans'];
function fail(message){throw new TypeError('multi-target-cut-recipe: '+message);}
function exact(x,fields,label){
  if(!plain(x)||Object.keys(x).length!==fields.length||
     fields.some(k=>!Object.hasOwn(x,k))||
     Object.keys(x).some(k=>!fields.includes(k)))fail('invalid '+label);
}
function id(x,label){
  if(typeof x!=='string'||!IDENT.test(x))fail('invalid '+label);
  return x;
}
function read(history,request,services,fields){
  exact(request,fields,'request');
  if(request.format!==MULTI_TARGET_CUT_RECIPE_FORMAT||
     request.version!==MULTI_TARGET_CUT_RECIPE_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported version, unit or frame');
  const {model,runtime}=services??{};
  if(typeof model?.serializeProject!=='function'||
     typeof model?.featuresOf!=='function'||
     typeof runtime?.commit!=='function'||typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function')
    fail('accepted model and RUNTIME services required');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     history.document.projectId!==request.expectedProjectId||
     history.document.revision!==request.expectedRevision||
     model.serializeProject(history.document)!==request.expectedDocumentFence)
    fail('stale project, revision or canonical journal');
  id(request.expectedProjectId,'project ID');
  id(request.sourceBodyId,'source body');
  const cuts=request.sourceCutFeatureIds;
  if(!Array.isArray(cuts)||cuts.length<2||cuts.length>8||
     new Set(cuts).size!==cuts.length)fail('select 2–8 distinct ordered cuts');
  cuts.forEach(x=>id(x,'source cut ID'));
  if(!Array.isArray(request.targets)||request.targets.length<2||
     request.targets.length>4||request.targets.length*cuts.length>16)
    fail('select 2–4 distinct destination bodies and at most 16 total cuts');
  const bodies=new Set([request.sourceBodyId]);
  for(const t of request.targets){
    exact(t,['targetBodyId','targetAfterBodyWriterId'],'target');
    const body=id(t.targetBodyId,'target body');
    id(t.targetAfterBodyWriterId,'target terminal writer');
    if(bodies.has(body))fail('duplicate, aliased or source target body');
    bodies.add(body);
  }
  return {model,runtime};
}
function inventory(history,request,services){
  const rows=request.targets.map(t=>inspectCutRecipeCopy(history,{
    format:CUT_RECIPE_COPY_FORMAT,version:1,
    expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,
    expectedDocumentFence:request.expectedDocumentFence,
    units:'mm',frame:'local_xy',sourceBodyId:request.sourceBodyId,
    sourceCutFeatureIds:request.sourceCutFeatureIds,
    targetBodyId:t.targetBodyId,
    targetAfterBodyWriterId:t.targetAfterBodyWriterId,
  },services));
  if(!rows.every(x=>same(x.sourceCuts,rows[0].sourceCuts)&&
      same(x.sourceWriterOrder,rows[0].sourceWriterOrder)))
    fail('selected source lineage differs between target admissions');
  return rows;
}

/** Read-only WORKBENCH multi-target machining inspection; never reserves IDs. */
export function inspectMultiTargetCutRecipe(history,request,services){
  read(history,request,services,selectionFields);
  const rows=inventory(history,request,services);
  return {
    kind:'multi_target_recipe_inspection',
    format:MULTI_TARGET_CUT_RECIPE_FORMAT,version:1,
    projectId:request.expectedProjectId,revision:request.expectedRevision,
    documentFence:request.expectedDocumentFence,
    units:'mm',frame:'local_xy',sourceBodyId:request.sourceBodyId,
    sourceWriterOrder:rows[0].sourceWriterOrder,sourceCuts:rows[0].sourceCuts,
    targets:rows.map(x=>({targetBodyId:x.targetBodyId,
      targetAfterBodyWriterId:x.targetAfterBodyWriterId,
      targetWriterOrder:x.targetWriterOrder})),
    totalNewCuts:rows.length*rows[0].sourceCuts.length,
    providerStatus:'pending_exact_provider',
    exactAuthority:false,independentInteroperability:false,
  };
}

/**
 * Apply all target recipes atomically, not one undo frame per destination.
 * Each single-target planner executes on a disposable history and is
 * revalidated there with the current canonical revision and INTENT previews.
 * Only after every target succeeds are its *exact* admitted journal events
 * committed to the original history as ONE authoritative transaction.
 */
export function applyMultiTargetCutRecipe(history,request,services){
  const {model,runtime}=read(history,request,services,applicationFields);
  const current=inventory(history,request,services);
  if(!same(request.expectedSourceCuts,current[0].sourceCuts))
    fail('stale or misordered source-cut snapshot');
  const plans=request.targetPlans;
  if(!Array.isArray(plans)||plans.length!==request.targets.length)
    fail('one ordered plan required per target');
  const used=new Set([
    ...model.featuresOf(history.document).map(f=>f.id),
    ...model.featuresOf(history.document).flatMap(f=>f.writeTargets??[]),
    ...history.document.journal.map(e=>e.eventId),
  ]);
  const reserved=new Set();
  for(let i=0;i<plans.length;i++){
    const plan=plans[i],target=request.targets[i];
    if(!plain(plan)||!['copy','adapt'].includes(plan.mode))fail('invalid recipe mode');
    exact(plan,plan.mode==='copy'?
      ['mode','targetBodyId','targetAfterBodyWriterId','newCutFeatureIds','eventIds']:
      ['mode','targetBodyId','targetAfterBodyWriterId',
        'targetCuts','newCutFeatureIds','eventIds'],'target plan');
    if(plan.targetBodyId!==target.targetBodyId||
       plan.targetAfterBodyWriterId!==target.targetAfterBodyWriterId)
      fail('plan order or selected destination changed');
    if(!Array.isArray(plan.newCutFeatureIds)||!Array.isArray(plan.eventIds)||
       plan.newCutFeatureIds.length!==request.sourceCutFeatureIds.length||
       plan.eventIds.length!==request.sourceCutFeatureIds.length)
      fail('new cut and event IDs required for every target cut');
    for(const name of [...plan.newCutFeatureIds,...plan.eventIds]){
      id(name,'new semantic/event identity');
      if(used.has(name)||reserved.has(name))fail('occupied or duplicate semantic/event identity');
      reserved.add(name);
    }
    if(plan.mode==='adapt'&&(!Array.isArray(plan.targetCuts)||
       plan.targetCuts.length!==request.sourceCutFeatureIds.length))
      fail('explicit target source and extent required per adapted cut');
  }
  let staged=history;
  const allEvents=[],destinations=[];
  for(let i=0;i<plans.length;i++){
    const plan=plans[i];
    const selected={
      format:plan.mode==='copy'?CUT_RECIPE_COPY_FORMAT:ADAPTED_RECIPE_FORMAT,
      version:1,expectedProjectId:request.expectedProjectId,
      expectedRevision:staged.document.revision,
      expectedDocumentFence:model.serializeProject(staged.document),
      units:'mm',frame:'local_xy',sourceBodyId:request.sourceBodyId,
      sourceCutFeatureIds:request.sourceCutFeatureIds,
      targetBodyId:plan.targetBodyId,
      targetAfterBodyWriterId:plan.targetAfterBodyWriterId,
      expectedSourceCuts:current[0].sourceCuts,
      newCutFeatureIds:plan.newCutFeatureIds,eventIds:plan.eventIds,
    };
    if(plan.mode==='adapt')selected.targetCuts=plan.targetCuts;
    const offset=staged.document.journal.length;
    const result=plan.mode==='copy'?
      copyCutRecipeToBody(staged,selected,services):
      applyAdaptedCutRecipe(staged,selected,services);
    const events=result.history.document.journal.slice(offset);
    if(events.length!==plan.eventIds.length||
       !events.every((event,j)=>
         event.type==='feature.create'&&
         event.eventId===plan.eventIds[j]&&
         event.feature?.id===plan.newCutFeatureIds[j]&&
         event.feature?.payload?.targetBodyId===plan.targetBodyId))
      throw new Error('multi-target-cut-recipe: admitted journal delta differs from plan');
    allEvents.push(...events);
    destinations.push({
      mode:plan.mode,targetBodyId:plan.targetBodyId,
      targetWriterOrderBefore:current[i].targetWriterOrder,
      targetWriterOrderAfter:result.targetWriterOrderAfter,
      copiedCuts:result.copiedCuts,
    });
    staged=result.history;
  }
  const final=runtime.commit(history,allEvents,history.document.revision);
  if(final.document.revision!==history.document.revision+allEvents.length||
     final.undoStack.length!==history.undoStack.length+1||
     model.serializeProject(final.document)!==model.serializeProject(staged.document))
    throw new Error('multi-target-cut-recipe: atomic RUNTIME result differs from staged plan');
  const report=runtime.inspect(final);
  const actual=model.featuresOf(final.document);
  for(const dest of destinations)
    for(const cut of dest.copiedCuts){
      const f=actual.find(x=>x.id===cut.cutFeatureId);
      const row=report.features?.find(x=>x.featureId===cut.cutFeatureId);
      if(f?.kind!=='cut'||f.payload?.targetBodyId!==dest.targetBodyId||
         !['pending_exact_provider','blocked_dependency'].includes(row?.status))
        throw new Error('multi-target-cut-recipe: lost target identity or pending provider state');
      cut.status=row.status;
    }
  const invalidation=runtime.diff(history,final);
  if(!plans.every(p=>p.newCutFeatureIds.every(x=>
     invalidation.invalidatedFeatureIds?.includes(x)))||
     request.sourceCutFeatureIds.some(x=>invalidation.invalidatedFeatureIds?.includes(x)))
    throw new Error('multi-target-cut-recipe: source changed or target invalidation omitted');
  return {
    kind:'committed',history:final,report,invalidation,
    sourceBodyId:request.sourceBodyId,
    sourceWriterOrder:current[0].sourceWriterOrder,
    destinations,allEventIds:[...plans.flatMap(p=>p.eventIds)],
    oneUndoFrame:true,
    nativeHandoff:{
      kind:'runtime_evaluation_required',
      sourceRevision:final.document.revision,
      bodyIds:plans.map(x=>x.targetBodyId),
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false,
    },
    exactAuthority:false,independentInteroperability:false,
  };
}
