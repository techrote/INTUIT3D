/**
 * An actual RUNTIME/INTENT solved and selected six-edge L profile plus
 * an explicitly dependency-ordered writer chain -> pinned OCCT 8.0.1 worker.
 *
 * This provider does NOT invent an L from a bounding box: all six edges,
 * concave corner, sketch admission and body-writer dependencies must agree.
 * Current pinned v3 only supports a centered left-leg/bottom-foot L with
 * rectangular authored cut profiles. Other poses stay pending.
 */
import {requestFromRuntimeBodyCutChain} from './runtime-body-cut-chain-provider.mjs';
import {parseOcct8LProfileRequest} from './occt8-l-profile-v3.mjs';
import {runPinnedOcct8LProfileChain} from './local-occt8-l-profile-provider.mjs';

export const RUNTIME_OCCT8_L_PROFILE_VERSION=1;
const demand=(ok,why)=>{
  if(!ok)throw new TypeError('pinned OCCT8 runtime L profile: '+why);
};
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
const equal=(a,b)=>near(a.x,b.x)&&near(a.y,b.y);

function vertices(profile,count,label) {
  const edges=profile?.boundary;
  demand(Array.isArray(edges)&&edges.length===count&&
    edges.every(e=>e?.kind==='line'&&e.start&&e.end),
    label+' requires '+count+' solved straight boundary edges');
  const pts=edges.map(e=>e.start);
  demand(pts.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),
    label+' has nonfinite boundary');
  demand(edges.every((e,i)=>equal(e.end,pts[(i+1)%count])&&
    !equal(e.start,e.end)&&
    (near(e.start.x,e.end.x)!==near(e.start.y,e.end.y))),
    label+' is unclosed, diagonal or degenerate');
  const area=pts.reduce((sum,p,i)=>{
    const b=pts[(i+1)%count];return sum+p.x*b.y-b.x*p.y;
  },0)/2;
  demand(area>1e-6&&near(area,profile.signedBoundaryAreaMm2),
    label+' must match its positive solved sketch area');
  return {pts,area};
}
function bounds(pts) {
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const xmin=Math.min(...xs),xmax=Math.max(...xs);
  const ymin=Math.min(...ys),ymax=Math.max(...ys);
  return {xmin,xmax,ymin,ymax,width:xmax-xmin,depth:ymax-ymin};
}
function sourceL(profile) {
  demand(profile?.holes?.length===0,'base L profile with islands unsupported');
  const {pts,area}=vertices(profile,6,'base L');
  const {xmin,xmax,ymin,ymax,width,depth}=bounds(pts);
  demand(width>=1e-6&&depth>=1e-6&&near(xmin,-xmax)&&near(ymin,-ymax),
    'v3 C++ requires centered local XY L profile');
  const inner=pts.filter(p=>p.x>xmin&&p.x<xmax&&p.y>ymin&&p.y<ymax);
  demand(inner.length===1,'expected exactly one concave L corner');
  const legWidth=inner[0].x-xmin,footHeight=inner[0].y-ymin;
  const expected=[
    {x:xmin,y:ymin},{x:xmax,y:ymin},
    {x:xmax,y:inner[0].y},{x:inner[0].x,y:inner[0].y},
    {x:inner[0].x,y:ymax},{x:xmin,y:ymax},
  ];
  demand(pts.some((_,shift)=>pts.every((p,i)=>equal(p,expected[(i+shift)%6])))&&
    near(area,width*footHeight+legWidth*(depth-footHeight)),
    'selected sketch does not trace the supported L material');
  return {width,depth,legWidth,footHeight};
}
function cutRectangle(profile,label) {
  demand(profile?.holes?.length===0,'cut islands unsupported for '+label);
  const {pts,area}=vertices(profile,4,label);
  const {xmin,xmax,ymin,ymax,width,depth}=bounds(pts);
  const expected=[
    {x:xmin,y:ymin},{x:xmax,y:ymin},
    {x:xmax,y:ymax},{x:xmin,y:ymax},
  ];
  demand(width>=1e-6&&depth>=1e-6&&near(area,width*depth)&&
    pts.some((_,shift)=>pts.every((p,i)=>equal(p,expected[(i+shift)%4]))),
    label+' is not a solved axis-aligned rectangle');
  return {kind:'rectangle',x:(xmin+xmax)/2,y:(ymin+ymax)/2,width,depth};
}

/**
 * Consume RUNTIME.inspect(history), the accepted solved sketch boundary and
 * dependency DAG. Never convert a provisional preview into exact authority.
 */
export function requestFromRuntimeOcct8LProfile(history,targetBodyId,{
  runtime,model,requestId,exportStep=true,
}={}) {
  const authored=requestFromRuntimeBodyCutChain(history,targetBodyId,{
    runtime,model,requestId,exportStep,
  });
  const base=sourceL(authored.baseExtrude.profile);
  const cuts=authored.cuts.map(c=>({
    featureId:c.cutFeatureId,...cutRectangle(c.cutTool.profile,c.cutFeatureId),
    cutDepthMm:c.cutDepthMm,
  }));
  const sourceFeatures=model.featuresOf(history.document).filter(f=>
    f.kind==='extrude'&&f.writeTargets?.length===1&&
    f.writeTargets[0]===targetBodyId);
  demand(sourceFeatures.length===1&&
    typeof sourceFeatures[0].payload?.sourceSketchId==='string',
    'selected sketch identity missing from authored body');
  return parseOcct8LProfileRequest({
    protocol:'intuit3d/kernel/l-profile-cut-chain-v3',
    requestId:authored.requestId,featureId:authored.targetBodyId,
    revision:authored.revision,units:'mm',exportStep:authored.exportStep,
    profile:{profileId:sourceFeatures[0].payload.sourceSketchId,
      ...base,thickness:authored.baseExtrude.thicknessMm},
    cuts,
  });
}

/**
 * The only native authority is the source-matched C++ result. A failed,
 * unavailable, timed-out or stale worker is returned unresolved; no preview
 * or cached geometry can substitute for an exported solid.
 */
export async function runPinnedRuntimeOcct8LProfile(history,targetBodyId,{
  runtime,model,requestId,workerExecutable,readCurrentRevision,
  stepOutput,pythonExecutable,timeoutMs,signal,nativeSupervisor,
}={}) {
  const request=requestFromRuntimeOcct8LProfile(history,targetBodyId,{
    runtime,model,requestId,exportStep:stepOutput!==undefined,
  });
  const result=await runPinnedOcct8LProfileChain(request,{
    workerExecutable,readCurrentRevision,stepOutput,
    pythonExecutable,timeoutMs,signal,nativeSupervisor,
  });
  return Object.freeze({...result,semanticBodyId:targetBodyId,
    runtimeOcct8LProfileVersion:RUNTIME_OCCT8_L_PROFILE_VERSION,
    exactAuthority:false,independentInteroperability:false});
}
