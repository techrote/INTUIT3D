/**
 * FEATUREOPS cut-recipe-copy/v1: reproduce a selected ordered machining recipe
 * on another explicitly named body. SKETCH profiles remain shared, never
 * silently cloned or transformed. INTENT checks every sequential append and
 * RUNTIME commits all events as ONE undoable journal frame.
 * No native Boolean, assembly placement or STEP authority is implied.
 */
export const CUT_RECIPE_COPY_FORMAT = 'intuit3d.feature-ops.cut-recipe-copy';
export const CUT_RECIPE_COPY_VERSION = 1;
const IDENT = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const isPlain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const same = (a,b) => Array.isArray(a) && Array.isArray(b) &&
  a.length === b.length && a.every((v,i) => v === b[i]);
function fail(message) { throw new TypeError('feature-ops cut recipe copy: ' + message); }
function exact(x, fields, label) {
  if (!isPlain(x) || Object.keys(x).length !== fields.length ||
      fields.some(f => !Object.hasOwn(x,f)) || Object.keys(x).some(k => !fields.includes(k)))
    fail('invalid ' + label);
}
function id(x,label) {
  if (typeof x !== 'string' || !IDENT.test(x)) fail('invalid ' + label);
  return x;
}
function status(report,featureId) {
  return report.features?.find(row => row.featureId === featureId);
}
const baseFields = [
  'format','version','expectedProjectId','expectedRevision','expectedDocumentFence',
  'units','frame','sourceBodyId','targetBodyId','sourceCutFeatureIds',
  'targetAfterBodyWriterId',
];
function servicesOf(services) {
  const {model,runtime,sketch,discovery,cutChain} = services ?? {};
  if (typeof model?.featuresOf !== 'function' ||
      typeof model?.serializeProject !== 'function' ||
      typeof runtime?.inspect !== 'function' ||
      typeof runtime?.commit !== 'function' ||
      typeof runtime?.diff !== 'function' ||
      typeof sketch?.validateSketch !== 'function' ||
      typeof discovery?.discoverPlateProfiles !== 'function' ||
      typeof discovery?.admitDiscoveredPlateProfile !== 'function' ||
      typeof cutChain?.inspectBodyCutChain !== 'function' ||
      typeof cutChain?.previewBodyCutAppend !== 'function')
    fail('accepted INTENT, SKETCH and RUNTIME authorities required');
  return {model,runtime,sketch,discovery,cutChain};
}
function prepare(history,request,services,fields) {
  exact(request,fields,'request');
  if (request.format !== CUT_RECIPE_COPY_FORMAT || request.version !== 1 ||
      request.units !== 'mm' || request.frame !== 'local_xy')
    fail('unsupported version or mm/local_xy frame');
  const sourceBodyId = id(request.sourceBodyId,'sourceBodyId');
  const targetBodyId = id(request.targetBodyId,'targetBodyId');
  const terminal = id(request.targetAfterBodyWriterId,'targetAfterBodyWriterId');
  if (sourceBodyId === targetBodyId) fail('source and target body must differ');
  if (!Number.isSafeInteger(request.expectedRevision) ||
      id(request.expectedProjectId,'expectedProjectId') !== history?.document?.projectId ||
      request.expectedRevision !== history.document.revision)
    throw new Error('feature-ops cut recipe copy: stale project/revision');
  const s = servicesOf(services), doc = history.document;
  if (typeof request.expectedDocumentFence !== 'string' ||
      request.expectedDocumentFence !== s.model.serializeProject(doc))
    fail('stale canonical project snapshot');
  const ids = request.sourceCutFeatureIds;
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 8 ||
      new Set(ids).size !== ids.length) fail('select 2–8 distinct ordered source cuts');
  ids.forEach(v=>id(v,'source cut ID'));
  const sourceChain=s.cutChain.inspectBodyCutChain(doc,sourceBodyId);
  const targetChain=s.cutChain.inspectBodyCutChain(doc,targetBodyId);
  if (sourceChain?.status !== 'ready' || targetChain?.status !== 'ready' ||
      sourceChain.projectId !== doc.projectId || targetChain.projectId !== doc.projectId ||
      sourceChain.revision !== doc.revision || targetChain.revision !== doc.revision ||
      targetChain.eligibleAfterWriterId !== terminal)
    fail('source or target body has no unique selected terminal');
  const writers=sourceChain.bodyWriterIds;
  // A selected contiguous source block is portable even when later source
  // cuts exist: their history and body dependencies are not changed. Each
  // copied cut receives a NEW predecessor on the explicitly targeted body.
  const first=writers.indexOf(ids[0]);
  if(first<1||first+ids.length>writers.length||
     !same(writers.slice(first,first+ids.length),ids)||
     targetChain.bodyWriterIds.includes(ids[0]))
    fail('source selection must be a contiguous ordered cut block after its base writer');
  const byId=new Map(s.model.featuresOf(doc).map(f=>[f.id,f]));
  const before=s.runtime.inspect(history), cache=new Map();
  const sourceCuts=ids.map((cutFeatureId,i)=>{
    const f=byId.get(cutFeatureId), previous=writers[first+i-1];
    if (f?.kind !== 'cut' || !same(f.writeTargets,[sourceBodyId]) ||
        f.payload?.targetBodyId !== sourceBodyId ||
        f.payload?.units !== 'mm' || f.payload?.frame !== 'local_xy' ||
        !same(f.dependsOn,[previous,f.payload.sourceSketchId]))
      fail('source cut has nonportable body/topology dependencies: ' + cutFeatureId);
    const p=f.payload;
    if (Object.keys(p).some(k=>!['sourceSketchId','targetBodyId','profileCandidateId',
        'units','frame','throughAll','depthMm'].includes(k)))
      fail('source cut carries provider/placement-specific payload');
    const sketchId=id(p.sourceSketchId,'sourceSketchId');
    if (typeof p.profileCandidateId !== 'string' ||
        !p.profileCandidateId.startsWith('cycle:') || p.profileCandidateId.length > 8192)
      fail('missing source profile selection');
    const extent=p.throughAll === true && !Object.hasOwn(p,'depthMm')
      ?{kind:'through_all'}
      :p.throughAll === false && Number.isFinite(p.depthMm) && p.depthMm>0
        ?{kind:'blind',depthMm:p.depthMm}:null;
    if (!extent) fail('source cut has ambiguous machining extent');
    if (!['pending_exact_provider','blocked_dependency'].includes(status(before,cutFeatureId)?.status))
      fail('source cut is not an admitted, pending machinable operation');
    const key=JSON.stringify([sketchId,p.profileCandidateId]);
    if (!cache.has(key)) {
      const feature=byId.get(sketchId);
      if (feature?.kind !== 'sketch' || !feature.payload?.sketch ||
          !same(feature.writeTargets,[])) fail('source SKETCH unavailable');
      const authored=s.sketch.validateSketch(feature.payload.sketch);
      const found=s.discovery.discoverPlateProfiles(authored);
      if (found.status !== 'ready' || found.candidates?.length !== 1 ||
          found.candidates[0].id !== p.profileCandidateId)
        fail('selected SKETCH profile is missing, stale or ambiguous');
      const admitted=s.discovery.admitDiscoveredPlateProfile(authored,found,p.profileCandidateId);
      const actual=status(before,sketchId);
      if (actual?.status !== 'analytic_profile_only' ||
          actual.profile?.status !== 'analytic_profile_only' ||
          !equal(actual.profile,admitted))
        fail('SKETCH source differs from RUNTIME-admitted current profile');
      cache.set(key,true);
    }
    return {sourceCutFeatureId:cutFeatureId,sourceSketchId:sketchId,
      profileCandidateId:p.profileCandidateId,extent};
  });
  const targetWriter=byId.get(terminal);
  if (!targetWriter || !['extrude','cut'].includes(targetWriter.kind) ||
      !same(targetWriter.writeTargets,[targetBodyId]) ||
      (targetWriter.kind === 'cut' && targetWriter.payload.targetBodyId !== targetBodyId))
    fail('target terminal is not a body writer');
  const targetStatus=status(before,terminal)?.status;
  if (targetWriter.kind === 'extrude' ? targetStatus !== 'preview_only' :
      !['pending_exact_provider','blocked_dependency'].includes(targetStatus))
    fail('target terminal cannot accept new machining intent');
  return {s,doc,sourceChain,targetChain,sourceCuts,before};
}
/** Read-only snapshot for a browser's Copy machining recipe action. */
export function inspectCutRecipeCopy(history,request,services) {
  const p=prepare(history,request,services,baseFields);
  return {format:CUT_RECIPE_COPY_FORMAT,version:1,kind:'copy_inspection',
    projectId:p.doc.projectId,revision:p.doc.revision,
    documentFence:request.expectedDocumentFence,
    units:'mm',frame:'local_xy',sourceBodyId:request.sourceBodyId,
    targetBodyId:request.targetBodyId,
    sourceWriterOrder:p.sourceChain.bodyWriterIds,
    targetWriterOrder:p.targetChain.bodyWriterIds,
    targetAfterBodyWriterId:request.targetAfterBodyWriterId,
    sourceCuts:p.sourceCuts,
    copySemantics:'shared_authoritative_sketch_sources',
    providerStatus:'pending_exact_provider',
    exactAuthority:false,independentInteroperability:false};
}
/**
 * Copy a contiguous source machining block to a different explicit body.
 * Stage each append on a disposable journal to use INTENT's per-cut preview;
 * only after all previews pass commit the same events against original history
 * in ONE RUNTIME transaction. A bad second cut cannot partially persist.
 */
export function copyCutRecipeToBody(history,request,services) {
  const p=prepare(history,request,services,[...baseFields,
    'expectedSourceCuts','newCutFeatureIds','eventIds']);
  const {s,doc,sourceCuts}=p;
  if (!equal(request.expectedSourceCuts,sourceCuts)) fail('stale source cut selection');
  const fresh=request.newCutFeatureIds,eventsIds=request.eventIds;
  if (!Array.isArray(fresh)||!Array.isArray(eventsIds)||
      fresh.length!==sourceCuts.length||eventsIds.length!==sourceCuts.length)
    fail('one new feature and event ID required per source cut');
  const existing=s.model.featuresOf(doc), occupied=new Set([
    ...existing.map(f=>f.id),...existing.flatMap(f=>f.writeTargets ?? []),
  ]);
  const all=[...fresh,...eventsIds];
  if (new Set(all).size !== all.length || all.some(x=>occupied.has(x)))
    fail('duplicate or occupied new semantic/event identity');
  all.forEach(v=>id(v,'new semantic/event ID'));
  let staged=history, predecessor=request.targetAfterBodyWriterId;
  const events=[];
  for (const [i,cut] of sourceCuts.entries()) {
    const expectedRevision=staged.document.revision;
    const preview=s.cutChain.previewBodyCutAppend(staged.document,{
      format:'intuit3d.body-cut-chain',version:1,
      expectedProjectId:doc.projectId,expectedRevision,
      eventId:eventsIds[i],cutFeatureId:fresh[i],targetBodyId:request.targetBodyId,
      afterBodyWriterId:predecessor,sourceSketchId:cut.sourceSketchId,
      profileCandidateId:cut.profileCandidateId,extent:cut.extent,
      admission:'require_ready',
    });
    const newFeature=preview?.event?.feature;
    if (preview.semanticStatus !== 'ready' || preview.requiresNativeRebuild !== true ||
        preview.exactGeometryAuthority !== false ||
        preview.event?.type !== 'feature.create' ||
        preview.event.eventId !== eventsIds[i] ||
        newFeature?.id !== fresh[i] || newFeature?.kind !== 'cut' ||
        !same(newFeature.writeTargets,[request.targetBodyId]) ||
        newFeature.payload?.sourceSketchId !== cut.sourceSketchId ||
        newFeature.payload?.profileCandidateId !== cut.profileCandidateId ||
        newFeature.payload?.targetBodyId !== request.targetBodyId ||
        !same(newFeature.dependsOn,[predecessor,cut.sourceSketchId]))
      fail('INTENT did not stage the selected source recipe faithfully');
    events.push(preview.event);
    staged=s.runtime.commit(staged,[preview.event],expectedRevision);
    predecessor=fresh[i];
  }
  const next=s.runtime.commit(history,events,doc.revision);
  if (next.document.revision !== doc.revision+events.length ||
      next.undoStack.length !== history.undoStack.length+1 ||
      s.model.serializeProject(next.document) !==
        s.model.serializeProject(staged.document))
    throw new Error('feature-ops cut recipe copy: atomic commit differs from admitted plan');
  const actual=s.model.featuresOf(next.document),report=s.runtime.inspect(next);
  const statuses=sourceCuts.map((cut,i)=>{
    const f=actual.find(x=>x.id===fresh[i]), row=status(report,fresh[i]);
    if (!f || f.kind !== 'cut' || !same(f.writeTargets,[request.targetBodyId]) ||
        f.payload?.sourceSketchId !== cut.sourceSketchId ||
        f.payload?.profileCandidateId !== cut.profileCandidateId ||
        f.payload?.targetBodyId !== request.targetBodyId ||
        !['pending_exact_provider','blocked_dependency'].includes(row?.status))
      throw new Error('feature-ops cut recipe copy: lost target, source or pending provider state');
    return {sourceCutFeatureId:cut.sourceCutFeatureId,cutFeatureId:fresh[i],
      targetBodyId:request.targetBodyId,status:row.status,extent:cut.extent};
  });
  const invalidation=s.runtime.diff(history,next);
  if (!fresh.every(x=>invalidation.invalidatedFeatureIds?.includes(x)))
    throw new Error('feature-ops cut recipe copy: missing new-cut invalidation');
  return {kind:'committed',history:next,report,invalidation,
    copiedCuts:statuses,sourceBodyId:request.sourceBodyId,
    targetBodyId:request.targetBodyId,
    targetWriterOrderBefore:p.targetChain.bodyWriterIds,
    targetWriterOrderAfter:[...p.targetChain.bodyWriterIds,...fresh],
    eventIds:[...eventsIds],oneUndoFrame:true,
    copySemantics:'shared_authoritative_sketch_sources',
    nativeHandoff:{kind:'runtime_evaluation_required',bodyId:request.targetBodyId,
      sourceRevision:next.document.revision,orderedCutFeatureIds:[...fresh],
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}