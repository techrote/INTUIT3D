/**
 * RUNTIME -> KERNEL experimental plate v1 adapter.
 * Deliberately not a general feature evaluator or a source of B-rep truth.
 * The trusted host supplies the Node-only provider. Browser builds need no Node APIs.
 */
export const EXPERIMENTAL_PLATE_WORKFLOW_FORMAT = 'intuit3d.workflow-experimental-plate';
export const EXPERIMENTAL_PLATE_WORKFLOW_VERSION = 1;

function message(error) { return error instanceof Error ? error.message : 'non-Error provider failure'; }
function unresolved(code, reason, context = {}) {
  return {format:EXPERIMENTAL_PLATE_WORKFLOW_FORMAT,
    version:EXPERIMENTAL_PLATE_WORKFLOW_VERSION, kind:'unresolved', code, reason,
    exactAuthority:false, independentInteroperability:false, artifact:null, ...context};
}

/**
 * Only an axis-aligned four-corner rectangular profile can be mapped to the
 * *centred* plate-v1 research worker. An arbitrary SKETCH polygon is NOT a box.
 * Geometric validation (holes, coordinate range and contact) is subsequently
 * repeated by the public KERNEL parsePlateRequest boundary.
 */
export function rectanglePlateFromProfile(profile, thicknessMm) {
  if (profile?.status !== 'analytic_profile_only' || profile.units !== 'mm' ||
      !Array.isArray(profile.outer) || profile.outer.length !== 4 ||
      !Array.isArray(profile.holes) || !profile.holes.length ||
      typeof thicknessMm !== 'number' || !Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    throw new TypeError('runtime plate: requires positive extrude and rectangular analytic profile with holes');
  }
  const vertices = profile.outer;
  if (vertices.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new TypeError('runtime plate: invalid profile vertices');
  const xs=vertices.map(p=>p.x), ys=vertices.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const width=maxX-minX, depth=maxY-minY;
  if (!(width>0 && depth>0 && Number.isFinite(width) && Number.isFinite(depth)))
    throw new TypeError('runtime plate: degenerate outer rectangle');
  const corners = new Set(vertices.map(p=>String(p.x===minX?0:p.x===maxX?1:'x') + ':' + String(p.y===minY?0:p.y===maxY?1:'y')));
  if (corners.size !== 4 || [...corners].some(x=>x.includes('x') || x.includes('y')) ||
      vertices.some((p,i)=>{
        const next=vertices[(i+1)%4];
        return (p.x===next.x)===(p.y===next.y); // neither axis-aligned nor a nonzero edge
      })) throw new TypeError('runtime plate: arbitrary or rotated polygon not supported by plate-v1');
  const centerX=minX + width/2, centerY=minY + depth/2;
  return {width,depth,thickness:thicknessMm,holes:profile.holes.map(h=>({
    x:h.x-centerX, y:h.y-centerY, radius:h.radius,
  }))};
}

/**
 * Adapts actual INTENT+SKETCH runtime states to the experimental Node provider.
 * The client owns readCurrentHistory and (optionally) STEP destination. No
 * synthetic result can become a validated exact or independent STEP claim.
 */
export function createExperimentalPlateWorkflow({runtime, model, plateContract, runExperimentalPlate}) {
  if (typeof runtime?.inspect !== 'function' || typeof model?.featuresOf !== 'function' ||
      typeof plateContract?.parsePlateRequest !== 'function' ||
      typeof plateContract?.PLATE_PROTOCOL !== 'string' ||
      typeof runExperimentalPlate !== 'function')
    throw new TypeError('runtime plate: actual runtime, model, plate contract and host provider required');

  async function evaluate(history,{cutFeatureId,requestId,readCurrentHistory,exportStep=false,
    stepOutput,timeoutMs=25000,signal}={}) {
    if (typeof readCurrentHistory !== 'function')
      throw new TypeError('runtime plate: live authoritative history reader required');
    if (typeof cutFeatureId !== 'string' || !cutFeatureId || typeof requestId !== 'string' || !requestId)
      throw new TypeError('runtime plate: explicit cut and request identity required');
    const report = runtime.inspect(history);
    const context={projectId:report.projectId,revision:report.revision,cutFeatureId};
    const currentSnapshot=JSON.stringify(report);
    const isCurrent=()=>{
      try {
        const live=readCurrentHistory();
        return live?.document?.projectId===report.projectId &&
          live.document.revision===report.revision &&
          JSON.stringify(runtime.inspect(live))===currentSnapshot;
      } catch { return false; }
    };
    if (!isCurrent()) return unresolved('stale_revision','source no longer matches authoritative history',context);
    if (signal?.aborted) return unresolved('cancelled','execution cancelled before dispatch',context);

    const features=model.featuresOf(history.document);
    const byId=new Map(features.map(f=>[f.id,f]));
    const state=new Map(report.features.map(f=>[f.featureId,f]));
    const cut=byId.get(cutFeatureId);
    if (!cut || cut.kind!=='cut' || state.get(cutFeatureId)?.status!=='pending_exact_provider')
      return unresolved('source_unavailable','cut is not an admitted pending exact-provider operation',context);
    const candidates=features.filter(f=>f.kind==='extrude' && cut.dependsOn?.includes(f.id) &&
      f.writeTargets?.length===1 && f.writeTargets[0]===cut.payload?.targetBodyId);
    if (candidates.length!==1)
      return unresolved('unsupported_feature','cut requires one explicitly dependent plate extrude',context);
    const extrude=candidates[0], bodyId=extrude.writeTargets[0], sketchId=extrude.payload?.sourceSketchId;
    if (state.get(extrude.id)?.status!=='preview_only' ||
        cut.payload?.sourceSketchId!==sketchId ||
        !Array.isArray(cut.writeTargets) || cut.writeTargets.length!==1 || cut.writeTargets[0]!==bodyId ||
        !cut.dependsOn.includes(extrude.id) ||
        features.some(f=>f.id!==cut.id && f.id!==extrude.id && f.writeTargets?.includes(bodyId)))
      return unresolved('unsupported_feature','cut/extrude body, sketch or write authority is incompatible',context);
    const preview=state.get(extrude.id);
    if (!preview.profile?.holes?.length ||
        state.get(sketchId)?.status!=='analytic_profile_only')
      return unresolved('source_unavailable','cut requires admitted circular holes in a solved profile',context);
    let request;
    try {
      const plate=rectanglePlateFromProfile(preview.profile,preview.thicknessMm);
      request=plateContract.parsePlateRequest({protocol:plateContract.PLATE_PROTOCOL,
        requestId,featureId:cutFeatureId,revision:report.revision,units:'mm',
        plate,exportStep});
    } catch (error) { return unresolved('unsupported_profile',message(error),context); }
    // Recheck immediately before dispatch; KERNEL also fences before and after
    // native work and at exclusive STEP publication. A mismatching model with
    // unchanged revision must never receive a false current-revision response.
    if (!isCurrent()) return unresolved('stale_revision','source edited before dispatch',context);
    const revisionForProvider=()=>isCurrent()?report.revision:
      (report.revision===Number.MAX_SAFE_INTEGER?0:report.revision+1);
    let result;
    try {
      result=await runExperimentalPlate(request,{readCurrentRevision:revisionForProvider,
        ...(exportStep?{stepOutput}:{}),timeoutMs,signal});
    } catch (error) {return unresolved('worker_crash',message(error),context);}
    if (!isCurrent()) return unresolved('stale_revision','source edited while evaluating',context);
    if (signal?.aborted) return unresolved('cancelled','execution cancelled',context);
    if (result?.kind==='unresolved') return unresolved(result.code||'requires_reconciliation',
      result.reason||'experimental provider refused evaluation',context);
    // Only the trusted local-plate-provider may produce positive *experimental*
    // evidence. Its reported status is NOT product exactness or STEP conformance.
    if (result?.kind!=='experimental_report' || result.requestId!==requestId ||
        result.featureId!==cutFeatureId || result.revision!==report.revision ||
        result.backend!==plateContract.EXPERIMENTAL_BACKEND ||
        result.occtVersion!==plateContract.EXPERIMENTAL_OCCT_VERSION ||
        result.exactAuthority!==false || result.independentInteroperability!==false ||
        (exportStep ? result.artifact?.verification!=='same_engine_step_readback':result.artifact!==null))
      return unresolved('requires_reconciliation','invalid or nonexperimental provider reply',context);
    return {format:EXPERIMENTAL_PLATE_WORKFLOW_FORMAT,
      version:EXPERIMENTAL_PLATE_WORKFLOW_VERSION, kind:'experimental_plate_evaluated',
      ...context, extrudeFeatureId:extrude.id,sourceSketchId:sketchId,bodyId,
      intendedPlate:request.plate,requestId,
      backend:result.backend,occtVersion:result.occtVersion,
      observed:result.observed,artifact:result.artifact,
      exactAuthority:false,independentInteroperability:false,
      note:'Real experimental OCP plate+bores only; no independent STEP or production exact authority'};
  }
  return Object.freeze({evaluate});
}
