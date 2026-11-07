/**
 * FEATUREOPS body-set/v1 — one INTENT transaction creates 2–8 independent,
 * explicitly targeted solids from pre-existing admitted SKETCH profiles.
 * RUNTIME owns all journal mutations/evaluation; SKETCH owns geometry.
 * This does not construct, claim or export native B-rep solids.
 */
export const BODY_SET_FORMAT = 'intuit3d.feature-ops.body-set';
export const BODY_SET_VERSION = 1;

const IDENT = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function exact(value, keys, name) {
  if (!plain(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('feature-ops body-set: invalid ' + name);
}
function id(value, name) {
  if (typeof value !== 'string' || !IDENT.test(value))
    throw new TypeError('feature-ops body-set: invalid ' + name);
  return value;
}
function candidate(value) {
  if (typeof value !== 'string' || !value.startsWith('cycle:') || value.length > 8192)
    throw new TypeError('feature-ops body-set: explicit SKETCH profile candidate required');
  return value;
}
function state(report, featureId) {
  return report.features?.find(entry => entry.featureId === featureId);
}
function selectSketch(sourceSketchId, profileCandidateId, byId, report, services, cache) {
  const key = JSON.stringify([sourceSketchId,profileCandidateId]);
  if (cache.has(key)) return cache.get(key);
  const source=byId.get(sourceSketchId);
  if (source?.kind !== 'sketch' || !source.payload?.sketch ||
      !Array.isArray(source.writeTargets) || source.writeTargets.length !== 0)
    throw new TypeError('feature-ops body-set: existing authored SKETCH feature required');
  const doc=services.sketch.validateSketch(source.payload.sketch);
  const discovery=services.discovery.discoverPlateProfiles(doc);
  if (discovery.status !== 'ready' || discovery.candidates?.length !== 1 ||
      discovery.candidates[0].id !== profileCandidateId)
    throw new TypeError('feature-ops body-set: selected profile is missing, stale or ambiguous');
  const admitted=services.discovery.admitDiscoveredPlateProfile(doc,discovery,profileCandidateId);
  const actual=state(report,sourceSketchId);
  if (actual?.status !== 'analytic_profile_only' ||
      actual.profile?.status !== 'analytic_profile_only' ||
      JSON.stringify(actual.profile) !== JSON.stringify(admitted))
    throw new TypeError('feature-ops body-set: RUNTIME has not admitted the selected SKETCH profile');
  cache.set(key,admitted);
  return admitted;
}

/**
 * Create multiple independent bodies (optionally each with its own explicit cut)
 * as ONE undoable INTENT batch.  All source sketches must already exist, all
 * body IDs must be new, and cuts can only target their own specified extrusion.
 */
export function authorProfileBodySet(history, request, services) {
  exact(request,['format','version','expectedRevision','units','frame','bodies'],'request');
  if (request.format !== BODY_SET_FORMAT || request.version !== BODY_SET_VERSION ||
      request.units !== 'mm' || request.frame !== 'local_xy')
    throw new TypeError('feature-ops body-set: unsupported protocol or local_xy mm frame');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision !== history.document.revision)
    throw new Error('feature-ops body-set: stale expected revision');
  const {runtime,model,sketch,discovery}=services??{};
  if (typeof runtime?.commit !== 'function' || typeof runtime?.inspect !== 'function' ||
      typeof runtime?.diff !== 'function' || typeof model?.featuresOf !== 'function' ||
      typeof sketch?.validateSketch !== 'function' ||
      typeof discovery?.discoverPlateProfiles !== 'function' ||
      typeof discovery?.admitDiscoveredPlateProfile !== 'function')
    throw new TypeError('feature-ops body-set: accepted INTENT/SKETCH/RUNTIME services required');
  if (!Array.isArray(request.bodies) || request.bodies.length < 2 || request.bodies.length > 8)
    throw new TypeError('feature-ops body-set: 2–8 bodies required');

  const features=model.featuresOf(history.document);
  const byId=new Map(features.map(feature=>[feature.id,feature]));
  const writers=new Set(features.flatMap(feature=>feature.writeTargets||[]));
  const reserved=new Set(byId.keys());
  // No body or event aliases, including future generated event IDs. A body
  // cannot silently share a semantic ID with a sketch or another feature.
  const newIds=new Set(), eventIds=new Set(), sketchCache=new Map();
  const before=runtime.inspect(history), events=[], bodies=[];
  function fresh(value,name) {
    const key=id(value,name);
    if (reserved.has(key) || newIds.has(key))
      throw new TypeError('feature-ops body-set: occupied or repeated ' + name);
    newIds.add(key);
    return key;
  }
  function eventId(value) {
    const valueId=id(value,'eventId');
    if (eventIds.has(valueId))
      throw new TypeError('feature-ops body-set: repeated eventId');
    eventIds.add(valueId);
    return valueId;
  }
  // Preflight ALL profiles and identities before handing anything to RUNTIME.
  for (const [index,raw] of request.bodies.entries()) {
    exact(raw,['sourceSketchId','profileCandidateId','extrudeFeatureId',
      'outputBodyId','depthMm','eventId','cut'],'body '+index);
    const sourceSketchId=id(raw.sourceSketchId,'sourceSketchId');
    const profileCandidateId=candidate(raw.profileCandidateId);
    selectSketch(sourceSketchId,profileCandidateId,byId,before,services,sketchCache);
    const extrudeFeatureId=fresh(raw.extrudeFeatureId,'extrudeFeatureId');
    const outputBodyId=fresh(raw.outputBodyId,'outputBodyId');
    if (writers.has(outputBodyId))
      throw new TypeError('feature-ops body-set: target body already has a writer');
    if (typeof raw.depthMm !== 'number' || !Number.isFinite(raw.depthMm) || raw.depthMm<=0)
      throw new TypeError('feature-ops body-set: positive finite depthMm required');
    events.push({eventId:eventId(raw.eventId),type:'feature.create',feature:{
      id:extrudeFeatureId,kind:'extrude',dependsOn:[sourceSketchId],
      writeTargets:[outputBodyId],payload:{sourceSketchId,thicknessMm:raw.depthMm,
        units:'mm',frame:'local_xy'}
    }});
    let cut=null;
    if (raw.cut !== null) {
      exact(raw.cut,['sourceSketchId','profileCandidateId','cutFeatureId','eventId'],
        'cut '+index);
      const cutSketchId=id(raw.cut.sourceSketchId,'cut sourceSketchId');
      const cutProfileCandidateId=candidate(raw.cut.profileCandidateId);
      selectSketch(cutSketchId,cutProfileCandidateId,byId,before,services,sketchCache);
      const cutFeatureId=fresh(raw.cut.cutFeatureId,'cutFeatureId');
      events.push({eventId:eventId(raw.cut.eventId),type:'feature.create',feature:{
        id:cutFeatureId,kind:'cut',
        dependsOn:cutSketchId===sourceSketchId?[extrudeFeatureId]:
          [extrudeFeatureId,cutSketchId],
        writeTargets:[outputBodyId],payload:{sourceSketchId:cutSketchId,
          targetBodyId:outputBodyId,units:'mm',frame:'local_xy'}
      }});
      cut={sketchId:cutSketchId,selectedProfileId:cutProfileCandidateId,cutFeatureId};
    }
    bodies.push({sketchId:sourceSketchId,selectedProfileId:profileCandidateId,
      extrudeFeatureId,bodyId:outputBodyId,cut});
  }
  // Guard a selected source sketch from a newly reserved body/feature identity.
  if (bodies.some(body => newIds.has(body.sketchId) ||
      (body.cut && newIds.has(body.cut.sketchId))))
    throw new TypeError('feature-ops body-set: source sketch aliases new output');

  const next=runtime.commit(history,events,request.expectedRevision);
  const report=runtime.inspect(next);
  for (const body of bodies) {
    const extruded=state(report,body.extrudeFeatureId);
    if (extruded?.status !== 'preview_only' || extruded.bodyId !== body.bodyId ||
        extruded.sourceSketchId !== body.sketchId)
      throw new Error('feature-ops body-set: RUNTIME did not admit selected extrusion');
    if (body.cut && state(report,body.cut.cutFeatureId)?.status !== 'pending_exact_provider')
      throw new Error('feature-ops body-set: RUNTIME did not preserve pending cut intent');
  }
  const sourceRevision=next.document.revision;
  return {kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    bodies:bodies.map(body=>({
      ...body,status:body.cut?'pending_exact_provider':'preview_only',
      nativeHandoff:body.cut?{
        kind:'runtime_evaluation_required',cutFeatureId:body.cut.cutFeatureId,
        bodyId:body.bodyId,sourceRevision,
        compatibility:'not_claimed_ask_RUNTIME_provider',
        exactAuthority:false,independentInteroperability:false
      }:null
    })),
    exactAuthority:false,independentInteroperability:false
  };
}
