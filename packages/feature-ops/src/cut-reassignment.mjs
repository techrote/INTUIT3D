/**
 * FEATUREOPS cut-reassignment/v1 — reselect an existing generalized profile
 * cut's explicit body and/or source sketch as one undoable INTENT edit.
 * SKETCH/RUNTIME remain the only geometry, evaluation and journal authorities.
 * This is semantic authoring, never a claim of a native Boolean or STEP solid.
 */
export const CUT_REASSIGN_FORMAT = 'intuit3d.feature-ops.cut-reassignment';
export const CUT_REASSIGN_VERSION = 1;

const IDENT = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const own = (v) => v !== null && typeof v === 'object' &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype ||
    Object.getPrototypeOf(v) === null);
function shape(value, keys, label) {
  if (!own(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('feature-ops cut reassignment: invalid ' + label);
}
function id(value, label) {
  if (typeof value !== 'string' || !IDENT.test(value))
    throw new TypeError('feature-ops cut reassignment: invalid ' + label);
  return value;
}
function profileId(value) {
  if (typeof value !== 'string' || !value.startsWith('cycle:') ||
      value.length > 8192)
    throw new TypeError('feature-ops cut reassignment: explicit SKETCH profile required');
  return value;
}
const state = (report, id) => report.features?.find(f => f.featureId === id);
function fail(message) {
  throw new TypeError('feature-ops cut reassignment: ' + message);
}
function same(a,b) {
  return a.length === b.length && a.every((v,i) => b[i] === v);
}

/**
 * Existing cut and original body ownership are expected-fenced as well as the
 * journal revision, so an old UI selection cannot silently change a new body.
 *
 * The replacement profile must already be solved and uniquely admitted by
 * SKETCH and the current RUNTIME. If the OLD sketch becomes unsolved, replacing
 * it with a valid one remains possible: invalid intent is recoverable.
 *
 * Until KERNEL accepts general profile Booleans, the result remains pending.
 */
export function reassignProfileCut(history, request, services) {
  shape(request, ['format','version','eventId','expectedRevision',
    'units','frame','cutFeatureId','from','to'], 'request');
  if (request.format !== CUT_REASSIGN_FORMAT ||
      request.version !== CUT_REASSIGN_VERSION ||
      request.units !== 'mm' || request.frame !== 'local_xy')
    fail('unsupported version or local_xy millimetre frame');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision !== history.document.revision)
    throw new Error('feature-ops cut reassignment: stale expected revision');
  shape(request.from,['extrudeFeatureId','bodyId','sourceSketchId'],'from');
  shape(request.to,['extrudeFeatureId','bodyId','sourceSketchId','profileCandidateId'],'to');
  const cutId = id(request.cutFeatureId,'cutFeatureId');
  const eventId = id(request.eventId,'eventId');
  const fromExtrudeId = id(request.from.extrudeFeatureId,'from.extrudeFeatureId');
  const fromBodyId = id(request.from.bodyId,'from.bodyId');
  const fromSketchId = id(request.from.sourceSketchId,'from.sourceSketchId');
  const toExtrudeId = id(request.to.extrudeFeatureId,'to.extrudeFeatureId');
  const toBodyId = id(request.to.bodyId,'to.bodyId');
  const toSketchId = id(request.to.sourceSketchId,'to.sourceSketchId');
  const selectedProfileId = profileId(request.to.profileCandidateId);
  if ([fromExtrudeId,fromBodyId,fromSketchId].includes(cutId) ||
      [toExtrudeId,toBodyId,toSketchId].includes(cutId) ||
      fromExtrudeId === fromBodyId || toExtrudeId === toBodyId)
    fail('cut, extrude and body identities must be distinct');
  if (fromExtrudeId === toExtrudeId &&
      fromBodyId === toBodyId && fromSketchId === toSketchId)
    fail('no-op cut selection; supply a changed target or sketch');

  const {runtime,model,sketch,discovery} = services ?? {};
  if (typeof runtime?.commit !== 'function' || typeof runtime.inspect !== 'function' ||
      typeof runtime.diff !== 'function' || typeof model?.featuresOf !== 'function' ||
      typeof sketch?.validateSketch !== 'function' ||
      typeof discovery?.discoverPlateProfiles !== 'function' ||
      typeof discovery?.admitDiscoveredPlateProfile !== 'function')
    fail('accepted INTENT/SKETCH/RUNTIME services required');

  const features = model.featuresOf(history.document);
  const byId = new Map(features.map(f => [f.id,f]));
  const oldCut = byId.get(cutId);
  const oldExtrude = byId.get(fromExtrudeId);
  const targetExtrude = byId.get(toExtrudeId);
  const targetSketch = byId.get(toSketchId);
  if (oldCut?.kind !== 'cut' ||
      !same(oldCut.writeTargets ?? [],[fromBodyId]) ||
      oldCut.payload?.targetBodyId !== fromBodyId ||
      oldCut.payload?.sourceSketchId !== fromSketchId ||
      oldCut.payload?.units !== 'mm' || oldCut.payload?.frame !== 'local_xy' ||
      !same(oldCut.dependsOn ?? [],
        fromSketchId === oldExtrude?.payload?.sourceSketchId ?
          [fromExtrudeId] : [fromExtrudeId,fromSketchId]))
    fail('selected cut has changed, or is not a generalized target-body cut');
  if (oldExtrude?.kind !== 'extrude' ||
      !same(oldExtrude.writeTargets ?? [],[fromBodyId]) ||
      typeof oldExtrude.payload?.sourceSketchId !== 'string' ||
      !oldExtrude.dependsOn?.includes(oldExtrude.payload.sourceSketchId))
    fail('original extrusion/body lineage has changed');
  if (targetExtrude?.kind !== 'extrude' ||
      !same(targetExtrude.writeTargets ?? [],[toBodyId]) ||
      typeof targetExtrude.payload?.sourceSketchId !== 'string' ||
      !targetExtrude.dependsOn?.includes(targetExtrude.payload.sourceSketchId))
    fail('explicit new extrusion/body target is unavailable');
  if (targetSketch?.kind !== 'sketch' || !targetSketch.payload?.sketch ||
      (targetSketch.writeTargets?.length ?? -1) !== 0)
    fail('explicit replacement SKETCH feature is unavailable');

  // Body writers must have a proven structural dependency chain; refusing a
  // third-party writer is safer than guessing whether two cuts commute.
  const oldWriters = features.filter(f => f.writeTargets?.includes(fromBodyId))
    .map(f => f.id);
  if (oldWriters.length !== 2 ||
      !oldWriters.includes(fromExtrudeId) || !oldWriters.includes(cutId))
    fail('original body has an additional or ambiguous writer');
  const targetWriters = features.filter(f => f.writeTargets?.includes(toBodyId))
    .map(f => f.id);
  if (toBodyId === fromBodyId) {
    if (toExtrudeId !== fromExtrudeId)
      fail('same body cannot have a different extrusion authority');
  } else if (!same(targetWriters,[toExtrudeId])) {
    fail('replacement body has an additional or ambiguous writer');
  }

  const before = runtime.inspect(history);
  const authored = sketch.validateSketch(targetSketch.payload.sketch);
  const proposal = discovery.discoverPlateProfiles(authored);
  if (proposal.status !== 'ready' || proposal.candidates?.length !== 1 ||
      proposal.candidates[0].id !== selectedProfileId)
    fail('replacement profile missing, unsolved, ambiguous or stale');
  const admitted = discovery.admitDiscoveredPlateProfile(
    authored,proposal,selectedProfileId);
  const sketchState = state(before,toSketchId);
  if (sketchState?.status !== 'analytic_profile_only' ||
      sketchState.profile?.status !== 'analytic_profile_only' ||
      JSON.stringify(sketchState.profile) !== JSON.stringify(admitted))
    fail('replacement profile not admitted by authoritative RUNTIME');
  const extrusionState = state(before,toExtrudeId);
  if (extrusionState?.status !== 'preview_only' ||
      extrusionState.bodyId !== toBodyId ||
      extrusionState.sourceSketchId !== targetExtrude.payload.sourceSketchId)
    fail('replacement extrusion has no current admitted profile');

  const deps = toSketchId === targetExtrude.payload.sourceSketchId ?
    [toExtrudeId] : [toExtrudeId,toSketchId];
  const next = runtime.commit(history,[{
    eventId,type:'feature.edit',featureId:cutId,
    patch:{dependsOn:deps,writeTargets:[toBodyId],
      payload:{...oldCut.payload,sourceSketchId:toSketchId,targetBodyId:toBodyId}}
  }],request.expectedRevision);
  const report = runtime.inspect(next);
  const edited = state(report,cutId);
  if (edited?.status !== 'pending_exact_provider' ||
      state(report,toExtrudeId)?.status !== 'preview_only')
    throw new Error('feature-ops cut reassignment: RUNTIME rejected the cut replacement');
  const post = model.featuresOf(next.document).find(f => f.id === cutId);
  if (!post || !same(post.dependsOn,deps) ||
      !same(post.writeTargets,[toBodyId]) ||
      post.payload.sourceSketchId !== toSketchId ||
      post.payload.targetBodyId !== toBodyId)
    throw new Error('feature-ops cut reassignment: semantic identity or target not preserved');
  return {
    kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    cutFeatureId:cutId,previousBodyId:fromBodyId,targetBodyId:toBodyId,
    selectedProfileId,sourceSketchId:toSketchId,dependsOn:deps,
    status:'pending_exact_provider',
    nativeHandoff:{
      kind:'runtime_evaluation_required',cutFeatureId:cutId,
      bodyId:toBodyId,sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false
    },
    exactAuthority:false,independentInteroperability:false
  };
}
