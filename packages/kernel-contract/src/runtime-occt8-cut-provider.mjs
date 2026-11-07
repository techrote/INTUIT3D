/**
 * Accepted INTENT/RUNTIME ordered writer chain -> genuine pinned OCCT8 C++
 * rectangular cut-chain request. Does not create a browser-side document or
 * infer chronology. Unsupported/ambiguous profiles remain pending.
 */
import {requestFromRuntimeBodyCutChain} from './runtime-body-cut-chain-provider.mjs';
import {parseOcct8CutRequest} from './occt8-cut-v1.mjs';
import {runPinnedOcct8CutChain} from './local-occt8-cut-provider.mjs';

export const RUNTIME_OCCT8_RECT_CUT_VERSION=1;
function requireGeometry(ok,why) {
  if(!ok) throw new TypeError('pinned OCCT8 runtime rectangular cut: '+why);
}
function near(a,b) {return Number.isFinite(a)&&Number.isFinite(b)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);}

/** Only actual four-edge axis-aligned rectangles are accepted. */
function rectangle(profile,label) {
  const edges=profile?.boundary;
  requireGeometry(Array.isArray(edges)&&edges.length===4 &&
    edges.every(e=>e?.kind==='line'&&e.start&&e.end),
    label+' needs a four-line rectangular SKETCH');
  const points=edges.map(e=>e.start);
  const x=points.map(v=>v.x),y=points.map(v=>v.y);
  requireGeometry(x.every(Number.isFinite)&&y.every(Number.isFinite),
    label+' has nonfinite vertices');
  const xmin=Math.min(...x),xmax=Math.max(...x);
  const ymin=Math.min(...y),ymax=Math.max(...y);
  const width=xmax-xmin,depth=ymax-ymin;
  requireGeometry(width>=1e-6&&depth>=1e-6 &&
    near(profile.signedBoundaryAreaMm2,width*depth),
    label+' area does not equal rectangle bounds');
  for(let i=0;i<4;i++) {
    const edge=edges[i],next=points[(i+1)%4];
    requireGeometry(near(edge.end.x,next.x)&&near(edge.end.y,next.y)&&
      (near(edge.start.x,edge.end.x)!==near(edge.start.y,edge.end.y)),
      label+' has unclosed/diagonal/degenerate edges');
    requireGeometry((near(edge.start.x,xmin)||near(edge.start.x,xmax))&&
      (near(edge.start.y,ymin)||near(edge.start.y,ymax)),
      label+' has an unaligned corner');
  }
  return {x:(xmin+xmax)/2,y:(ymin+ymax)/2,width,depth};
}

export function requestFromRuntimeOcct8RectCuts(history,targetBodyId,{
  runtime,model,requestId,exportStep=true,
}={}) {
  const authored=requestFromRuntimeBodyCutChain(history,targetBodyId,{
    runtime,model,requestId,exportStep,
  });
  const base=rectangle(authored.baseExtrude.profile,'base plate');
  requireGeometry(near(base.x,0)&&near(base.y,0),
    'pinned C++ plate requires a centered local XY base');
  const holes=authored.baseExtrude.profile.holes.map(h=>({
    x:h.x,y:h.y,radius:h.radiusMm,
  }));
  const cuts=authored.cuts.map(cut=>{
    const rect=rectangle(cut.cutTool.profile,cut.cutFeatureId);
    requireGeometry(cut.cutTool.profile.holes.length===0,
      'cut islands/circular profiles are not yet supported in pinned C++');
    return {featureId:cut.cutFeatureId,...rect,cutDepthMm:cut.cutDepthMm};
  });
  return parseOcct8CutRequest({
    protocol:'intuit3d/kernel/plate-cut-chain-v1',
    requestId:authored.requestId,featureId:authored.targetBodyId,
    revision:authored.revision,units:'mm',exportStep:authored.exportStep,
    plate:{width:base.width,depth:base.depth,
      thickness:authored.baseExtrude.thicknessMm,holes},cuts,
  });
}

/** Execute the current authoritative document revision in a separate native
 * C++ process. BRep and STEP are derived, never journal authority.
 */
export async function runPinnedRuntimeOcct8RectCuts(history,targetBodyId,{
  runtime,model,requestId,workerExecutable,readCurrentRevision,
  stepOutput,pythonExecutable,timeoutMs,signal,nativeSupervisor,
}={}) {
  const q=requestFromRuntimeOcct8RectCuts(history,targetBodyId,{
    runtime,model,requestId,exportStep:stepOutput!==undefined,
  });
  const result=await runPinnedOcct8CutChain(q,{
    workerExecutable,readCurrentRevision,stepOutput,
    pythonExecutable,timeoutMs,signal,nativeSupervisor,
  });
  return Object.freeze({...result,semanticBodyId:targetBodyId,
    runtimeOcct8RectCutVersion:RUNTIME_OCCT8_RECT_CUT_VERSION,
    exactAuthority:false,independentInteroperability:false});
}
