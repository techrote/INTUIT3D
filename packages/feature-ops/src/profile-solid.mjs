/**
 * FEATUREOPS profile-solid/v1 — real authored feature commands over the
 * accepted INTENT/SKETCH/RUNTIME interfaces.  No independent solver, journal,
 * body inference or native geometry authority is introduced here.
 *
 * A caller selects an EXISTING saved sketch and a specific SKETCH-discovered
 * semantic profile.  The current RUNTIME supports one unambiguous profile;
 * selecting an unadmitted loop does not bypass its solver or profile gates.
 */
export const PROFILE_OPS_FORMAT = 'intuit3d.feature-ops.profile-solid';
export const PROFILE_OPS_VERSION = 1;

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain = (value) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function fields(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError('feature-ops profile: invalid ' + label);
}
function identity(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new TypeError('feature-ops profile: invalid ' + label);
  return value;
}
function revision(history, expectedRevision) {
  if (!history?.document || !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 || history.document.revision !== expectedRevision)
    throw new Error('feature-ops profile: stale or missing expected revision');
}
function positiveMm(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError('feature-ops profile: positive finite ' + label + ' in mm required');
  return value;
}
function requireServices(services) {
  const {runtime, model, sketch, discovery} = services ?? {};
  if (typeof runtime?.inspect !== 'function' || typeof runtime.commit !== 'function' ||
      typeof runtime.diff !== 'function' || typeof model?.featuresOf !== 'function' ||
      typeof sketch?.validateSketch !== 'function' ||
      typeof discovery?.discoverPlateProfiles !== 'function' ||
      typeof discovery.admitDiscoveredPlateProfile !== 'function')
    throw new TypeError('feature-ops profile: accepted INTENT/SKETCH/RUNTIME services required');
  return {runtime,model,sketch,discovery};
}
function reportFeature(report, featureId) {
  return report.features?.find(entry => entry.featureId === featureId);
}
function unique(values, label) {
  if (new Set(values).size !== values.length)
    throw new TypeError('feature-ops profile: duplicate ' + label);
}

/** Re-admit the exact selected line-loop against the source journal and RUNTIME. */
function selectedProfile(history, sourceSketchId, candidateId, services, report, features) {
  identity(sourceSketchId, 'sourceSketchId');
  if (typeof candidateId !== 'string' || !candidateId.startsWith('cycle:') ||
      candidateId.length > 8192)
    throw new TypeError('feature-ops profile: explicit semantic profile candidate required');
  const source=features.find(feature => feature.id === sourceSketchId);
  if (source?.kind !== 'sketch' || !source.payload?.sketch ||
      !Array.isArray(source.writeTargets) || source.writeTargets.length !== 0)
    throw new TypeError('feature-ops profile: existing authoritative sketch required');
  const authored=services.sketch.validateSketch(source.payload.sketch);
  const proposal=services.discovery.discoverPlateProfiles(authored);
  if (proposal.status !== 'ready' || proposal.candidates?.length !== 1 ||
      proposal.candidates[0].id !== candidateId)
    throw new TypeError('feature-ops profile: selected sketch profile is ambiguous, missing or stale');
  const admitted=services.discovery.admitDiscoveredPlateProfile(
    authored,proposal,candidateId);
  const current=reportFeature(report,sourceSketchId);
  if (current?.status !== 'analytic_profile_only' ||
      current.profile?.status !== 'analytic_profile_only' ||
      JSON.stringify(current.profile) !== JSON.stringify(admitted))
    throw new TypeError('feature-ops profile: authoritative runtime has not admitted selected profile');
  return {source,profile:admitted};
}
function header(history, request, services, allowed, label) {
  fields(request,allowed,label);
  if (request.format !== PROFILE_OPS_FORMAT || request.version !== PROFILE_OPS_VERSION)
    throw new TypeError('feature-ops profile: unsupported profile operation protocol');
  revision(history,request.expectedRevision);
  if (request.units !== 'mm' || request.frame !== 'local_xy')
    throw new TypeError('feature-ops profile: explicit local_xy millimetre frame required');
  const dependencies=requireServices(services);
  return {
    ...dependencies, features:dependencies.model.featuresOf(history.document),
    before:dependencies.runtime.inspect(history),
    eventId:identity(request.eventId,'eventId')
  };
}

/**
 * Extrude an explicitly selected, saved SKETCH profile to a new named body.
 * Shapes may be general simple polygons; RUNTIME still returns preview_only.
 * No cut or STEP is implicitly invented from circles or an inferred body.
 */
export function authorProfileExtrusion(history, request, services) {
  const context=header(history,request,services,[
    'format','version','eventId','expectedRevision','sourceSketchId','profileCandidateId',
    'extrudeFeatureId','outputBodyId','depthMm','units','frame'
  ],'profile extrusion request');
  const {features,before,runtime,eventId}=context;
  const sketchId=identity(request.sourceSketchId,'sourceSketchId');
  const extrudeId=identity(request.extrudeFeatureId,'extrudeFeatureId');
  const bodyId=identity(request.outputBodyId,'outputBodyId');
  unique([sketchId,extrudeId,bodyId],'sketch/extrude/body identities');
  const depthMm=positiveMm(request.depthMm,'extrusion depth');
  selectedProfile(history,sketchId,request.profileCandidateId,context,before,features);
  if (features.some(feature => feature.id === extrudeId))
    throw new TypeError('feature-ops profile: extrude identity already exists');
  if (features.some(feature => feature.writeTargets?.includes(bodyId)))
    throw new TypeError('feature-ops profile: output body already has a writer');
  const next=runtime.commit(history,[{
    eventId,type:'feature.create',
    feature:{id:extrudeId,kind:'extrude',dependsOn:[sketchId],
      writeTargets:[bodyId],payload:{sourceSketchId:sketchId,thicknessMm:depthMm,units:'mm',frame:'local_xy'}}
  }],request.expectedRevision);
  const report=runtime.inspect(next);
  const evaluated=reportFeature(report,extrudeId);
  if (evaluated?.status !== 'preview_only' || evaluated.bodyId !== bodyId ||
      evaluated.sourceSketchId !== sketchId)
    throw new Error('feature-ops profile: runtime did not admit requested profile extrusion');
  return {
    kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    semanticIds:{sketchId,extrudeId,bodyId},selectedProfileId:request.profileCandidateId,
    status:'preview_only',nativeHandoff:null,
    exactAuthority:false,independentInteroperability:false
  };
}

/**
 * Add a separate explicit cut feature to an existing named extrusion/body.
 * The cut sketch can be the extrude sketch OR a distinct saved profile sketch.
 * The latter is valuable editable intent but the plate-only native worker
 * currently cannot execute it; the state must remain pending_exact_provider.
 */
export function authorProfileBodyCut(history, request, services) {
  const context=header(history,request,services,[
    'format','version','eventId','expectedRevision','sourceSketchId','profileCandidateId',
    'extrudeFeatureId','cutFeatureId','targetBodyId','units','frame'
  ],'profile body cut request');
  const {features,before,runtime,eventId}=context;
  const sketchId=identity(request.sourceSketchId,'sourceSketchId');
  const extrudeId=identity(request.extrudeFeatureId,'extrudeFeatureId');
  const cutId=identity(request.cutFeatureId,'cutFeatureId');
  const bodyId=identity(request.targetBodyId,'targetBodyId');
  unique([sketchId,extrudeId,cutId,bodyId],'cut semantic identities');
  selectedProfile(history,sketchId,request.profileCandidateId,context,before,features);
  const extrude=features.find(feature => feature.id === extrudeId);
  if (extrude?.kind !== 'extrude' || extrude.writeTargets?.length !== 1 ||
      extrude.writeTargets[0] !== bodyId ||
      typeof extrude.payload?.sourceSketchId !== 'string' ||
      !extrude.dependsOn?.includes(extrude.payload.sourceSketchId) ||
      reportFeature(before,extrudeId)?.status !== 'preview_only')
    throw new TypeError('feature-ops profile: explicit admitted extrude and target body required');
  if (features.some(feature => feature.id === cutId))
    throw new TypeError('feature-ops profile: cut identity already exists');
  if (features.some(feature => feature.id !== extrudeId &&
      feature.writeTargets?.includes(bodyId)))
    throw new TypeError('feature-ops profile: ambiguous additional body writer');
  const next=runtime.commit(history,[{
    eventId,type:'feature.create',
    feature:{id:cutId,kind:'cut',
      dependsOn:sketchId===extrude.payload.sourceSketchId?
        [extrudeId]:[extrudeId,sketchId],
      writeTargets:[bodyId],
      payload:{sourceSketchId:sketchId,targetBodyId:bodyId,units:'mm',frame:'local_xy'}}
  }],request.expectedRevision);
  const report=runtime.inspect(next);
  if (reportFeature(report,cutId)?.status !== 'pending_exact_provider')
    throw new Error('feature-ops profile: runtime did not preserve pending exact cut intent');
  return {
    kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    semanticIds:{sketchId,extrudeId,cutId,bodyId},selectedProfileId:request.profileCandidateId,
    status:'pending_exact_provider',
    nativeHandoff:{
      kind:'runtime_evaluation_required',cutFeatureId:cutId,bodyId,
      sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false
    },
    exactAuthority:false,independentInteroperability:false
  };
}
