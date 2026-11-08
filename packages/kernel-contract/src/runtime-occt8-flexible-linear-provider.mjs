/**
 * Additive pinned C++ v6 consumer for a genuine selected SKETCH contour.
 * The authoritative INTENT journal may have an extrusion alone, or 1–16
 * dependency-ordered cut writers. No preview B-rep or guessed body target.
 */
import {requestFromRuntimeBodyCutChain} from './runtime-body-cut-chain-provider.mjs';
import {requestFromRuntimeProfile} from './runtime-profile-provider.mjs';
import {parseOcct8FlexibleLinearRequest} from './occt8-flexible-linear-v6.mjs';
import {runPinnedOcct8FlexibleLinear} from './local-occt8-flexible-linear-provider.mjs';

export const RUNTIME_OCCT8_FLEXIBLE_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const ensure=(v,msg)=>{if(!v)throw new TypeError('runtime flexible C++: '+msg)};
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);

function vertices(profile,minimum,maximum,label) {
  ensure(Array.isArray(profile?.holes)&&profile.holes.length===0,
    label+' cannot contain islands');
  const edges=profile.boundary;
  ensure(Array.isArray(edges)&&edges.length>=minimum&&edges.length<=maximum&&
    edges.every(e=>e?.kind==='line'&&e.start&&e.end),
    label+' requires a solved selected line-wire');
  const v=edges.map(e=>({x:e.start.x,y:e.start.y}));
  ensure(edges.every((e,i)=>near(e.end.x,v[(i+1)%v.length].x)&&
    near(e.end.y,v[(i+1)%v.length].y)),label+' must close');
  const area=v.reduce((sum,p,i)=>{const b=v[(i+1)%v.length];
    return sum+p.x*b.y-b.x*p.y;},0)/2;
  ensure(near(area,profile.signedBoundaryAreaMm2)&&area>1e-6,
    label+' material area disagrees with solved SKETCH');
  return v;
}
function rectangle(profile,label) {
  const v=vertices(profile,4,4,label);
  const xs=v.map(p=>p.x),ys=v.map(p=>p.y);
  const xmin=Math.min(...xs),xmax=Math.max(...xs);
  const ymin=Math.min(...ys),ymax=Math.max(...ys);
  const width=xmax-xmin,depth=ymax-ymin;
  const corners=[{x:xmin,y:ymin},{x:xmax,y:ymin},
    {x:xmax,y:ymax},{x:xmin,y:ymax}];
  ensure(width>=1e-6&&depth>=1e-6&&
    v.some((_,offset)=>v.every((point,i)=>
      near(point.x,corners[(i+offset)%4].x)&&
      near(point.y,corners[(i+offset)%4].y))),
    label+' must be an actual axis-aligned rectangular SKETCH');
  return {kind:'rectangle',x:(xmin+xmax)/2,y:(ymin+ymax)/2,width,depth};
}
export function requestFromRuntimeOcct8Flexible(history,targetBodyId,{
  runtime,model,requestId,exportStep=true,
}={}) {
  ensure(history?.document&&Number.isSafeInteger(history.document.revision)&&
    history.document.revision>=0&&
    typeof runtime?.inspect==='function'&&
    typeof model?.featuresOf==='function','fresh runtime history required');
  ensure(typeof targetBodyId==='string'&&ID.test(targetBodyId)&&
    typeof requestId==='string'&&ID.test(requestId)&&
    typeof exportStep==='boolean','invalid body/request identity or export');
  const features=model.featuresOf(history.document);
  ensure(Array.isArray(features)&&!features.some(f=>
    f.kind==='cut'&&f.payload?.targetBodyId===targetBodyId&&
    (f.writeTargets?.length!==1||f.writeTargets[0]!==targetBodyId)),
    'no cut may claim this body without a matching writer target');
  const writers=features.filter(f=>f.writeTargets?.includes(targetBodyId));
  const bases=writers.filter(f=>f.kind==='extrude'&&f.writeTargets?.length===1);
  ensure(bases.length===1&&writers.length>=1&&writers.length<=17,
    'unique target extrusion and at most sixteen cuts required');
  const base=bases[0];
  ensure(typeof base.payload?.sourceSketchId==='string'&&
    ID.test(base.payload.sourceSketchId),'missing selected source SKETCH ID');
  // The zero-cut path must retain exactly the same source dependency,
  // selected local frame and millimetre semantics as the cut-chain path.
  // Otherwise a stale or untracked source SKETCH could be exported as a
  // current native body without being invalidated by retrospective edits.
  ensure(base.payload?.units==='mm'&&base.payload?.frame==='local_xy'&&
    Array.isArray(base.dependsOn)&&
    base.dependsOn.includes(base.payload.sourceSketchId)&&
    base.writeTargets?.length===1&&base.writeTargets[0]===targetBodyId,
    'base extrusion must depend on its selected local-mm SKETCH and target body');
  let source,cutEntries;
  if(writers.length===1){
    // Directly consume the accepted RUNTIME/INTENT solved extrusion report.
    // The older cut-chain adapter intentionally refuses a body without cuts.
    const report=runtime.inspect(history);
    ensure(report?.projectId===history.document.projectId&&
      report.revision===history.document.revision&&
      report.exactGeometryAvailable===false,
      'stale or invented RUNTIME report');
    source=requestFromRuntimeProfile(report,base.id,{
      requestId:requestId+'.base',exportStep:false});
    ensure(source.semanticBodyId===targetBodyId,
      'selected source extrusion targets a different body');
    cutEntries=[];
  }else{
    const chain=requestFromRuntimeBodyCutChain(history,targetBodyId,{
      runtime,model,requestId,exportStep});
    source=chain.baseExtrude;
    cutEntries=chain.cuts.map(c=>({
      featureId:c.cutFeatureId,...rectangle(c.cutTool.profile,c.cutFeatureId),
      cutDepthMm:c.cutDepthMm,
    }));
  }
  return parseOcct8FlexibleLinearRequest({
    protocol:'intuit3d/kernel/flexible-linear-profile-v6',
    requestId,featureId:targetBodyId,revision:history.document.revision,
    units:'mm',exportStep,
    profile:{profileId:base.payload.sourceSketchId,
      thickness:source.thicknessMm,
      vertices:vertices(source.profile,3,64,'selected extrusion')},
    cuts:cutEntries,
  });
}
export async function runPinnedRuntimeOcct8Flexible(history,targetBodyId,{
  runtime,model,requestId,workerExecutable,readCurrentRevision,stepOutput,
  pythonExecutable,timeoutMs,signal,nativeSupervisor,
}={}) {
  const request=requestFromRuntimeOcct8Flexible(history,targetBodyId,{
    runtime,model,requestId,exportStep:stepOutput!==undefined,
  });
  const result=await runPinnedOcct8FlexibleLinear(request,{
    workerExecutable,readCurrentRevision,stepOutput,pythonExecutable,
    timeoutMs,signal,nativeSupervisor,
  });
  return Object.freeze({...result,semanticBodyId:targetBodyId,
    runtimeOcct8FlexibleVersion:RUNTIME_OCCT8_FLEXIBLE_VERSION,
    exactAuthority:false,independentInteroperability:false});
}
