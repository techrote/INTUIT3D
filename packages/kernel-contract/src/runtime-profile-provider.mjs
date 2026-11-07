/**
 * Bridge accepted RUNTIME's solved linear profile into the existing isolated
 * OCP 7.9.3.1 line/arc B-rep and STEP provider. No duplicate native kernel,
 * solver, journal, or claim of OCCT 8.0.1 production authority.
 * Separately authored cut features are NOT claimed as executed.
 */
import {runExperimentalArcExtrude} from './local-arc-profile-provider.mjs';
export const RUNTIME_PROFILE_PROVIDER_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const requireValue=(condition,reason)=>{if(!condition)throw new TypeError('runtime-profile provider: '+reason)};
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6;

/** Derive one request from the exact revision of RUNTIME.inspect(history). */
export function requestFromRuntimeProfile(report,extrudeFeatureId,{requestId,exportStep=true}={}){
  requireValue(report?.format==='intuit3d.workflow-runtime-evaluation'&&
    report.version===1&&report.exactGeometryAvailable===false&&
    Number.isSafeInteger(report.revision)&&report.revision>=0&&
    Array.isArray(report.features),'RUNTIME v1 evaluation report required');
  requireValue(typeof extrudeFeatureId==='string'&&ID.test(extrudeFeatureId),
    'valid extrude feature identity required');
  requireValue(typeof requestId==='string'&&ID.test(requestId),
    'valid request identity required');
  const extrude=report.features.find(f=>f.featureId===extrudeFeatureId);
  requireValue(extrude?.kind==='extrude'&&extrude.status==='preview_only'&&
    extrude.evidence==='sketch_analytic_only'&&
    typeof extrude.sourceSketchId==='string'&&
    typeof extrude.bodyId==='string'&&ID.test(extrude.bodyId)&&
    finite(extrude.thicknessMm)&&extrude.thicknessMm>=1e-6,
    'solved authored extrude, selected body and depth required');
  const sketch=report.features.find(f=>f.featureId===extrude.sourceSketchId);
  requireValue(sketch?.kind==='sketch'&&sketch.status==='analytic_profile_only'&&
    sketch.evidence==='sketch_analytic_only'&&
    typeof sketch.sketchSignature==='string'&&sketch.sketchSignature&&
    sketch.sketchSignature.length<=262144&&
    JSON.stringify(sketch.profile)===JSON.stringify(extrude.profile),
    'extrusion must consume an identical admitted sketch profile');
  const p=extrude.profile;
  requireValue(p?.status==='analytic_profile_only'&&p.units==='mm'&&
    Array.isArray(p.outer)&&p.outer.length>=4&&p.outer.length<=256&&
    Array.isArray(p.holes)&&p.holes.length<=64&&
    finite(p.areaMm2)&&p.areaMm2>0,
    'only bounded admitted linear polygon/circle profiles supported');
  const vertices=p.outer,ids=new Set(),boundary=[];
  let twiceArea=0;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    requireValue(typeof a?.id==='string'&&ID.test(a.id)&&!ids.has(a.id)&&
      finite(a.x)&&finite(a.y),'invalid solved boundary point');
    ids.add(a.id);
    requireValue(finite(b?.x)&&finite(b?.y)&&
      Math.hypot(a.x-b.x,a.y-b.y)>1e-8,'invalid or degenerate edge');
    twiceArea+=a.x*b.y-b.x*a.y;
    boundary.push({id:'edge'+i,kind:'line',start:{x:a.x,y:a.y},
      end:{x:b.x,y:b.y}});
  }
  const area=twiceArea/2;
  requireValue(Number.isFinite(area)&&area>1e-6,
    'solved boundary must be counterclockwise');
  const holeIds=new Set();
  const holes=p.holes.map(h=>{
    requireValue(typeof h?.id==='string'&&ID.test(h.id)&&
      typeof h.centerId==='string'&&ID.test(h.centerId)&&
      !holeIds.has(h.id)&&finite(h.x)&&finite(h.y)&&
      finite(h.radius)&&h.radius>=1e-6,'invalid admitted circle');
    holeIds.add(h.id);
    return {id:h.id,centerId:h.centerId,x:h.x,y:h.y,radiusMm:h.radius};
  });
  const material=area-holes.reduce((sum,h)=>sum+Math.PI*h.radiusMm**2,0);
  requireValue(material>0&&Math.abs(material-p.areaMm2)<=
    Math.max(1e-7,Math.abs(material)*1e-10),
    'solved profile area disagrees with selected polygon and holes');
  return Object.freeze({
    protocol:'intuit3d/kernel/arc-extrude-v1',
    requestId,featureId:extrudeFeatureId,revision:report.revision,units:'mm',
    thicknessMm:extrude.thicknessMm,exportStep,
    profile:{format:'intuit3d.analytic-arc-profile',version:1,
      id:extrudeFeatureId,sourceSignature:sketch.sketchSignature,
      units:'mm',status:'analytic_2d_validated_pending_native',
      // These source-admission flags derive only from RUNTIME's paired
      // SKETCH solve. They are not evidence of independent STEP import.
      providerSubmissionReady:true,globalSelfIntersectionChecked:true,
      holeContainmentChecked:true,nativeProfileAdmissible:false,
      stepQualified:false,boundary,holes,signedBoundaryAreaMm2:area,
      materialAreaMm2:material},
    semanticBodyId:extrude.bodyId
  });
}

/** Invoke the physical worker with all pre-existing process/STEP safety gates. */
export async function runExperimentalRuntimeProfile(report,extrudeFeatureId,{
  requestId,readCurrentRevision,stepOutput,pythonExecutable,timeoutMs,signal,workerScript
}={}){
  const mapped=requestFromRuntimeProfile(report,extrudeFeatureId,{requestId,
    exportStep:stepOutput!==undefined});
  const {semanticBodyId,...request}=mapped;
  const result=await runExperimentalArcExtrude(request,{
    readCurrentRevision,stepOutput,pythonExecutable,timeoutMs,signal,workerScript});
  return Object.freeze({...result,semanticBodyId,
    runtimeProfileProviderVersion:RUNTIME_PROFILE_PROVIDER_VERSION,
    experimentalOnly:true,exactAuthority:false,independentInteroperability:false});
}
