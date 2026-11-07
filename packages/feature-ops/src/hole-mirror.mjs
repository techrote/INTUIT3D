/**
 * FEATUREOPS hole-mirror/v1: a one-shot mirror of solved circular holes across
 * an explicit local-XY axis. SKETCH/RUNTIME own geometry admission and edits.
 * Copies are independent authored holes, not associative native features.
 */
export const HOLE_MIRROR_FORMAT = 'intuit3d.feature-ops.hole-mirror';
export const HOLE_MIRROR_VERSION = 1;
const IDENT = /^[A-Za-z][A-Za-z0-9._:-]{0,100}$/;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const own = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const fail = message => { throw new TypeError('feature-ops mirror: ' + message); };
function exactFields(value, names, label) {
  if (!own(value) || Object.keys(value).length !== names.length ||
      Object.keys(value).some(key => !names.includes(key))) fail('invalid ' + label);
}
function identity(value, label) {
  if (typeof value !== 'string' || !IDENT.test(value)) fail('invalid ' + label);
  return value;
}
const state = (report,id) => report.features?.find(f => f.featureId === id);

/**
 * Mirror 1-16 selected circles in an existing cut-bearing sketch. Coordinates
 * and radii come from solved SKETCH, never from authored point seed values.
 * The accepted RUNTIME editPlateHoles contract performs one revision-fenced
 * journal transaction, re-solves, checks profile contact, and invalidates.
 */
export function mirrorProfileHoles(history,request,services) {
  exactFields(request,[
    'format','version','eventId','expectedRevision','units','frame',
    'sketchFeatureId','extrudeFeatureId','cutFeatureId','targetBodyId','axis','copies'
  ],'request');
  if (request.format !== HOLE_MIRROR_FORMAT || request.version !== HOLE_MIRROR_VERSION ||
      request.units !== 'mm' || request.frame !== 'local_xy')
    fail('unsupported mirror protocol or local_xy millimetre frame');
  if (!history?.document || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision !== history.document.revision)
    throw new Error('feature-ops mirror: stale expected revision');
  const eventId=identity(request.eventId,'eventId');
  const sketchId=identity(request.sketchFeatureId,'sketchFeatureId');
  const extrudeId=identity(request.extrudeFeatureId,'extrudeFeatureId');
  const cutId=identity(request.cutFeatureId,'cutFeatureId');
  const bodyId=identity(request.targetBodyId,'targetBodyId');
  if (new Set([sketchId,extrudeId,cutId,bodyId]).size !== 4)
    fail('duplicate feature or body identities');
  const {runtime,model,sketch}=services??{};
  if (typeof runtime?.inspect !== 'function' || typeof runtime?.editPlateHoles !== 'function' ||
      typeof model?.featuresOf !== 'function' || typeof sketch?.validateSketch !== 'function' ||
      typeof sketch?.solveSketch !== 'function')
    fail('accepted RUNTIME, INTENT and SKETCH services required');
  const features=model.featuresOf(history.document);
  const source=features.find(f => f.id === sketchId);
  const extrude=features.find(f => f.id === extrudeId);
  const cut=features.find(f => f.id === cutId);
  if (source?.kind !== 'sketch' || !source.payload?.sketch ||
      extrude?.kind !== 'extrude' || extrude.writeTargets?.length !== 1 ||
      extrude.writeTargets[0] !== bodyId ||
      !extrude.dependsOn?.includes(extrude.payload?.sourceSketchId) ||
      cut?.kind !== 'cut' || cut.writeTargets?.length !== 1 ||
      cut.writeTargets[0] !== bodyId || cut.payload?.targetBodyId !== bodyId ||
      cut.payload?.sourceSketchId !== sketchId ||
      !cut.dependsOn?.includes(extrudeId) ||
      features.some(f => ![extrudeId,cutId].includes(f.id) &&
        f.writeTargets?.includes(bodyId)))
    fail('explicit existing sketch/extrude/cut/body lineage required');
  const before=runtime.inspect(history);
  if (state(before,sketchId)?.status !== 'analytic_profile_only' ||
      state(before,extrudeId)?.status !== 'preview_only' ||
      state(before,cutId)?.status !== 'pending_exact_provider')
    fail('current sketch, extrusion and cut must be admitted by RUNTIME');
  const doc=sketch.validateSketch(source.payload.sketch);
  const solution=sketch.solveSketch(doc);
  if (solution?.status !== 'solved' || !solution.geometry)
    fail('actual solved SKETCH geometry required');
  exactFields(request.axis,['xMm','yMm','dx','dy'],'axis');
  const {xMm,yMm,dx,dy}=request.axis;
  if (![xMm,yMm,dx,dy].every(finite)) fail('finite mirror axis required');
  const length=Math.hypot(dx,dy);
  if (!Number.isFinite(length) || length === 0)
    fail('non-degenerate mirror axis required');
  const nx=-dy/length,ny=dx/length;
  if (!Array.isArray(request.copies) || request.copies.length<1 ||
      request.copies.length>16)
    fail('1-16 explicitly named mirrored holes required');
  if (!Array.isArray(doc.circles) || doc.circles.length+request.copies.length>64)
    fail('SKETCH cut profile supports at most 64 holes');
  const occupied=new Set([...doc.points,...doc.lines,...doc.circles,...doc.constraints]
    .map(x=>x.id));
  const originals=new Set(),targets=new Set(),reserved=new Set(),operations=[];
  for (const pair of request.copies) {
    exactFields(pair,['sourceHoleId','outputHoleId'],'source/copy selection');
    const from=identity(pair.sourceHoleId,'sourceHoleId');
    const to=identity(pair.outputHoleId,'outputHoleId');
    if (originals.has(from) || targets.has(to) || from===to)
      fail('repeated or aliased mirror selection');
    originals.add(from);targets.add(to);
    const derived=[to,to+':center',to+':fixed',to+':diameter'];
    if (derived.some(id=>occupied.has(id)||reserved.has(id)))
      fail('copy identity or derived entity already occupied');
    derived.forEach(id=>reserved.add(id));
    const authored=doc.circles.find(c=>c.id===from);
    const circle=solution.geometry.circles?.find(c=>c.id===from);
    const centre=solution.geometry.points?.find(p=>p.id===authored?.center);
    if (!authored || !circle || !centre ||
        ![centre.x,centre.y,circle.radius].every(finite) || circle.radius<=0)
      fail('selected circle lacks solved centre and positive radius');
    const ox=centre.x-xMm,oy=centre.y-yMm;
    const distance=ox*nx+oy*ny;
    const x=centre.x-2*distance*nx,y=centre.y-2*distance*ny;
    if (!finite(x) || !finite(y) || (x===centre.x && y===centre.y))
      fail('reflected circle is non-finite or coincident with source');
    operations.push({kind:'add',id:to,x,y,radius:circle.radius});
  }
  const result=runtime.editPlateHoles(history,{
    sketchFeatureId:sketchId,eventId,expectedRevision:request.expectedRevision,
    admission:'require_admissible',operations
  });
  if (result.kind==='refused') return {...result,mirrorCopies:operations,
    exactAuthority:false,independentInteroperability:false};
  if (result.kind!=='committed' ||
      state(result.report,sketchId)?.status!=='analytic_profile_only' ||
      state(result.report,cutId)?.status!=='pending_exact_provider')
    throw new Error('feature-ops mirror: RUNTIME did not retain admitted cut intent');
  return {kind:'committed',history:result.history,report:result.report,
    invalidation:result.invalidation,mirrorCopies:operations,
    semanticIds:{sketchId,extrudeId,cutId,bodyId},
    nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:cutId,
      bodyId,sourceRevision:result.history.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
