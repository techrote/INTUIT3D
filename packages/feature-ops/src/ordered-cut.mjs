/**
 * FEATUREOPS ordered-cut/v1 — extend a named body's explicitly ordered cut
 * chain, with SKETCH/RUNTIME re-admission. INTENT owns chain admissibility and
 * journal preview; RUNTIME owns commit/evaluation. This is not a Boolean.
 */
export const ORDERED_CUT_FORMAT = 'intuit3d.feature-ops.ordered-cut';
export const ORDERED_CUT_VERSION = 1;
const IDENT = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const own = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function fail(reason) { throw new TypeError('feature-ops ordered-cut: ' + reason); }
function exact(value, keys, label) {
  if (!own(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key))) fail('invalid ' + label);
}
function id(value, label) {
  if (typeof value !== 'string' || !IDENT.test(value)) fail('invalid ' + label);
  return value;
}
const state = (report, featureId) => report.features?.find(entry => entry.featureId === featureId);

/**
 * Add one explicit through-all or blind cut after the uniquely ready terminal
 * body writer. Different source SKETCH profiles are allowed but must be
 * independently selected and re-admitted. A prior cut may be pending exact
 * geometry: the new cut then remains blocked_dependency, not fabricated ready.
 */
export function appendOrderedProfileCut(history, request, services) {
  exact(request, ['format','version','expectedProjectId','expectedRevision',
    'eventId','units','frame','sourceSketchId','profileCandidateId',
    'afterBodyWriterId','targetBodyId','cutFeatureId','extent'], 'request');
  if (request.format !== ORDERED_CUT_FORMAT || request.version !== ORDERED_CUT_VERSION ||
      request.units !== 'mm' || request.frame !== 'local_xy')
    fail('unsupported version or local_xy millimetre frame');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision !== history.document.revision ||
      request.expectedProjectId !== history.document.projectId)
    throw new Error('feature-ops ordered-cut: stale project/revision');
  const eventId = id(request.eventId, 'eventId');
  const sketchId = id(request.sourceSketchId, 'sourceSketchId');
  const afterId = id(request.afterBodyWriterId, 'afterBodyWriterId');
  const bodyId = id(request.targetBodyId, 'targetBodyId');
  const cutId = id(request.cutFeatureId, 'cutFeatureId');
  if (new Set([sketchId, afterId, bodyId, cutId]).size !== 4)
    fail('aliased sketch, predecessor, cut or target body');
  if (typeof request.profileCandidateId !== 'string' ||
      !request.profileCandidateId.startsWith('cycle:') ||
      request.profileCandidateId.length > 8192)
    fail('explicit SKETCH semantic profile required');
  exact(request.extent, request.extent?.kind === 'blind' ?
    ['kind','depthMm'] : ['kind'], 'cut extent');
  if (!(request.extent.kind === 'through_all' ||
      (request.extent.kind === 'blind' && typeof request.extent.depthMm === 'number' &&
       Number.isFinite(request.extent.depthMm) && request.extent.depthMm > 0)))
    fail('positive blind depth or through_all extent required');
  const {runtime, model, sketch, discovery, cutChain} = services ?? {};
  if (typeof runtime?.commit !== 'function' || typeof runtime?.inspect !== 'function' ||
      typeof runtime?.diff !== 'function' || typeof model?.featuresOf !== 'function' ||
      typeof sketch?.validateSketch !== 'function' ||
      typeof discovery?.discoverPlateProfiles !== 'function' ||
      typeof discovery?.admitDiscoveredPlateProfile !== 'function' ||
      typeof cutChain?.inspectBodyCutChain !== 'function' ||
      typeof cutChain?.previewBodyCutAppend !== 'function')
    fail('accepted INTENT body-cut-chain, SKETCH and RUNTIME required');
  const features = model.featuresOf(history.document);
  const byId = new Map(features.map(feature => [feature.id, feature]));
  if (byId.has(cutId)) fail('cut identity already exists');
  const source = byId.get(sketchId);
  if (source?.kind !== 'sketch' || !source.payload?.sketch ||
      source.writeTargets?.length !== 0)
    fail('selected authored SKETCH feature required');
  const preceding = byId.get(afterId);
  if (!preceding || !['extrude','cut'].includes(preceding.kind) ||
      preceding.writeTargets?.length !== 1 ||
      preceding.writeTargets[0] !== bodyId ||
      (preceding.kind === 'cut' && preceding.payload?.targetBodyId !== bodyId))
    fail('explicit previous writer must target exactly the selected body');
  const chain = cutChain.inspectBodyCutChain(history.document, bodyId);
  if (chain?.status !== 'ready' || chain.eligibleAfterWriterId !== afterId)
    fail('previous writer is not the unique dependency-ordered body terminal');
  const authored = sketch.validateSketch(source.payload.sketch);
  const proposed = discovery.discoverPlateProfiles(authored);
  if (proposed.status !== 'ready' || proposed.candidates?.length !== 1 ||
      proposed.candidates[0].id !== request.profileCandidateId)
    fail('stale, missing or ambiguous selected SKETCH profile');
  const admitted = discovery.admitDiscoveredPlateProfile(authored, proposed,
    request.profileCandidateId);
  const before = runtime.inspect(history);
  const sketchState = state(before, sketchId);
  if (sketchState?.status !== 'analytic_profile_only' ||
      sketchState.profile?.status !== 'analytic_profile_only' ||
      JSON.stringify(sketchState.profile) !== JSON.stringify(admitted))
    fail('RUNTIME has not admitted current selected profile');
  const previousState = state(before, afterId)?.status;
  if (preceding.kind === 'extrude' ? previousState !== 'preview_only' :
      previousState !== 'pending_exact_provider' && previousState !== 'blocked_dependency')
    fail('previous body writer is not currently a preserved preview/pending cut');
  const staged = cutChain.previewBodyCutAppend(history.document, {
    format:'intuit3d.body-cut-chain',version:1,expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,eventId,cutFeatureId:cutId,
    targetBodyId:bodyId,afterBodyWriterId:afterId,sourceSketchId:sketchId,
    profileCandidateId:request.profileCandidateId,extent:request.extent,
    admission:'require_ready'
  });
  if (staged.semanticStatus !== 'ready' || staged.event?.type !== 'feature.create' ||
      staged.event.feature?.id !== cutId ||
      staged.event.feature?.writeTargets?.length !== 1 ||
      staged.event.feature.writeTargets[0] !== bodyId)
    fail('INTENT did not preview the requested ordered body cut');
  const next = runtime.commit(history, [staged.event], request.expectedRevision);
  const report = runtime.inspect(next);
  const evaluated = state(report, cutId);
  if (!['pending_exact_provider','blocked_dependency'].includes(evaluated?.status))
    throw new Error('feature-ops ordered-cut: runtime did not preserve pending native intent');
  const committed = model.featuresOf(next.document).find(feature => feature.id === cutId);
  if (!committed || committed.payload?.sourceSketchId !== sketchId ||
      committed.payload?.targetBodyId !== bodyId ||
      !committed.dependsOn.includes(afterId) || !committed.dependsOn.includes(sketchId))
    throw new Error('feature-ops ordered-cut: committed dependency or target mismatch');
  return {
    kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    semanticIds:{sketchId,afterId,cutId,bodyId},
    selectedProfileId:request.profileCandidateId,semanticStatus:'ready',
    status:evaluated.status,
    nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:cutId,
      bodyId,sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false
  };
}
