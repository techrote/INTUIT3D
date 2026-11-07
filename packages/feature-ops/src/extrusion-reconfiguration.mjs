/**
 * FEATUREOPS extrusion-reconfiguration/v1: edit an existing generalized
 * profile extrusion without destroying its body identity or dependent cuts.
 * Only INTENT owns the journal, SKETCH owns admission and RUNTIME owns status.
 * A profile preview is not an exact solid or a native STEP qualification.
 */
export const EXTRUSION_RECONFIG_FORMAT = 'intuit3d.feature-ops.extrusion-reconfiguration';
export const EXTRUSION_RECONFIG_VERSION = 1;

const IDENT = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
   Object.getPrototypeOf(value) === null);
function exact(value, names, label) {
  if (!plain(value) || Object.keys(value).length !== names.length ||
      Object.keys(value).some(key => !names.includes(key)))
    throw new TypeError('feature-ops extrusion edit: invalid ' + label);
}
function id(value, name) {
  if (typeof value !== 'string' || !IDENT.test(value))
    throw new TypeError('feature-ops extrusion edit: invalid ' + name);
  return value;
}
function depth(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError('feature-ops extrusion edit: positive finite ' + name + ' required');
  return value;
}
function candidate(value) {
  if (typeof value !== 'string' || !value.startsWith('cycle:') ||
      value.length > 8192)
    throw new TypeError('feature-ops extrusion edit: explicit SKETCH profile candidate required');
  return value;
}
const same = (a, b) => Array.isArray(a) && a.length === b.length &&
  a.every((value, i) => value === b[i]);
const reportFeature = (report, key) => report.features?.find(item => item.featureId === key);
function fail(message) {
  throw new TypeError('feature-ops extrusion edit: ' + message);
}

/**
 * Reconfigure source SKETCH and/or depth in one undoable transaction.
 *
 * The original source/depth/body are expected-value fences in addition to
 * expectedRevision. A cut whose source was formerly the extrusion sketch must
 * acquire a separate cut-sketch dependency when the extrusion is re-sourced;
 * conversely, a cut using the new extrusion sketch no longer needs a second
 * dependency. The cut itself is NEVER silently re-sourced.
 *
 * An invalid prior extrusion source is repairable: only the replacement
 * SKETCH is required to pass real SKETCH/RUNTIME admission. Unknown body
 * writers, multiple cuts and malformed cut lineage are refused rather than
 * assuming that Boolean operations commute.
 */
export function reconfigureProfileExtrusion(history, request, services) {
  exact(request, ['format','version','eventId','expectedRevision','units','frame',
    'extrudeFeatureId','outputBodyId','from','to'], 'request');
  if (request.format !== EXTRUSION_RECONFIG_FORMAT ||
      request.version !== EXTRUSION_RECONFIG_VERSION ||
      request.units !== 'mm' || request.frame !== 'local_xy')
    fail('unsupported version or local_xy millimetre frame');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      history.document.revision !== request.expectedRevision)
    throw new Error('feature-ops extrusion edit: stale expected revision');
  exact(request.from, ['sourceSketchId','depthMm'], 'from');
  exact(request.to, ['sourceSketchId','profileCandidateId','depthMm'], 'to');
  const eventId = id(request.eventId,'eventId');
  const extrudeId = id(request.extrudeFeatureId,'extrudeFeatureId');
  const bodyId = id(request.outputBodyId,'outputBodyId');
  const oldSketchId = id(request.from.sourceSketchId,'from.sourceSketchId');
  const newSketchId = id(request.to.sourceSketchId,'to.sourceSketchId');
  const previousDepthMm = depth(request.from.depthMm,'from.depthMm');
  const depthMm = depth(request.to.depthMm,'to.depthMm');
  const profileCandidateId = candidate(request.to.profileCandidateId);
  if (new Set([extrudeId,bodyId,oldSketchId]).size !== 3 ||
      new Set([extrudeId,bodyId,newSketchId]).size !== 3)
    fail('sketch, extrude and output body must have distinct identities');
  if (oldSketchId === newSketchId && previousDepthMm === depthMm)
    fail('no-op extrusion reconfiguration');
  const {runtime,model,sketch,discovery} = services ?? {};
  if (typeof runtime?.commit !== 'function' ||
      typeof runtime?.inspect !== 'function' ||
      typeof runtime?.diff !== 'function' ||
      typeof model?.featuresOf !== 'function' ||
      typeof sketch?.validateSketch !== 'function' ||
      typeof discovery?.discoverPlateProfiles !== 'function' ||
      typeof discovery?.admitDiscoveredPlateProfile !== 'function')
    fail('accepted INTENT/SKETCH/RUNTIME services required');

  const features = model.featuresOf(history.document);
  const byId = new Map(features.map(feature => [feature.id,feature]));
  const oldExtrude = byId.get(extrudeId);
  const source = byId.get(newSketchId);
  if (oldExtrude?.kind !== 'extrude' ||
      !same(oldExtrude.writeTargets,[bodyId]) ||
      !same(oldExtrude.dependsOn,[oldSketchId]) ||
      oldExtrude.payload?.sourceSketchId !== oldSketchId ||
      oldExtrude.payload?.thicknessMm !== previousDepthMm ||
      oldExtrude.payload?.units !== 'mm' ||
      oldExtrude.payload?.frame !== 'local_xy')
    fail('selected extrusion/depth/source/body identity has changed');
  if (source?.kind !== 'sketch' || !source.payload?.sketch ||
      !same(source.writeTargets,[]))
    fail('replacement source is not an existing authoritative SKETCH feature');

  const writers = features.filter(feature => feature.writeTargets?.includes(bodyId));
  const cuts = writers.filter(feature => feature.id !== extrudeId);
  if (cuts.length > 1 ||
      cuts.some(cut => cut.kind !== 'cut' ||
        !same(cut.writeTargets,[bodyId]) ||
        cut.payload?.targetBodyId !== bodyId ||
        cut.payload?.units !== 'mm' || cut.payload?.frame !== 'local_xy' ||
        typeof cut.payload?.sourceSketchId !== 'string' ||
        byId.get(cut.payload.sourceSketchId)?.kind !== 'sketch' ||
        !same(cut.dependsOn,cut.payload.sourceSketchId === oldSketchId ?
          [extrudeId] : [extrudeId,cut.payload.sourceSketchId])))
    fail('multiple, foreign or noncommuting body writers');
  const current = runtime.inspect(history);
  const sourceDoc = sketch.validateSketch(source.payload.sketch);
  const found = discovery.discoverPlateProfiles(sourceDoc);
  if (found.status !== 'ready' || found.candidates?.length !== 1 ||
      found.candidates[0].id !== profileCandidateId)
    fail('replacement profile is missing, unsolved, ambiguous or stale');
  const admitted = discovery.admitDiscoveredPlateProfile(
    sourceDoc,found,profileCandidateId);
  const sourceState = reportFeature(current,newSketchId);
  if (sourceState?.status !== 'analytic_profile_only' ||
      sourceState.profile?.status !== 'analytic_profile_only' ||
      JSON.stringify(sourceState.profile) !== JSON.stringify(admitted))
    fail('replacement SKETCH profile is not admitted by authoritative RUNTIME');

  const events = [{
    eventId,type:'feature.edit',featureId:extrudeId,
    patch:{dependsOn:[newSketchId],
      payload:{...oldExtrude.payload,sourceSketchId:newSketchId,thicknessMm:depthMm}}
  }];
  let reboundCutId = null;
  let cutDependencies = null;
  for (const cut of cuts) {
    const dependencies = cut.payload.sourceSketchId === newSketchId ?
      [extrudeId] : [extrudeId,cut.payload.sourceSketchId];
    cutDependencies = dependencies;
    if (!same(cut.dependsOn,dependencies)) {
      events.push({
        eventId:id(eventId + ':cut','derived cut eventId'),
        type:'feature.edit',featureId:cut.id,
        patch:{dependsOn:dependencies}
      });
      reboundCutId = cut.id;
    }
  }
  const next = runtime.commit(history,events,request.expectedRevision);
  const report = runtime.inspect(next);
  const evaluated = reportFeature(report,extrudeId);
  if (evaluated?.status !== 'preview_only' ||
      evaluated.sourceSketchId !== newSketchId ||
      evaluated.bodyId !== bodyId ||
      evaluated.thicknessMm !== depthMm)
    throw new Error('feature-ops extrusion edit: RUNTIME did not admit replacement extrusion');
  const updated = model.featuresOf(next.document);
  const stored = updated.find(feature => feature.id === extrudeId);
  if (!stored || !same(stored.dependsOn,[newSketchId]) ||
      stored.payload.sourceSketchId !== newSketchId ||
      stored.payload.thicknessMm !== depthMm ||
      !same(stored.writeTargets,[bodyId]))
    throw new Error('feature-ops extrusion edit: semantic extrusion/body identity not preserved');
  for (const cut of cuts) {
    const revised = updated.find(feature => feature.id === cut.id);
    if (!revised || !same(revised.dependsOn,cutDependencies) ||
        revised.payload.sourceSketchId !== cut.payload.sourceSketchId ||
        !same(revised.writeTargets,[bodyId]))
      throw new Error('feature-ops extrusion edit: dependent cut lineage not preserved');
    const oldState = reportFeature(current,cut.id)?.status;
    if (oldState === 'pending_exact_provider' &&
        reportFeature(report,cut.id)?.status !== 'pending_exact_provider')
      throw new Error('feature-ops extrusion edit: previously pending cut lost its intent');
  }
  return {
    kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    extrusionFeatureId:extrudeId,outputBodyId:bodyId,
    previousSourceSketchId:oldSketchId,sourceSketchId:newSketchId,
    previousDepthMm,depthMm,selectedProfileId:profileCandidateId,
    reboundCutId,cutDependencies,
    status:'preview_only',
    nativeHandoff:null,
    exactAuthority:false,independentInteroperability:false
  };
}
