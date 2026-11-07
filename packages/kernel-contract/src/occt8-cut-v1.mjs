// Pinned OCCT8 8.0.1 C++ rectangular blind/through cut-chain contract.
// Deliberately narrower than general sketch profiles. No production exactness
// or independent STEP authority is claimed by this transport assessment.
import {KernelContractError, parsePlateRequest} from './plate-v1.mjs';
export const OCCT8_CUT_PROTOCOL = 'intuit3d/kernel/plate-cut-chain-v1';
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
function checkKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== expected.length ||
      expected.some(k => !Object.hasOwn(value,k)))
    throw new KernelContractError(`${label}: wrong field set`);
  return value;
}
function finite(value, label, minimum) {
  if (typeof value !== 'number' || !Number.isFinite(value) ||
      (minimum !== undefined && !(minimum <= value && value <= 1e6)))
    throw new KernelContractError(`${label}: invalid finite dimension`);
  return value;
}
function close(a,b) { return Number.isFinite(a) && Math.abs(a-b) <= Math.max(1e-7,Math.abs(b)*1e-10); }

export function parseOcct8CutRequest(input) {
  const doc = checkKeys(input,['protocol','requestId','featureId','revision','units',
    'plate','cuts','exportStep'],'cut-chain');
  if (doc.protocol !== OCCT8_CUT_PROTOCOL) throw new KernelContractError('unsupported OCCT8 cut protocol');
  const plateRequest = parsePlateRequest({
    protocol:'intuit3d/kernel/plate-v1', requestId:doc.requestId,
    featureId:doc.featureId, revision:doc.revision,
    units:doc.units, plate:doc.plate, exportStep:doc.exportStep,
  });
  if (!Array.isArray(doc.cuts) || doc.cuts.length < 1 || doc.cuts.length > 16)
    throw new KernelContractError('expected 1..16 ordered rectangular cuts');
  const {plate} = plateRequest;
  const seen = new Set([doc.featureId]);
  const cuts = [];
  for (const [i, raw] of doc.cuts.entries()) {
    const c = checkKeys(raw,['featureId','x','y','width','depth','cutDepthMm'],`cut ${i}`);
    if (typeof c.featureId !== 'string' || !ID.test(c.featureId) || seen.has(c.featureId))
      throw new KernelContractError(`cut ${i}: duplicate/invalid semantic ID`);
    seen.add(c.featureId);
    const x=finite(c.x,'x'), y=finite(c.y,'y');
    const width=finite(c.width,'width',1e-6), depth=finite(c.depth,'depth',1e-6);
    const cutDepthMm=finite(c.cutDepthMm,'cutDepthMm',1e-6);
    if (cutDepthMm>plate.thickness ||
        !(Math.abs(x)+width/2<plate.width/2 && Math.abs(y)+depth/2<plate.depth/2))
      throw new KernelContractError(`cut ${i}: exceeds target solid`);
    for (const h of plate.holes) {
      const dx=Math.max(0,Math.abs(x-h.x)-width/2);
      const dy=Math.max(0,Math.abs(y-h.y)-depth/2);
      if (Math.hypot(dx,dy)<=h.radius)
        throw new KernelContractError(`cut ${i}: intersects existing bore`);
    }
    for (const prior of cuts) {
      if (Math.abs(x-prior.x)<=(width+prior.width)/2 &&
          Math.abs(y-prior.y)<=(depth+prior.depth)/2)
        throw new KernelContractError(`cut ${i}: touches another cut`);
    }
    cuts.push({featureId:c.featureId,x,y,width,depth,cutDepthMm});
  }
  return {...plateRequest,protocol:OCCT8_CUT_PROTOCOL,cuts};
}

export function expectedOcct8CutMetrics(request) {
  const {plate,cuts} = request;
  let volumeMm3=(plate.width*plate.depth-
    plate.holes.reduce((a,h)=>a+Math.PI*h.radius*h.radius,0))*plate.thickness;
  let surfaceAreaMm2=2*(plate.width*plate.depth-
    plate.holes.reduce((a,h)=>a+Math.PI*h.radius*h.radius,0))+
    (2*(plate.width+plate.depth)+
      plate.holes.reduce((a,h)=>a+2*Math.PI*h.radius,0))*plate.thickness;
  for(const c of cuts) {
    volumeMm3-=c.width*c.depth*c.cutDepthMm;
    surfaceAreaMm2+=2*(c.width+c.depth)*c.cutDepthMm;
    if(c.cutDepthMm===plate.thickness) surfaceAreaMm2-=2*c.width*c.depth;
  }
  return {volumeMm3,surfaceAreaMm2};
}

function checkMetrics(raw, expected, holes, label) {
  const m=checkKeys(raw,['valid','solidCount','volumeMm3','surfaceAreaMm2','cylindricalHoles'],label);
  if(m.valid!==true || m.solidCount!==1 ||
     !close(m.volumeMm3,expected.volumeMm3) ||
     !close(m.surfaceAreaMm2,expected.surfaceAreaMm2))
    throw new KernelContractError(`${label}: B-rep mass/area invalid`);
  if(!Array.isArray(m.cylindricalHoles) || m.cylindricalHoles.length!==holes.length)
    throw new KernelContractError(`${label}: lost cylindrical bore`);
  const sorted=[...holes].sort((a,b)=>a.x-b.x||a.y-b.y||a.radius-b.radius);
  for(let i=0;i<sorted.length;i++) {
    const cylinder=checkKeys(m.cylindricalHoles[i],['x','y','radius','axisZ'],`${label} bore`);
    const h=sorted[i];
    for(const key of ['x','y','radius'])
      if(typeof cylinder[key]!=='number'|| !Number.isFinite(cylinder[key]) ||
         Math.abs(cylinder[key]-h[key])>Math.max(1e-11,Math.abs(h[key])*1e-9))
        throw new KernelContractError(`${label}: displaced/lost bore ${key}`);
    if(typeof cylinder.axisZ!=='number' || !Number.isFinite(cylinder.axisZ) ||
       Math.abs(Math.abs(cylinder.axisZ)-1)>1e-10)
      throw new KernelContractError(`${label}: nonvertical bore`);
  }
}

export function assessOcct8CutResponse(input, raw, {currentRevision}={}) {
  const request=parseOcct8CutRequest(input);
  if(!Number.isSafeInteger(currentRevision) || currentRevision<0)
    throw new KernelContractError('missing current revision');
  if(currentRevision!==request.revision)
    return {kind:'unresolved',code:'stale_revision',requestId:request.requestId,
      featureId:request.featureId,revision:request.revision};
  if(!raw || typeof raw!=='object' || Array.isArray(raw))
    throw new KernelContractError('invalid C++ response');
  if(raw.protocol!==request.protocol||raw.requestId!==request.requestId)
    throw new KernelContractError('C++ cut request identity mismatch');
  if(raw.status!=='validated_exact') {
    checkKeys(raw,Object.hasOwn(raw,'diagnostic')
      ? ['protocol','requestId','status','message','diagnostic']
      : ['protocol','requestId','status','message'],'native failure');
    if(!['timeout','worker_crash','invalid_request','requires_reconciliation'].includes(raw.status) ||
       typeof raw.message!=='string')
      throw new KernelContractError('invalid failure response');
    return {kind:'unresolved',code:raw.status,requestId:request.requestId,
      featureId:request.featureId,revision:request.revision};
  }
  const {stepPath,stepSha256,stepVerification,part21Audit,...report}=raw;
  checkKeys(report,['protocol','requestId','featureId','revision','backend','occtVersion',
    'status','units','source','stepReadback','stepWritten'],'OCCT8 cut response');
  if(report.featureId!==request.featureId || report.revision!==request.revision ||
     report.backend!=='OCCT-cxx-8.0.1' || report.occtVersion!=='8.0.1' ||
     report.units!=='mm' || report.stepWritten!==request.exportStep)
    throw new KernelContractError('C++ cut backend/identity/provenance mismatch');
  const expected=expectedOcct8CutMetrics(request);
  checkMetrics(report.source,expected,request.plate.holes,'source');
  if(request.exportStep) {
    checkMetrics(report.stepReadback,expected,request.plate.holes,'STEP readback');
    if(typeof stepPath!=='string' || !stepPath ||
       typeof stepSha256!=='string'|| !/^[a-f0-9]{64}$/.test(stepSha256)||
       stepVerification!=='occt-8.0.1-same-engine'||part21Audit!==undefined)
      throw new KernelContractError('C++ cut STEP audit not supported/complete');
  } else if(report.stepReadback!==null || stepPath!==undefined ||
            stepSha256!==undefined || stepVerification!==undefined ||
            part21Audit!==undefined) throw new KernelContractError('unexpected STEP report');
  return {kind:'experimental_report',requestId:request.requestId,
    featureId:request.featureId,revision:request.revision,
    backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    expectedMetrics:expected,
    exactAuthority:false,independentInteroperability:false,
    artifactSha256:stepSha256??null,
    step:request.exportStep?'same_engine_readback_reported':'not_requested'};
}
