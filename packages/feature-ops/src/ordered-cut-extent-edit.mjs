/**
 * FEATUREOPS ordered-cut-extent-edit/v1.
 *
 * Change the authored depth/through-all mode of an existing explicit cut,
 * including a nonterminal pocket in a dependent chain. INTENT owns validation,
 * speculative journal preview and invalidation; SKETCH owns selected profile
 * admission; RUNTIME owns transaction and current evaluation status.
 * No B-rep, Boolean or STEP authority is established by this command.
 */
export const ORDERED_CUT_EXTENT_EDIT_FORMAT =
  'intuit3d.feature-ops.ordered-cut-extent-edit';
export const ORDERED_CUT_EXTENT_EDIT_VERSION = 1;

const IDENT = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain = x => x !== null && typeof x === 'object' &&
  !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype ||
    Object.getPrototypeOf(x) === null);
const fail = message => { throw new TypeError('feature-ops pocket edit: '+message); };
function exact(value, fields, label) {
  if (!plain(value) || Object.keys(value).length !== fields.length ||
      fields.some(field => !Object.hasOwn(value,field)) ||
      Object.keys(value).some(key => !fields.includes(key)))
    fail('invalid '+label);
}
function id(value, label) {
  if (typeof value !== 'string' || !IDENT.test(value)) fail('invalid '+label);
  return value;
}
function extent(value, label) {
  exact(value,value?.kind === 'blind' ? ['kind','depthMm'] : ['kind'],label);
  if (value.kind === 'through_all') return;
  if (value.kind !== 'blind' || typeof value.depthMm !== 'number' ||
      !Number.isFinite(value.depthMm) || value.depthMm <= 0)
    fail('positive finite blind depth required for '+label);
}
const same = (a,b) => Array.isArray(a) && a.length === b.length &&
  a.every((v,i) => v === b[i]);
const featureState = (report,id) => report.features?.find(row => row.featureId === id);

/**
 * Retrospectively revise an existing ordered cut, including a nonterminal one.
 * The original body, direct predecessor, sketch, profile and extent are
 * expected-value fences, not inferred UI selections. The source is re-admitted
 * through real SKETCH + RUNTIME prior to a one-event authoritative edit.
 *
 * Reuse INTENT's body-cut-extent-edit preview; never synthesize its own journal
 * patch or claim a native operation. Downstream cuts keep their identities and
 * their dependency order, but their previous geometry evidence is invalid.
 */
export function reconfigureOrderedCutExtent(history,request,services) {
  exact(request,['format','version','expectedProjectId','expectedRevision',
    'eventId','units','frame','cutFeatureId','targetBodyId','from','toExtent'],'request');
  if (request.format !== ORDERED_CUT_EXTENT_EDIT_FORMAT ||
      request.version !== ORDERED_CUT_EXTENT_EDIT_VERSION ||
      request.units !== 'mm' || request.frame !== 'local_xy')
    fail('unsupported format/version or coordinate frame');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision !== history.document.revision ||
      request.expectedProjectId !== history.document.projectId)
    throw new Error('feature-ops pocket edit: stale project or revision');
  exact(request.from,['afterBodyWriterId','sourceSketchId',
    'profileCandidateId','extent'],'from selection');
  const cutId = id(request.cutFeatureId,'cutFeatureId');
  const bodyId = id(request.targetBodyId,'targetBodyId');
  const sketchId = id(request.from.sourceSketchId,'from.sourceSketchId');
  const predecessorId = id(request.from.afterBodyWriterId,'from.afterBodyWriterId');
  const eventId = id(request.eventId,'eventId');
  if (new Set([cutId,bodyId,sketchId,predecessorId]).size !== 4)
    fail('aliased cut, body, sketch or predecessor');
  if (typeof request.from.profileCandidateId !== 'string' ||
      !request.from.profileCandidateId.startsWith('cycle:') ||
      request.from.profileCandidateId.length > 8192)
    fail('explicit canonical SKETCH profile required');
  extent(request.from.extent,'from.extent');
  extent(request.toExtent,'toExtent');
  if (JSON.stringify(request.from.extent) === JSON.stringify(request.toExtent))
    fail('no-op pocket edit');
  const {runtime,model,sketch,discovery,cutChain} = services ?? {};
  if (typeof runtime?.commit !== 'function' ||
      typeof runtime?.inspect !== 'function' ||
      typeof runtime?.diff !== 'function' ||
      typeof model?.featuresOf !== 'function' ||
      typeof sketch?.validateSketch !== 'function' ||
      typeof discovery?.discoverPlateProfiles !== 'function' ||
      typeof discovery?.admitDiscoveredPlateProfile !== 'function' ||
      typeof cutChain?.inspectBodyCutChain !== 'function' ||
      typeof cutChain?.inspectBodyCutExtent !== 'function' ||
      typeof cutChain?.previewBodyCutExtentEdit !== 'function')
    fail('accepted INTENT/SKETCH/RUNTIME services required');

  const features = model.featuresOf(history.document);
  const byId = new Map(features.map(feature => [feature.id,feature]));
  const cut = byId.get(cutId);
  const source = byId.get(sketchId);
  const predecessor = byId.get(predecessorId);
  if (cut?.kind !== 'cut' || !same(cut.writeTargets,[bodyId]) ||
      !same(cut.dependsOn,[predecessorId,sketchId]) ||
      cut.payload?.sourceSketchId !== sketchId ||
      cut.payload?.targetBodyId !== bodyId ||
      cut.payload?.profileCandidateId !== request.from.profileCandidateId ||
      cut.payload?.units !== 'mm' || cut.payload?.frame !== 'local_xy')
    fail('selected cut lineage, body or profile changed');
  if (source?.kind !== 'sketch' || !source.payload?.sketch ||
      !same(source.writeTargets,[]))
    fail('selected sketch no longer exists as an authored SKETCH');
  if (!predecessor || !['extrude','cut'].includes(predecessor.kind) ||
      !same(predecessor.writeTargets,[bodyId]) ||
      (predecessor.kind === 'cut' && predecessor.payload?.targetBodyId !== bodyId))
    fail('selected predecessor is not a writer of the body');
  const chain = cutChain.inspectBodyCutChain(history.document,bodyId);
  if (chain?.status !== 'ready' || !chain.bodyWriterIds?.includes(cutId) ||
      !chain.bodyWriterIds?.includes(predecessorId))
    fail('body has ambiguous, unordered or unsupported writers');
  const inspected = cutChain.inspectBodyCutExtent(history.document,cutId,bodyId);
  if (inspected?.projectId !== request.expectedProjectId ||
      inspected.revision !== request.expectedRevision ||
      JSON.stringify(inspected.extent) !== JSON.stringify(request.from.extent) ||
      inspected.semanticStatus !== 'ready')
    fail('original authored cut extent is stale or unresolved');

  const authored = sketch.validateSketch(source.payload.sketch);
  const selected = discovery.discoverPlateProfiles(authored);
  if (selected.status !== 'ready' || selected.candidates?.length !== 1 ||
      selected.candidates[0].id !== request.from.profileCandidateId)
    fail('selected SKETCH profile is ambiguous or has changed');
  const admitted = discovery.admitDiscoveredPlateProfile(authored,selected,
    request.from.profileCandidateId);
  const before = runtime.inspect(history);
  const sourceState = featureState(before,sketchId);
  if (sourceState?.status !== 'analytic_profile_only' ||
      sourceState.profile?.status !== 'analytic_profile_only' ||
      JSON.stringify(sourceState.profile) !== JSON.stringify(admitted))
    fail('current RUNTIME sketch profile was not admitted');
  const currentStatus = featureState(before,cutId)?.status;
  if (currentStatus !== 'pending_exact_provider' &&
      currentStatus !== 'blocked_dependency')
    fail('cut is not a recoverable pending native operation');

  const staged = cutChain.previewBodyCutExtentEdit(history.document,{
    format:'intuit3d.body-cut-extent-edit',version:1,
    expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,eventId,
    cutFeatureId:cutId,targetBodyId:bodyId,
    fromExtent:request.from.extent,toExtent:request.toExtent,
    admission:'require_ready'
  });
  if (staged?.semanticStatus !== 'ready' ||
      staged.event?.type !== 'feature.edit' ||
      staged.event.featureId !== cutId || staged.event.eventId !== eventId ||
      staged.event.patch?.payload?.sourceSketchId !== sketchId ||
      staged.event.patch?.payload?.targetBodyId !== bodyId ||
      staged.event.patch?.payload?.profileCandidateId !== request.from.profileCandidateId ||
      staged.event.patch?.payload?.throughAll !==
        (request.toExtent.kind === 'through_all') ||
      (request.toExtent.kind === 'blind' ?
        staged.event.patch.payload.depthMm !== request.toExtent.depthMm :
        Object.hasOwn(staged.event.patch.payload,'depthMm')))
    fail('INTENT returned a mismatched or inadmissible extent preview');

  const next = runtime.commit(history,[staged.event],request.expectedRevision);
  const updated = model.featuresOf(next.document).find(f => f.id === cutId);
  if (next.document.revision !== request.expectedRevision+1 ||
      updated?.kind !== 'cut' || !same(updated.dependsOn,cut.dependsOn) ||
      !same(updated.writeTargets,cut.writeTargets) ||
      updated.payload.sourceSketchId !== sketchId ||
      updated.payload.targetBodyId !== bodyId ||
      updated.payload.profileCandidateId !== request.from.profileCandidateId ||
      updated.payload.throughAll !== (request.toExtent.kind === 'through_all') ||
      (request.toExtent.kind === 'blind' ?
        updated.payload.depthMm !== request.toExtent.depthMm :
        Object.hasOwn(updated.payload,'depthMm')))
    throw new Error('feature-ops pocket edit: committed cut lost identity or extent');
  const report = runtime.inspect(next);
  const nextStatus = featureState(report,cutId)?.status;
  if (nextStatus !== 'pending_exact_provider' && nextStatus !== 'blocked_dependency')
    throw new Error('feature-ops pocket edit: unexpected native authority status');
  const invalidation = runtime.diff(history,next);
  if (!invalidation?.invalidatedFeatureIds?.includes(cutId))
    throw new Error('feature-ops pocket edit: edited cut not invalidated');
  return {
    kind:'committed',history:next,report,invalidation,
    semanticIds:{cutId,bodyId,sketchId,predecessorId},
    previousExtent:request.from.extent,nextExtent:request.toExtent,
    semanticStatus:'ready',status:nextStatus,
    nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:cutId,
      bodyId,sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false
  };
}
