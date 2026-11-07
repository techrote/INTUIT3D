/**
 * Node-only, non-authoritative bridge from a LIVE INTENT history and accepted
 * RUNTIME/SKETCH evaluation to the isolated OCP body-cut worker. The separate
 * cut's target body, source sketch and dependencies are authored journal facts;
 * the physical result never becomes a second model authority.
 */
import {requestFromRuntimeProfile} from './runtime-profile-provider.mjs';
import {runExperimentalBodyCut,validateBodyCutRequest} from './local-body-cut-provider.mjs';

export const RUNTIME_BODY_CUT_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const ok=(condition,detail)=>{if(!condition)throw new TypeError('runtime body cut: '+detail)};
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e6;
const feature=(report,id)=>report.features.find(f=>f.featureId===id);

/** Convert an actually admitted RUNTIME sketch, not the authored seed points. */
function cutterFromSketch(report,sketchId,{featureId,requestId,thicknessMm}){
  const source=feature(report,sketchId);
  ok(source?.kind==='sketch'&&source.modelStatus==='ready'&&
    source.status==='analytic_profile_only'&&
    source.evidence==='sketch_analytic_only'&&
    typeof source.sketchSignature==='string'&&source.sketchSignature.length>0&&
    source.sketchSignature.length<=262144,
    'cut source must be a solved, admitted sketch');
  const p=source.profile;
  ok(p?.status==='analytic_profile_only'&&p.units==='mm'&&
    Array.isArray(p.outer)&&p.outer.length>=4&&p.outer.length<=256&&
    Array.isArray(p.holes)&&p.holes.length===0&&
    finite(p.areaMm2)&&p.areaMm2>1e-6,
    'cut sketch must be a single planar filled profile without islands');
  const ids=new Set(),boundary=[];
  let twiceArea=0;
  for(let i=0;i<p.outer.length;i++){
    const v=p.outer[i],n=p.outer[(i+1)%p.outer.length];
    ok(typeof v?.id==='string'&&ID.test(v.id)&&!ids.has(v.id)&&
      finite(v.x)&&finite(v.y)&&finite(n?.x)&&finite(n?.y)&&
      Math.hypot(n.x-v.x,n.y-v.y)>1e-8,
      'invalid solved cut boundary');
    ids.add(v.id);
    boundary.push({id:'edge'+i,kind:'line',
      start:{x:v.x,y:v.y},end:{x:n.x,y:n.y}});
    twiceArea+=v.x*n.y-n.x*v.y;
  }
  const signedArea=twiceArea/2;
  ok(signedArea>1e-6&&Math.abs(signedArea-p.areaMm2)<=
    Math.max(1e-7,Math.abs(signedArea)*1e-10),
    'solved cut area disagrees with admitted RUNTIME sketch');
  return {
    protocol:'intuit3d/kernel/arc-extrude-v1',requestId,featureId,
    revision:report.revision,units:'mm',thicknessMm,exportStep:false,
    profile:{format:'intuit3d.analytic-arc-profile',version:1,
      id:featureId,sourceSignature:source.sketchSignature,units:'mm',
      status:'analytic_2d_validated_pending_native',
      providerSubmissionReady:true,globalSelfIntersectionChecked:true,
      holeContainmentChecked:true,nativeProfileAdmissible:false,
      stepQualified:false,boundary,holes:[],
      signedBoundaryAreaMm2:signedArea,materialAreaMm2:signedArea}
  };
}

/**
 * Only supports explicit, separately authored cut sketches on a single
 * previously extruded body. Unsupported multi-body/associative cuts fail
 * before spawning a worker. RUNTIME currently reports the cut as pending.
 */
export function requestFromRuntimeBodyCut(history,cutFeatureId,{
  runtime,model,requestId,exportStep=true
}={}){
  ok(history?.document&&Number.isSafeInteger(history.document.revision)&&
    history.document.revision>=0,'authoritative undo history required');
  ok(typeof runtime?.inspect==='function'&&typeof model?.featuresOf==='function',
    'accepted RUNTIME and INTENT services required');
  ok(typeof cutFeatureId==='string'&&ID.test(cutFeatureId)&&
    typeof requestId==='string'&&ID.test(requestId)&&
    typeof exportStep==='boolean','cut/request IDs and export selection required');
  const report=runtime.inspect(history);
  ok(report?.format==='intuit3d.workflow-runtime-evaluation'&&report.version===1&&
    report.exactGeometryAvailable===false&&report.revision===history.document.revision&&
    report.projectId===history.document.projectId&&Array.isArray(report.features),
    'fresh exact-revision RUNTIME evaluation required');
  const sources=model.featuresOf(history.document);
  ok(Array.isArray(sources),'authoritative model feature list required');
  const cut=sources.find(f=>f.id===cutFeatureId);
  const evaluated=feature(report,cutFeatureId);
  ok(cut?.kind==='cut'&&evaluated?.kind==='cut'&&
    evaluated.modelStatus==='ready'&&evaluated.status==='pending_exact_provider'&&
    cut.writeTargets?.length===1&&cut.payload?.targetBodyId===cut.writeTargets[0]&&
    typeof cut.payload?.sourceSketchId==='string'&&
    cut.payload?.units==='mm'&&cut.payload?.frame==='local_xy',
    'pending explicit cut and its target body required');
  const sketchId=cut.payload.sourceSketchId,bodyId=cut.payload.targetBodyId;
  ok(ID.test(sketchId)&&ID.test(bodyId),'invalid target and sketch identities');
  const owners=sources.filter(f=>f.kind==='extrude'&&f.writeTargets?.length===1&&
    f.writeTargets[0]===bodyId);
  ok(owners.length===1,'exactly one authored base extrusion required');
  const base=owners[0];
  ok(base.id!==cutFeatureId&&cut.dependsOn?.includes(base.id)&&
    cut.dependsOn?.includes(sketchId)&&
    sources.find(f=>f.id===sketchId)?.kind==='sketch'&&
    base.payload?.sourceSketchId!==sketchId&&
    base.payload?.units==='mm'&&base.payload?.frame==='local_xy'&&
    sources.filter(f=>f.writeTargets?.includes(bodyId)).every(
      f=>f.id===base.id||f.id===cutFeatureId),
    'separate cut sketch, correct dependency DAG and sole target writers required');
  const toolId=cutFeatureId+'.tool';
  ok(ID.test(toolId)&&!sources.some(f=>f.id===toolId)&&
    !sources.some(f=>f.id===requestId),'generated tool/request must not alias model features');
  const original=requestFromRuntimeProfile(report,base.id,{
    requestId:requestId+'.base',exportStep:false});
  ok(original.semanticBodyId===bodyId&&ID.test(requestId+'.base')&&
    ID.test(requestId+'.tool'),'base body or generated request ID mismatch');
  const {semanticBodyId,...baseExtrude}=original;
  const cutTool=cutterFromSketch(report,sketchId,{
    featureId:toolId,requestId:requestId+'.tool',
    thicknessMm:baseExtrude.thicknessMm});
  const request={protocol:'intuit3d/kernel/profile-body-cut-v1',
    requestId,cutFeatureId,targetBodyId:bodyId,revision:report.revision,
    units:'mm',baseExtrude,cutTool,exportStep};
  return validateBodyCutRequest(request);
}

/** No journal mutation: revision-fence again at physical STEP publication. */
export async function runExperimentalRuntimeBodyCut(history,cutFeatureId,{
  runtime,model,requestId,readCurrentRevision,stepOutput,
  pythonExecutable,workerScript,timeoutMs,signal
}={}){
  const request=requestFromRuntimeBodyCut(history,cutFeatureId,{
    runtime,model,requestId,exportStep:stepOutput!==undefined});
  const result=await runExperimentalBodyCut(request,{
    readCurrentRevision,stepOutput,pythonExecutable,workerScript,timeoutMs,signal});
  return Object.freeze({...result,runtimeBodyCutVersion:RUNTIME_BODY_CUT_VERSION,
    experimentalOnly:true,exactAuthority:false,independentInteroperability:false});
}

/** A journal-authored through-all cut whose *actual* rectangle overlaps the
 * perimeter. Uses the same authoritative INTENT/RUNTIME/SKETCH evidence as
 * v1; choosing a bounded native intersection oracle does not edit the journal.
 * The through-all depth is taken from the actual authored base extrusion.
 */
export function requestFromRuntimePerimeterNotch(history,cutFeatureId,options={}){
  const original=requestFromRuntimeBodyCut(history,cutFeatureId,options);
  return validateBodyCutRequest({...original,
    protocol:'intuit3d/kernel/profile-body-notch-v4',
    cutDepthMm:original.baseExtrude.thicknessMm});
}

/** One isolated real OCP Boolean, never a second document authority. */
export async function runExperimentalRuntimePerimeterNotch(history,cutFeatureId,{
  runtime,model,requestId,readCurrentRevision,stepOutput,
  pythonExecutable,workerScript,timeoutMs,signal
}={}){
  const request=requestFromRuntimePerimeterNotch(history,cutFeatureId,{
    runtime,model,requestId,exportStep:stepOutput!==undefined});
  const result=await runExperimentalBodyCut(request,{
    readCurrentRevision,stepOutput,pythonExecutable,workerScript,timeoutMs,signal});
  return Object.freeze({...result,runtimePerimeterNotchVersion:1,
    experimentalOnly:true,exactAuthority:false,independentInteroperability:false});
}
