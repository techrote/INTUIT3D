/**
 * Real selected, solved rectilinear SKETCH (including stepped/U profiles) and
 * journal-ordered cuts -> a pinned C++ OCCT8 worker. No bounding-box L
 * synthesis, guessed face selection or alternate document authority.
 */
import {requestFromRuntimeBodyCutChain} from './runtime-body-cut-chain-provider.mjs';
import {parseOcct8OrthogonalProfileRequest}
  from './occt8-orthogonal-profile-v4.mjs';
import {runPinnedOcct8OrthogonalProfileChain}
  from './local-occt8-orthogonal-profile-provider.mjs';

export const RUNTIME_OCCT8_ORTHOGONAL_VERSION=1;
const requireSource=(ok,why)=>{
  if(!ok)throw new TypeError('runtime pinned orthogonal profile: '+why);
};
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
function vertices(profile,countMin,countMax,label) {
  requireSource(Array.isArray(profile?.holes)&&profile.holes.length===0,
    label+' must have no profile islands');
  const edges=profile.boundary;
  requireSource(Array.isArray(edges)&&edges.length>=countMin&&
    edges.length<=countMax&&edges.every(e=>e?.kind==='line'&&e.start&&e.end),
    label+' must be a solved straight-edge closed contour');
  const v=edges.map(e=>({x:e.start.x,y:e.start.y}));
  requireSource(edges.every((e,i)=>near(e.end.x,v[(i+1)%v.length].x)&&
    near(e.end.y,v[(i+1)%v.length].y)),label+' must be closed');
  const area=v.reduce((s,p,i)=>{
    const b=v[(i+1)%v.length];return s+p.x*b.y-b.x*p.y;
  },0)/2;
  requireSource(near(area,profile.signedBoundaryAreaMm2)&&area>1e-6,
    label+' area differs from actual solved SKETCH');
  return v;
}
function rectangle(profile,label) {
  const v=vertices(profile,4,4,label);
  const xs=v.map(p=>p.x),ys=v.map(p=>p.y);
  const xmin=Math.min(...xs),xmax=Math.max(...xs);
  const ymin=Math.min(...ys),ymax=Math.max(...ys);
  const width=xmax-xmin,depth=ymax-ymin;
  const expected=[
    {x:xmin,y:ymin},{x:xmax,y:ymin},
    {x:xmax,y:ymax},{x:xmin,y:ymax},
  ];
  requireSource(width>=1e-6&&depth>=1e-6&&
    v.some((_,shift)=>v.every((p,i)=>near(p.x,expected[(i+shift)%4].x)&&
      near(p.y,expected[(i+shift)%4].y))),
    label+' must be a filled axis-aligned rectangle');
  return {kind:'rectangle',x:(xmin+xmax)/2,y:(ymin+ymax)/2,width,depth};
}
export function requestFromRuntimeOcct8Orthogonal(history,targetBodyId,{
  runtime,model,requestId,exportStep=true,
}={}) {
  const authored=requestFromRuntimeBodyCutChain(history,targetBodyId,{
    runtime,model,requestId,exportStep,
  });
  const boundary=vertices(authored.baseExtrude.profile,6,64,'base contour');
  const cuts=authored.cuts.map(c=>({
    featureId:c.cutFeatureId,...rectangle(c.cutTool.profile,c.cutFeatureId),
    cutDepthMm:c.cutDepthMm,
  }));
  const source=model.featuresOf(history.document).filter(f=>
    f.kind==='extrude'&&f.writeTargets?.length===1&&
    f.writeTargets[0]===targetBodyId);
  requireSource(source.length===1&&
    typeof source[0].payload?.sourceSketchId==='string',
    'selected source SKETCH identity missing');
  return parseOcct8OrthogonalProfileRequest({
    protocol:'intuit3d/kernel/orthogonal-profile-cut-chain-v4',
    requestId:authored.requestId,featureId:targetBodyId,
    revision:authored.revision,units:'mm',exportStep:authored.exportStep,
    profile:{profileId:source[0].payload.sourceSketchId,
      thickness:authored.baseExtrude.thicknessMm,vertices:boundary},
    cuts,
  });
}
export async function runPinnedRuntimeOcct8Orthogonal(history,targetBodyId,{
  runtime,model,requestId,workerExecutable,readCurrentRevision,stepOutput,
  pythonExecutable,timeoutMs,signal,nativeSupervisor,
}={}) {
  const request=requestFromRuntimeOcct8Orthogonal(history,targetBodyId,{
    runtime,model,requestId,exportStep:stepOutput!==undefined,
  });
  const result=await runPinnedOcct8OrthogonalProfileChain(request,{
    workerExecutable,readCurrentRevision,stepOutput,
    pythonExecutable,timeoutMs,signal,nativeSupervisor,
  });
  return Object.freeze({...result,semanticBodyId:targetBodyId,
    runtimeOcct8OrthogonalVersion:RUNTIME_OCCT8_ORTHOGONAL_VERSION,
    exactAuthority:false,independentInteroperability:false});
}
