/**
 * Insert an existing two-to-eight-cut machining recipe inside another body's
 * established machining sequence in ONE durable undo frame.
 *
 * Compose accepted source-validated recipe copy and INTENT cut-block relocation
 * on disposable RUNTIME histories. The originating document is committed once
 * with exactly the admitted journal delta, never through two user undo frames.
 * This is semantic machining intent; no native Boolean or STEP claim.
 */
import {CUT_RECIPE_COPY_FORMAT,inspectCutRecipeCopy,copyCutRecipeToBody}
  from './cut-recipe-copy.mjs';
import {CUT_BLOCK_PLACEMENT_FORMAT,inspectCutBlockPlacement,moveCutBlock}
  from './cut-block-placement.mjs';

export const INTERIOR_RECIPE_INSERT_FORMAT='intuit3d.feature-ops.interior-recipe-insert';
export const INTERIOR_RECIPE_INSERT_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const baseFields=['format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','units','frame','sourceBodyId','sourceCutFeatureIds',
  'targetBodyId','targetAfterBodyWriterId','newCutFeatureIds','copyEventIds'];
const applyFields=[...baseFields,'expectedSourceCuts','expectedTargetWriterOrder',
  'insertAfterBodyWriterId','moveEventIds'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fail(reason){throw new TypeError('interior-recipe-insert: '+reason);}
function exact(x,keys,label){
  if(!plain(x)||Object.keys(x).length!==keys.length||
      keys.some(k=>!Object.hasOwn(x,k))||
      Object.keys(x).some(k=>!keys.includes(k)))
    fail('invalid '+label);
}
function ident(value,label){
  if(typeof value!=='string'||!ID.test(value))fail('invalid '+label);
  return value;
}
function stage(history,request,services,fields){
  exact(request,fields,'request');
  if(request.format!==INTERIOR_RECIPE_INSERT_FORMAT||
      request.version!==INTERIOR_RECIPE_INSERT_VERSION||
      request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported format, units or frame');
  const {model,runtime,block}=services??{};
  if(typeof model?.featuresOf!=='function'||
      typeof model?.serializeProject!=='function'||
      typeof runtime?.commit!=='function'||
      typeof runtime?.inspect!=='function'||
      typeof runtime?.diff!=='function'||
      typeof block?.inspectBodyCutBlockDestinations!=='function'||
      typeof block?.previewBodyCutBlockRelocate!=='function'||
      typeof block?.commitUndoableBodyCutBlockRelocate!=='function')
    fail('accepted INTENT block, MODEL and RUNTIME services required');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
      history.document.projectId!==request.expectedProjectId||
      history.document.revision!==request.expectedRevision||
      model.serializeProject(history.document)!==request.expectedDocumentFence)
    fail('stale project, revision or canonical archive');
  ident(request.expectedProjectId,'project ID');
  ident(request.sourceBodyId,'source body ID');
  ident(request.targetBodyId,'target body ID');
  ident(request.targetAfterBodyWriterId,'target terminal writer');
  if(request.sourceBodyId===request.targetBodyId)
    fail('a recipe insertion must target another explicitly selected body');
  const ids=request.sourceCutFeatureIds;
  if(!Array.isArray(ids)||ids.length<2||ids.length>8||
      new Set(ids).size!==ids.length)
    fail('select 2–8 distinct source machining cuts');
  ids.forEach(x=>ident(x,'source machining cut'));
  if(!Array.isArray(request.newCutFeatureIds)||
      !Array.isArray(request.copyEventIds)||
      request.newCutFeatureIds.length!==ids.length||
      request.copyEventIds.length!==ids.length)
    fail('every copied cut needs a fresh feature ID and event ID');
  const fresh=[...request.newCutFeatureIds,...request.copyEventIds];
  fresh.forEach(x=>ident(x,'new cut/event identity'));
  const features=model.featuresOf(history.document);
  const used=new Set([...features.map(f=>f.id),
    ...features.flatMap(f=>f.writeTargets??[]),
    ...history.document.journal.map(e=>e.eventId)]);
  if(new Set(fresh).size!==fresh.length||fresh.some(x=>used.has(x)))
    fail('duplicate or occupied copy feature/event ID');
  const selection={
    format:CUT_RECIPE_COPY_FORMAT,version:1,
    expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,
    expectedDocumentFence:request.expectedDocumentFence,
    units:'mm',frame:'local_xy',
    sourceBodyId:request.sourceBodyId,
    sourceCutFeatureIds:ids,
    targetBodyId:request.targetBodyId,
    targetAfterBodyWriterId:request.targetAfterBodyWriterId,
  };
  // Accepted source admission also rejects ambiguous source sketches, unsafe
  // writer chains, stale cut extents and mismatched target terminals.
  const source=inspectCutRecipeCopy(history,selection,services);
  if(source.targetWriterOrder.length<3)
    fail('interior insertion requires a pre-existing target cut before and after the anchor');
  if(fields===applyFields&&(!same(request.expectedSourceCuts,source.sourceCuts)||
      !same(request.expectedTargetWriterOrder,source.targetWriterOrder)))
    fail('source profiles or destination writer order changed since inspection');
  const copied=copyCutRecipeToBody(history,{
    ...selection,expectedSourceCuts:source.sourceCuts,
    newCutFeatureIds:request.newCutFeatureIds,
    eventIds:request.copyEventIds,
  },services);
  const staged=copied.history;
  const placementSelection={
    format:CUT_BLOCK_PLACEMENT_FORMAT,version:1,
    expectedProjectId:request.expectedProjectId,
    expectedRevision:staged.document.revision,
    expectedDocumentFence:model.serializeProject(staged.document),
    units:'mm',frame:'local_xy',
    targetBodyId:request.targetBodyId,
    cutFeatureIds:request.newCutFeatureIds,offset:0,limit:16,
  };
  const placement=inspectCutBlockPlacement(staged,placementSelection,services);
  if(placement.nextOffset!==null)
    fail('target writer chain exceeds bounded insertion inventory');
  if(!same(placement.writerOrder,[
      ...source.targetWriterOrder,...request.newCutFeatureIds]))
    fail('copied block is not a unique terminal machining sequence');
  return {source,copied,staged,placement,placementSelection,model,runtime,used,fresh};
}
/** Read-only, fully staged WORKBENCH insertion targets and event counts. */
export function inspectInteriorRecipeInsertion(history,request,services){
  const x=stage(history,request,services,baseFields);
  return {
    format:INTERIOR_RECIPE_INSERT_FORMAT,version:1,
    kind:'interior_recipe_insertion_inspection',
    projectId:request.expectedProjectId,revision:request.expectedRevision,
    documentFence:request.expectedDocumentFence,
    sourceBodyId:request.sourceBodyId,targetBodyId:request.targetBodyId,
    sourceCuts:x.source.sourceCuts,
    sourceWriterOrder:x.source.sourceWriterOrder,
    targetWriterOrder:x.source.targetWriterOrder,
    insertionDestinations:x.placement.destinations,
    newCutFeatureIds:[...request.newCutFeatureIds],
    units:'mm',frame:'local_xy',
    providerStatus:'pending_exact_provider',
    exactAuthority:false,independentInteroperability:false,
  };
}
/**
 * Commit source recipe copying followed by an accepted, dependency-safe
 * physical writer-order insertion as ONE canonical MODEL/RUNTIME transaction.
 * No mutation reaches the original history if either plan fails.
 */
export function applyInteriorRecipeInsertion(history,request,services){
  const x=stage(history,request,services,applyFields);
  ident(request.insertAfterBodyWriterId,'insertion anchor');
  const anchor=x.placement.destinations.find(d=>
    d.afterBodyWriterId===request.insertAfterBodyWriterId);
  if(!anchor||anchor.eligibility!=='available'||
      !x.source.targetWriterOrder.includes(request.insertAfterBodyWriterId)||
      request.insertAfterBodyWriterId===x.source.targetWriterOrder.at(-1))
    fail('no admissible interior destination selected');
  if(!Array.isArray(request.moveEventIds)||
      request.moveEventIds.length!==anchor.requiredEventIds||
      ![2,3].includes(request.moveEventIds.length))
    fail('exact INTENT insertion event count required');
  const moving=[...request.moveEventIds];
  moving.forEach(x=>ident(x,'move journal event ID'));
  if(new Set(moving).size!==moving.length||
      moving.some(id=>x.used.has(id)||x.fresh.includes(id)))
    fail('duplicate or occupied move journal event ID');
  const {offset,limit,...selection}=x.placementSelection;
  const relocated=moveCutBlock(x.staged,{
    ...selection,
    afterBodyWriterId:request.insertAfterBodyWriterId,
    expectedWriterOrder:x.placement.writerOrder,
    expectedCutSelections:x.placement.cutSelections,
    eventIds:moving,
  },services);
  const originalJournal=history.document.journal;
  const candidateJournal=relocated.history.document.journal;
  if(!same(candidateJournal.slice(0,originalJournal.length),originalJournal))
    throw new Error('interior-recipe-insert: staged transaction modified historical journal');
  const events=candidateJournal.slice(originalJournal.length);
  if(events.length!==request.copyEventIds.length+moving.length||
      !same(events.map(e=>e.eventId),[...request.copyEventIds,...moving]))
    throw new Error('interior-recipe-insert: staged journal diverged from selected IDs');
  const committed=x.runtime.commit(history,events,history.document.revision);
  if(committed.undoStack.length!==history.undoStack.length+1||
      committed.document.revision!==history.document.revision+events.length||
      x.model.serializeProject(committed.document)!==
        x.model.serializeProject(relocated.history.document))
    throw new Error('interior-recipe-insert: single-frame commit differs from admission');
  const expected=[...x.source.targetWriterOrder];
  const anchorIndex=expected.indexOf(request.insertAfterBodyWriterId);
  expected.splice(anchorIndex+1,0,...request.newCutFeatureIds);
  if(!same(relocated.writerOrderAfter,expected))
    throw new Error('interior-recipe-insert: unexpected inserted cut order');
  const before=new Map(x.model.featuresOf(history.document).map(f=>[f.id,f]));
  const after=new Map(x.model.featuresOf(committed.document).map(f=>[f.id,f]));
  if(request.sourceCutFeatureIds.some(id=>!same(before.get(id),after.get(id))))
    throw new Error('interior-recipe-insert: source cuts changed');
  const report=x.runtime.inspect(committed);
  const insertedCuts=request.newCutFeatureIds.map((cutFeatureId,i)=>{
    const f=after.get(cutFeatureId);
    const status=report.features?.find(row=>row.featureId===cutFeatureId)?.status;
    if(f?.kind!=='cut'||f.payload?.targetBodyId!==request.targetBodyId||
        f.payload?.sourceSketchId!==x.source.sourceCuts[i].sourceSketchId||
        !['pending_exact_provider','blocked_dependency'].includes(status))
      throw new Error('interior-recipe-insert: copied cut lost target/source/provider state');
    return {sourceCutFeatureId:request.sourceCutFeatureIds[i],
      cutFeatureId,sourceSketchId:f.payload.sourceSketchId,status};
  });
  const invalidation=x.runtime.diff(history,committed);
  if(!request.newCutFeatureIds.every(id=>
      invalidation.invalidatedFeatureIds?.includes(id))||
      request.sourceCutFeatureIds.some(id=>
        invalidation.invalidatedFeatureIds?.includes(id)))
    throw new Error('interior-recipe-insert: copied source or target invalidation mismatch');
  return {
    kind:'committed',history:committed,report,invalidation,
    sourceBodyId:request.sourceBodyId,targetBodyId:request.targetBodyId,
    insertedCuts,writerOrderBefore:x.source.targetWriterOrder,
    writerOrderAfter:relocated.writerOrderAfter,
    rewiredWriterIds:relocated.rewiredWriterIds,
    invalidatedBodyIds:relocated.invalidatedBodyIds,
    eventIds:events.map(e=>e.eventId),oneUndoFrame:true,
    nativeHandoff:{
      kind:'runtime_evaluation_required',bodyId:request.targetBodyId,
      sourceRevision:committed.document.revision,
      orderedWriterIds:relocated.writerOrderAfter,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false,
    },
    exactAuthority:false,independentInteroperability:false,
  };
}
