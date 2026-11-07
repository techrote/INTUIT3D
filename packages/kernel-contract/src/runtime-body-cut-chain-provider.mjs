/**
 * Journal-authored ordered cut chain -> ONE physical OCP solid/STEP.
 *
 * No timeline-order inference or second document authority. A downstream cut
 * may be RUNTIME blocked_dependency solely because its predecessor awaits the
 * native provider; its source SKETCH must nevertheless be solved and admitted.
 * This is an experimental OCP 7.9.3.1 bridge, not OCCT8 or independent CAD.
 */
import {requestFromRuntimeProfile} from './runtime-profile-provider.mjs';
import {runExperimentalBodyCut,validateBodyCutRequest}
  from './local-body-cut-provider.mjs';

export const RUNTIME_BODY_CUT_CHAIN_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const ensure=(ok,msg)=>{if(!ok)throw new TypeError('runtime cut chain: '+msg)};
const state=(report,id)=>report.features.find(f=>f.featureId===id);
const validId=value=>typeof value==='string'&&ID.test(value);

/** Adapt one admitted, counterclockwise, filled linear SKETCH without islands. */
function cutTool(report,sourceId,featureId,requestId,thicknessMm){
  const sketch=state(report,sourceId);
  ensure(sketch?.kind==='sketch'&&sketch.modelStatus==='ready'&&
    sketch.status==='analytic_profile_only'&&
    sketch.evidence==='sketch_analytic_only'&&
    typeof sketch.sketchSignature==='string'&&
    sketch.sketchSignature.length>0&&sketch.sketchSignature.length<=262144,
    'every cut needs an independently solved source sketch');
  const p=sketch.profile;
  ensure(p?.status==='analytic_profile_only'&&p.units==='mm'&&
    Array.isArray(p.outer)&&p.outer.length>=4&&p.outer.length<=256&&
    Array.isArray(p.holes)&&p.holes.length===0&&
    Number.isFinite(p.areaMm2)&&p.areaMm2>1e-6,
    'cut sketch needs one admitted filled profile without islands');
  const ids=new Set(),boundary=[];
  let twiceArea=0;
  for(let i=0;i<p.outer.length;i++){
    const a=p.outer[i],b=p.outer[(i+1)%p.outer.length];
    ensure(validId(a?.id)&&!ids.has(a.id)&&
      Number.isFinite(a.x)&&Number.isFinite(a.y)&&
      Math.abs(a.x)<=1e6&&Math.abs(a.y)<=1e6&&
      Number.isFinite(b?.x)&&Number.isFinite(b?.y)&&
      Math.abs(b.x)<=1e6&&Math.abs(b.y)<=1e6&&
      Math.hypot(b.x-a.x,b.y-a.y)>1e-8,
      'invalid solved cut vertex/edge');
    ids.add(a.id);
    boundary.push({id:'edge'+i,kind:'line',
      start:{x:a.x,y:a.y},end:{x:b.x,y:b.y}});
    twiceArea+=a.x*b.y-b.x*a.y;
  }
  const area=twiceArea/2;
  ensure(area>1e-6&&Math.abs(area-p.areaMm2)<=
    Math.max(1e-7,Math.abs(area)*1e-10),
    'cut source area differs from solved sketch');
  return {protocol:'intuit3d/kernel/arc-extrude-v1',featureId,requestId,
    revision:report.revision,units:'mm',thicknessMm,exportStep:false,
    profile:{format:'intuit3d.analytic-arc-profile',version:1,
      id:featureId,units:'mm',sourceSignature:sketch.sketchSignature,
      status:'analytic_2d_validated_pending_native',
      providerSubmissionReady:true,globalSelfIntersectionChecked:true,
      holeContainmentChecked:true,nativeProfileAdmissible:false,stepQualified:false,
      boundary,holes:[],signedBoundaryAreaMm2:area,materialAreaMm2:area}};
}

/** Determine real, direct dependency ordering; never sort by UI chronology. */
function orderedWriters(features,bodyId){
  const writers=features.filter(f=>f.writeTargets?.includes(bodyId));
  const bases=writers.filter(f=>f.kind==='extrude'&&
    f.writeTargets.length===1&&f.writeTargets[0]===bodyId);
  ensure(bases.length===1&&writers.length>=2&&writers.length<=17,
    'unique base extrusion and one to sixteen body cuts required');
  const cuts=writers.filter(f=>f!==bases[0]);
  ensure(cuts.every(f=>f.kind==='cut'&&f.writeTargets.length===1&&
    f.writeTargets[0]===bodyId&&f.payload?.targetBodyId===bodyId),
    'unsupported body writer or ambiguous target');
  const ordered=[],remaining=new Map(cuts.map(c=>[c.id,c]));
  ensure(remaining.size===cuts.length,'duplicate active writer identities');
  let previous=bases[0];
  while(remaining.size){
    const candidates=[...remaining.values()].filter(f=>
      f.dependsOn?.includes(previous.id)&&
      !f.dependsOn.some(id=>remaining.has(id)));
    ensure(candidates.length===1,'body writers are not one explicit dependency chain');
    const next=candidates[0];remaining.delete(next.id);
    ordered.push(next);previous=next;
  }
  return {base:bases[0],cuts:ordered};
}
function depthOf(cut,thickness){
  const p=cut.payload;
  // Historic FEATUREOPS cuts have no explicit extent and mean through-all.
  // INTENT body-cut-chain/v1 persists {throughAll:false,depthMm} for blind.
  if(p.throughAll===true||p.throughAll===undefined&&p.depthMm===undefined)
    return thickness;
  ensure(p.throughAll===false&&typeof p.depthMm==='number'&&
    Number.isFinite(p.depthMm)&&p.depthMm>=1e-6&&p.depthMm<=thickness,
    'blind depth must lie within the current extrusion thickness');
  return p.depthMm;
}

/**
 * Convert committed INTENT/RUNTIME geometry to local-body-cut-chain-v3.
 * Accept blocked_dependency on later cuts ONLY with an explicit fully ordered
 * active body chain, ready semantic cut, and independently admitted SKETCH.
 */
export function requestFromRuntimeBodyCutChain(history,targetBodyId,{
  runtime,model,requestId,exportStep=true
}={}){
  ensure(history?.document&&Number.isSafeInteger(history.document.revision)&&
    history.document.revision>=0,'authoritative current history required');
  ensure(typeof runtime?.inspect==='function'&&typeof model?.featuresOf==='function',
    'accepted RUNTIME and INTENT services required');
  ensure(validId(targetBodyId)&&validId(requestId)&&
    validId(requestId+'.base')&&typeof exportStep==='boolean',
    'target/request IDs and export selection required');
  const report=runtime.inspect(history);
  ensure(report?.format==='intuit3d.workflow-runtime-evaluation'&&
    report.version===1&&report.exactGeometryAvailable===false&&
    report.projectId===history.document.projectId&&
    report.revision===history.document.revision&&Array.isArray(report.features),
    'fresh exact-revision RUNTIME evaluation required');
  const features=model.featuresOf(history.document);
  ensure(Array.isArray(features),'active INTENT features required');
  const {base,cuts}=orderedWriters(features,targetBodyId);
  ensure(validId(base.id)&&base.payload?.sourceSketchId&&
    base.payload?.units==='mm'&&base.payload?.frame==='local_xy'&&
    base.dependsOn?.includes(base.payload.sourceSketchId),
    'base extrusion needs a named admitted SKETCH dependency');
  const initial=requestFromRuntimeProfile(report,base.id,{
    requestId:requestId+'.base',exportStep:false});
  ensure(initial.semanticBodyId===targetBodyId,'base and target body must match');
  const {semanticBodyId, ...baseExtrude}=initial;
  const existingIds=new Set(features.map(f=>f.id));
  const used=new Set([requestId,baseExtrude.requestId,base.id]);
  const entries=cuts.map((cut,index)=>{
    const sketchId=cut.payload?.sourceSketchId;
    const featureId=cut.id+'.tool',toolRequestId=requestId+'.tool'+index;
    ensure(validId(cut.id)&&validId(sketchId)&&
      validId(featureId)&&validId(toolRequestId)&&
      !existingIds.has(featureId)&&!existingIds.has(requestId)&&
      !existingIds.has(toolRequestId)&&
      cut.payload?.units==='mm'&&cut.payload?.frame==='local_xy'&&
      cut.dependsOn?.includes(sketchId)&&
      sketchId!==base.payload.sourceSketchId&&
      features.find(f=>f.id===sketchId)?.kind==='sketch',
      'cut must reference a separate authored source SKETCH and unique tool');
    const evaluated=state(report,cut.id);
    ensure(evaluated?.kind==='cut'&&evaluated.modelStatus==='ready'&&
      ['pending_exact_provider','blocked_dependency'].includes(evaluated.status),
      'cut must be semantically ready, even if its native predecessor is pending');
    for(const id of [cut.id,featureId,toolRequestId]){
      ensure(!used.has(id),'cut/tool/request identity collision');used.add(id);
    }
    return {cutFeatureId:cut.id,
      cutDepthMm:depthOf(cut,baseExtrude.thicknessMm),
      cutTool:cutTool(report,sketchId,featureId,toolRequestId,
        baseExtrude.thicknessMm)};
  });
  return validateBodyCutRequest({
    protocol:'intuit3d/kernel/profile-body-cut-chain-v3',
    requestId,targetBodyId,revision:report.revision,units:'mm',
    baseExtrude,cuts:entries,exportStep});
}

/** Real isolated OCP Boolean chain + same-engine STEP, never model authority. */
export async function runExperimentalRuntimeBodyCutChain(history,targetBodyId,{
  runtime,model,requestId,readCurrentRevision,stepOutput,
  pythonExecutable,workerScript,timeoutMs,signal
}={}){
  const q=requestFromRuntimeBodyCutChain(history,targetBodyId,{
    runtime,model,requestId,exportStep:stepOutput!==undefined});
  const result=await runExperimentalBodyCut(q,{
    readCurrentRevision,stepOutput,pythonExecutable,workerScript,timeoutMs,signal});
  return Object.freeze({...result,
    runtimeBodyCutChainVersion:RUNTIME_BODY_CUT_CHAIN_VERSION,
    experimentalOnly:true,exactAuthority:false,independentInteroperability:false});
}
