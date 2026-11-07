/**
 * INTUIT3D feature-ops/v1: application-level commands over the accepted
 * INTENT/SKETCH/RUNTIME APIs. Not a CAD engine, preview mesh, or exact provider.
 * No duplicated model journal, sketch solver, or body resolution.
 */
export const FEATURE_OPS_FORMAT = 'intuit3d.feature-ops';
export const FEATURE_OPS_VERSION = 1;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const keys = (o, allow, label) => {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      (Object.getPrototypeOf(o) !== Object.prototype && Object.getPrototypeOf(o) !== null) ||
      Object.keys(o).some(k => !allow.includes(k))) throw new TypeError(`feature-ops: invalid ${label}`);
};
const id = (v, name) => {
  if (typeof v !== 'string' || !ID.test(v)) throw new TypeError(`feature-ops: invalid ${name}`);
  return v;
};
const mm = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
    throw new TypeError(`feature-ops: ${name} must be a positive finite mm value`);
  return v;
};
const coordinate = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`feature-ops: invalid ${name}`);
  return v;
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) throw new TypeError(`feature-ops: duplicate ${label}`);
};
const state = (report, featureId) => report.features.find(f => f.featureId === featureId);
const create = (eventId, feature) => ({ eventId, type:'feature.create', feature });

/**
 * Construct real SKETCH v1 constraints for a centred rectangular flange with
 * any 1–64 expressly named clearance holes. SKETCH itself admits/rejects the
 * solved profile, boundary contacts, overlap and dimensional consistency.
 * IDs do NOT depend on array order, facilitating subsequent hole edits.
 */
export function mountingFlangeSketch(spec, sketch, discovery) {
  keys(spec, ['widthMm','depthMm','holes','frame','units'], 'flange specification');
  if (spec.units !== 'mm' || spec.frame !== 'local_centered_xy')
    throw new TypeError('feature-ops: only centred XY millimetre sketch frame supported');
  const width = mm(spec.widthMm, 'widthMm');
  const depth = mm(spec.depthMm, 'depthMm');
  if (!Array.isArray(spec.holes) || spec.holes.length < 1 || spec.holes.length > 64)
    throw new TypeError('feature-ops: 1–64 explicit clearance holes required');
  if (!sketch || typeof sketch.validateSketch !== 'function' ||
      typeof sketch.solveSketch !== 'function' || !discovery ||
      typeof discovery.discoverPlateProfiles !== 'function' ||
      typeof discovery.admitDiscoveredPlateProfile !== 'function')
    throw new TypeError('feature-ops: accepted SKETCH and profile discovery services required');
  const holeIds = spec.holes.map(h => {
    keys(h,['id','xMm','yMm','radiusMm'],'hole');
    const name = id(h.id, 'hole id');
    if (!NAME.test(name) || name.includes(':')) throw new TypeError('feature-ops: hole id cannot contain colon');
    coordinate(h.xMm,'hole xMm'); coordinate(h.yMm,'hole yMm'); mm(h.radiusMm,'hole radiusMm');
    return name;
  });
  unique(holeIds,'hole ids');
  const points = [
    {id:'outline.sw',x:-width/2,y:-depth/2},
    {id:'outline.se',x:width/2,y:-depth/2},
    {id:'outline.ne',x:width/2,y:depth/2},
    {id:'outline.nw',x:-width/2,y:depth/2},
  ];
  const lines = [
    {id:'outline.bottom',start:'outline.sw',end:'outline.se'},
    {id:'outline.right',start:'outline.se',end:'outline.ne'},
    {id:'outline.top',start:'outline.ne',end:'outline.nw'},
    {id:'outline.left',start:'outline.nw',end:'outline.sw'},
  ];
  const circles = [];
  const constraints = [
    {id:'outline.anchor',kind:'fixed',point:'outline.sw',x:-width/2,y:-depth/2},
    {id:'outline.horizontal.bottom',kind:'horizontal',line:'outline.bottom'},
    {id:'outline.horizontal.top',kind:'horizontal',line:'outline.top'},
    {id:'outline.vertical.right',kind:'vertical',line:'outline.right'},
    {id:'outline.vertical.left',kind:'vertical',line:'outline.left'},
    {id:'outline.width',kind:'distanceX',a:'outline.sw',b:'outline.se',value:width},
    {id:'outline.depth',kind:'distanceY',a:'outline.se',b:'outline.ne',value:depth},
  ];
  for (const hole of spec.holes) {
    const center = `hole.${hole.id}.center`, circle = `hole.${hole.id}`;
    points.push({id:center,x:hole.xMm,y:hole.yMm});
    circles.push({id:circle,center,radius:hole.radiusMm});
    constraints.push({id:`hole.${hole.id}.fixed`,kind:'fixed',point:center,x:hole.xMm,y:hole.yMm});
    constraints.push({id:`hole.${hole.id}.radius`,kind:'radius',circle,value:hole.radiusMm});
  }
  const authored = sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
  const solved = sketch.solveSketch(authored);
  if (solved.status !== 'solved') throw new TypeError(`feature-ops: sketch ${solved.status}; no geometry admitted`);
  const discovered = discovery.discoverPlateProfiles(authored);
  if (discovered.status !== 'ready' || discovered.candidates?.length !== 1)
    throw new TypeError(`feature-ops: profile discovery ${discovered.status}; refusing inferred body`);
  const profile = discovery.admitDiscoveredPlateProfile(authored, discovered, discovered.candidates[0].id);
  if (profile.status !== 'analytic_profile_only' || profile.holes.length !== spec.holes.length)
    throw new TypeError('feature-ops: SKETCH did not admit requested clearance holes');
  return {sketch:authored,profile,source:'accepted_SKETCH_analytic_only',exactAuthority:false};
}

/**
 * Author a new fully constrained, explicitly targeted multi-hole flange in one
 * atomic RUNTIME/INTENT transaction. Fail closed on existing semantic IDs,
 * existing body writers and unadmitted sketches. No direct STEP creation.
 */
export function authorMountingFlange(history, request, services) {
  keys(request,['format','version','eventId','expectedRevision','sketchFeatureId',
    'extrudeFeatureId','cutFeatureId','targetBodyId','thicknessMm','spec'], 'authoring request');
  if (request.format !== FEATURE_OPS_FORMAT || request.version !== FEATURE_OPS_VERSION)
    throw new TypeError('feature-ops: unsupported authoring protocol');
  const {runtime,model,sketch,discovery} = services ?? {};
  if (typeof runtime?.commit !== 'function' || typeof runtime.inspect !== 'function' ||
      typeof runtime.diff !== 'function' || typeof model?.featuresOf !== 'function')
    throw new TypeError('feature-ops: accepted RUNTIME/INTENT services required');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision !== history.document.revision)
    throw new Error('feature-ops: stale source revision');
  const ids = [request.sketchFeatureId,request.extrudeFeatureId,request.cutFeatureId,request.targetBodyId]
    .map((v,i) => id(v,['sketchFeatureId','extrudeFeatureId','cutFeatureId','targetBodyId'][i]));
  unique(ids, 'semantic identities');
  const eventId = id(request.eventId,'eventId');
  const thickness = mm(request.thicknessMm,'thicknessMm');
  const existing = model.featuresOf(history.document);
  const occupied = new Set(existing.map(f=>f.id));
  if (ids.slice(0,3).some(v=>occupied.has(v))) throw new Error('feature-ops: feature identity already exists');
  if (existing.some(f=>f.writeTargets.includes(request.targetBodyId)))
    throw new Error('feature-ops: target body already has a writer');
  const built = mountingFlangeSketch(request.spec,sketch,discovery);
  const [sketchId,extrudeId,cutId,bodyId] = ids;
  const events = [
    create(`${eventId}.sketch`,{id:sketchId,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:built.sketch}}),
    create(`${eventId}.extrude`,{id:extrudeId,kind:'extrude',dependsOn:[sketchId],writeTargets:[bodyId],
      payload:{sourceSketchId:sketchId,thicknessMm:thickness}}),
    create(`${eventId}.cut`,{id:cutId,kind:'cut',dependsOn:[extrudeId],writeTargets:[bodyId],
      payload:{sourceSketchId:sketchId,targetBodyId:bodyId}}),
  ];
  const next = runtime.commit(history,events,request.expectedRevision);
  const report = runtime.inspect(next);
  if (state(report,sketchId)?.status !== 'analytic_profile_only' ||
      state(report,extrudeId)?.status !== 'preview_only' ||
      state(report,cutId)?.status !== 'pending_exact_provider')
    throw new Error('feature-ops: authoritative runtime did not admit the constructed flange');
  return {kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    semanticIds:{sketchId,extrudeId,cutId,bodyId},
    nativeHandoff:{kind:'experimental_plate_only',cutFeatureId:cutId,bodyId,
      sourceRevision:next.document.revision,exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}

/** Re-author extrude thickness through INTENT with revision fencing and undo. */
export function editExtrudeThickness(history, request, services) {
  keys(request,['eventId','featureId','expectedRevision','thicknessMm'],'extrude edit');
  const {runtime,model} = services ?? {};
  if (typeof runtime?.commit !== 'function' || typeof runtime.inspect !== 'function' ||
      typeof runtime.diff !== 'function' || typeof model?.featuresOf !== 'function')
    throw new TypeError('feature-ops: accepted RUNTIME/INTENT services required');
  if (!history?.document || request.expectedRevision !== history.document.revision)
    throw new Error('feature-ops: stale extrude edit revision');
  const featureId=id(request.featureId,'featureId');
  const eventId=id(request.eventId,'eventId');
  const thickness=mm(request.thicknessMm,'thicknessMm');
  const feature=model.featuresOf(history.document).find(f=>f.id===featureId);
  if (!feature || feature.kind!=='extrude' || !feature.dependsOn.includes(feature.payload.sourceSketchId) ||
      feature.writeTargets.length !== 1)
    throw new TypeError('feature-ops: explicit existing extrude and sketch dependency required');
  const before=runtime.inspect(history);
  const next=runtime.commit(history,[{eventId,type:'feature.edit',featureId,
    patch:{payload:{...feature.payload,thicknessMm:thickness}}}],request.expectedRevision);
  const report=runtime.inspect(next);
  return {kind:'committed',history:next,report,previousStatus:state(before,featureId)?.status,
    status:state(report,featureId)?.status,invalidation:runtime.diff(history,next),
    exactAuthority:false,independentInteroperability:false};
}


/**
 * Reauthor a complete named-hole mounting flange and extrusion in ONE
 * revision-fenced INTENT transaction. The caller explicitly provides the
 * entire desired configuration: omission of a former hole means removal.
 * Retained named hole IDs, feature IDs, the output body and the cut's target
 * remain identical across the edit, undo, redo and save/reopen.
 *
 * This is orchestration over SKETCH/INTENT/RUNTIME, not a new solver, journal
 * or Boolean provider. Inadmissible SKETCH configurations refuse before any
 * command is committed. In particular, never downgrade to a preview mesh.
 */
export function reconfigureMountingFlange(history, request, services) {
  keys(request, ['eventId','expectedRevision','sketchFeatureId','extrudeFeatureId',
    'cutFeatureId','targetBodyId','thicknessMm','spec'], 'flange reconfiguration');
  const {runtime,model,sketch,discovery} = services ?? {};
  if (typeof runtime?.commit !== 'function' || typeof runtime.inspect !== 'function' ||
      typeof runtime.diff !== 'function' || typeof model?.featuresOf !== 'function')
    throw new TypeError('feature-ops: accepted RUNTIME/INTENT services required');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision !== history.document.revision)
    throw new Error('feature-ops: stale reconfiguration revision');
  const eventId = id(request.eventId,'eventId');
  if (eventId.length > 115) throw new TypeError('feature-ops: reconfiguration event id too long');
  const ids = [
    id(request.sketchFeatureId,'sketchFeatureId'),
    id(request.extrudeFeatureId,'extrudeFeatureId'),
    id(request.cutFeatureId,'cutFeatureId'),
    id(request.targetBodyId,'targetBodyId')
  ];
  unique(ids,'semantic identities');
  const [sketchId,extrudeId,cutId,bodyId] = ids;
  const thickness = mm(request.thicknessMm,'thicknessMm');
  const features = model.featuresOf(history.document);
  const lookup = new Map(features.map(f => [f.id,f]));
  const sk = lookup.get(sketchId), ex = lookup.get(extrudeId), cut = lookup.get(cutId);
  if (sk?.kind !== 'sketch' || ex?.kind !== 'extrude' || cut?.kind !== 'cut' ||
      !sk.payload?.sketch || ex.payload?.sourceSketchId !== sketchId ||
      cut.payload?.sourceSketchId !== sketchId || cut.payload?.targetBodyId !== bodyId ||
      !ex.dependsOn.includes(sketchId) || !cut.dependsOn.includes(extrudeId) ||
      ex.writeTargets.length !== 1 || ex.writeTargets[0] !== bodyId ||
      cut.writeTargets.length !== 1 || cut.writeTargets[0] !== bodyId)
    throw new TypeError('feature-ops: existing authored flange, explicit cut and body lineage required');
  if (features.some(f => f.id !== extrudeId && f.id !== cutId &&
      f.writeTargets.includes(bodyId)))
    throw new TypeError('feature-ops: additional writer on flange body; refusing ambiguous configuration');
  const prior = sk.payload.sketch;
  if (!Array.isArray(prior.points) || !Array.isArray(prior.lines) ||
      !Array.isArray(prior.circles) || !Array.isArray(prior.constraints) ||
      !['outline.sw','outline.se','outline.ne','outline.nw']
        .every(name => prior.points.some(p => p.id === name)) ||
      !['outline.bottom','outline.right','outline.top','outline.left']
        .every(name => prior.lines.some(line => line.id === name)) ||
      !prior.circles.every(circle => typeof circle.id === 'string' &&
        /^hole\.[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(circle.id)))
    throw new TypeError('feature-ops: existing sketch is not a named mounting flange');
  // SKETCH, not this module, owns solver, contact and unique-profile admission.
  const built = mountingFlangeSketch(request.spec,sketch,discovery);
  if (JSON.stringify(prior) === JSON.stringify(built.sketch) &&
      ex.payload.thicknessMm === thickness)
    throw new TypeError('feature-ops: reconfiguration has no change');
  const before = new Set(prior.circles.map(circle => circle.id));
  const after = new Set(built.sketch.circles.map(circle => circle.id));
  const events = [
    {eventId:eventId + '.sketch',type:'feature.edit',featureId:sketchId,
      patch:{payload:{...sk.payload,sketch:built.sketch}}},
    {eventId:eventId + '.extrude',type:'feature.edit',featureId:extrudeId,
      patch:{payload:{...ex.payload,thicknessMm:thickness}}}
  ];
  const next = runtime.commit(history,events,request.expectedRevision);
  const report = runtime.inspect(next);
  if (state(report,sketchId)?.status !== 'analytic_profile_only' ||
      state(report,extrudeId)?.status !== 'preview_only' ||
      state(report,cutId)?.status !== 'pending_exact_provider')
    throw new Error('feature-ops: authoritative runtime refused reconfigured flange');
  return {
    kind:'committed',history:next,report,invalidation:runtime.diff(history,next),
    semanticIds:{sketchId,extrudeId,cutId,bodyId},
    holeChanges:{
      added:[...after].filter(name => !before.has(name)),
      removed:[...before].filter(name => !after.has(name)),
      retained:[...after].filter(name => before.has(name))
    },
    previousThicknessMm:ex.payload.thicknessMm,thicknessMm:thickness,
    nativeHandoff:{kind:'experimental_plate_only',cutFeatureId:cutId,bodyId,
      sourceRevision:next.document.revision,exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false
  };
}


// Generalized authored sketch-profile extrusion and explicit target-body cut.
export {PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION,
  authorProfileExtrusion,authorProfileBodyCut} from './profile-solid.mjs';
