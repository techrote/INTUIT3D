// Pinned OCCT 8.0.1 C++ mixed rectangle/circle blind/through profile requests.
// Additive to plate-cut-chain-v1; analytic B-rep evidence is not independent CAD.
import {KernelContractError,parsePlateRequest} from './plate-v1.mjs';
export const OCCT8_MIXED_CUT_PROTOCOL='intuit3d/kernel/plate-mixed-cut-chain-v2';
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const fail=(why)=>{throw new KernelContractError('OCCT8 mixed cut: '+why);};
function keys(o,fields,label) {
  if(!o||typeof o!=='object'||Array.isArray(o)||
      Object.keys(o).length!==fields.length||fields.some(k=>!Object.hasOwn(o,k)))
    fail(label+': wrong fields');
  return o;
}
function number(v,minimum,label) {
  if(typeof v!=='number'||!Number.isFinite(v)||
     (minimum!==undefined&&!(v>=minimum&&v<=1e6)))fail(label+' invalid dimension');
  return v;
}
function touchCircleRect(c,r) {
  return Math.hypot(Math.max(0,Math.abs(c.x-r.x)-r.width/2),
    Math.max(0,Math.abs(c.y-r.y)-r.depth/2))<=c.radius;
}
function touch(a,b) {
  if(a.kind==='rectangle'&&b.kind==='rectangle')
    return Math.abs(a.x-b.x)<=(a.width+b.width)/2 &&
      Math.abs(a.y-b.y)<=(a.depth+b.depth)/2;
  if(a.kind==='circle'&&b.kind==='circle')
    return Math.hypot(a.x-b.x,a.y-b.y)<=a.radius+b.radius;
  return touchCircleRect(a.kind==='circle'?a:b,a.kind==='circle'?b:a);
}
export function parseOcct8MixedCutRequest(value) {
  const q=keys(value,['protocol','requestId','featureId','revision',
    'units','plate','cuts','exportStep'],'request');
  if(q.protocol!==OCCT8_MIXED_CUT_PROTOCOL)fail('unsupported protocol');
  const base=parsePlateRequest({protocol:'intuit3d/kernel/plate-v1',
    requestId:q.requestId,featureId:q.featureId,revision:q.revision,
    units:q.units,plate:q.plate,exportStep:q.exportStep});
  if(!Array.isArray(q.cuts)||q.cuts.length<1||q.cuts.length>16)
    fail('expected one to sixteen ordered profile cuts');
  const {plate}=base, seen=new Set([base.featureId]), cuts=[];
  for(const [i,raw] of q.cuts.entries()){
    if(raw?.kind!=='circle'&&raw?.kind!=='rectangle')fail('unsupported profile kind '+i);
    const fields=raw.kind==='circle'
      ? ['featureId','kind','x','y','radius','cutDepthMm']
      : ['featureId','kind','x','y','width','depth','cutDepthMm'];
    keys(raw,fields,'cut '+i);
    if(typeof raw.featureId!=='string'||!ID.test(raw.featureId)||
       seen.has(raw.featureId))fail('duplicate/invalid feature identity');
    seen.add(raw.featureId);
    const x=number(raw.x,undefined,'x'),y=number(raw.y,undefined,'y');
    const cutDepthMm=number(raw.cutDepthMm,1e-6,'cutDepthMm');
    if(cutDepthMm>plate.thickness)fail('cut depth exceeds plate thickness');
    let c;
    if(raw.kind==='circle'){
      const radius=number(raw.radius,1e-6,'radius');
      if(!(Math.abs(x)+radius<plate.width/2&&Math.abs(y)+radius<plate.depth/2))
        fail('circle outside target material');
      c={featureId:raw.featureId,kind:'circle',x,y,radius,cutDepthMm};
    }else{
      const width=number(raw.width,1e-6,'width'),depth=number(raw.depth,1e-6,'depth');
      if(!(Math.abs(x)+width/2<plate.width/2&&Math.abs(y)+depth/2<plate.depth/2))
        fail('rectangle outside target material');
      c={featureId:raw.featureId,kind:'rectangle',x,y,width,depth,cutDepthMm};
    }
    for(const h of plate.holes) if(touch(c,{kind:'circle',...h}))
      fail('profile intersects existing bore');
    for(const earlier of cuts)if(touch(c,earlier))
      fail('profile touches previous cut');
    cuts.push(c);
  }
  return {...base,protocol:OCCT8_MIXED_CUT_PROTOCOL,cuts};
}
export function expectedOcct8MixedCutMetrics(q) {
  const {plate,cuts}=q, boreArea=plate.holes.reduce((s,h)=>s+Math.PI*h.radius**2,0);
  let volumeMm3=(plate.width*plate.depth-boreArea)*plate.thickness;
  let surfaceAreaMm2=2*(plate.width*plate.depth-boreArea)+
    (2*(plate.width+plate.depth)+
      plate.holes.reduce((s,h)=>s+2*Math.PI*h.radius,0))*plate.thickness;
  for(const c of cuts) {
    const footprint=c.kind==='circle'?Math.PI*c.radius**2:c.width*c.depth;
    const perimeter=c.kind==='circle'?2*Math.PI*c.radius:2*(c.width+c.depth);
    volumeMm3-=footprint*c.cutDepthMm;
    surfaceAreaMm2+=perimeter*c.cutDepthMm;
    if(c.cutDepthMm===plate.thickness)surfaceAreaMm2-=2*footprint;
  }
  return {volumeMm3,surfaceAreaMm2};
}
const near=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
function inspect(m,metrics,holes,name) {
  keys(m,['valid','solidCount','volumeMm3','surfaceAreaMm2','cylindricalHoles'],name);
  if(m.valid!==true||m.solidCount!==1||
     !near(m.volumeMm3,metrics.volumeMm3)||!near(m.surfaceAreaMm2,metrics.surfaceAreaMm2))
    fail(name+' has incorrect B-rep mass or area');
  if(!Array.isArray(m.cylindricalHoles)||m.cylindricalHoles.length!==holes.length)
    fail(name+' lost a circular wall');
  const expected=[...holes].sort((a,b)=>a.x-b.x||a.y-b.y||a.radius-b.radius);
  for(let i=0;i<expected.length;i++){
    const actual=keys(m.cylindricalHoles[i],
      ['x','y','radius','axisZ'],name+' cylindrical wall');
    for(const key of ['x','y','radius'])
      if(typeof actual[key]!=='number'||!Number.isFinite(actual[key])||
         Math.abs(actual[key]-expected[i][key])>
           Math.max(1e-11,Math.abs(expected[i][key])*1e-9))
        fail(name+' displaced circular wall '+key);
    if(!near(Math.abs(actual.axisZ),1))fail(name+' has nonvertical cylinder');
  }
}
export function assessOcct8MixedCutResponse(input,raw,{currentRevision}={}) {
  const q=parseOcct8MixedCutRequest(input);
  if(!Number.isSafeInteger(currentRevision)||currentRevision<0)
    fail('missing revision fence');
  if(currentRevision!==q.revision)return {kind:'unresolved',code:'stale_revision',
    requestId:q.requestId,featureId:q.featureId,revision:q.revision};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid native reply');
  if(raw.protocol!==q.protocol||raw.requestId!==q.requestId)
    fail('request/response identity mismatch');
  if(raw.status!=='validated_exact'){
    keys(raw,Object.hasOwn(raw,'diagnostic')
      ? ['protocol','requestId','status','message','diagnostic']
      : ['protocol','requestId','status','message'],'native failure');
    if(!['timeout','worker_crash','invalid_request','requires_reconciliation'].includes(raw.status)||
       typeof raw.message!=='string')fail('invalid native failure');
    return {kind:'unresolved',code:raw.status,requestId:q.requestId,
      featureId:q.featureId,revision:q.revision};
  }
  const {stepPath,stepSha256,stepVerification,part21Audit,...report}=raw;
  keys(report,['protocol','requestId','featureId','revision','backend','occtVersion',
    'status','units','source','stepReadback','stepWritten'],'native result');
  if(report.featureId!==q.featureId||report.revision!==q.revision||
     report.backend!=='OCCT-cxx-8.0.1'||report.occtVersion!=='8.0.1'||
     report.units!=='mm'||report.stepWritten!==q.exportStep)
    fail('backend/version/identity mismatch');
  const metrics=expectedOcct8MixedCutMetrics(q);
  const circular=[...q.plate.holes,...q.cuts.filter(c=>c.kind==='circle')
    .map(c=>({x:c.x,y:c.y,radius:c.radius}))];
  inspect(report.source,metrics,circular,'source');
  if(q.exportStep){
    inspect(report.stepReadback,metrics,circular,'STEP readback');
    if(typeof stepPath!=='string'||!stepPath||
       typeof stepSha256!=='string'||!/^[a-f0-9]{64}$/.test(stepSha256)||
       stepVerification!=='occt-8.0.1-same-engine'||part21Audit!==undefined)
      fail('unsupported STEP verification');
  }else if(report.stepReadback!==null||stepPath!==undefined||
           stepSha256!==undefined||stepVerification!==undefined||
           part21Audit!==undefined)fail('unexpected STEP receipt');
  return {kind:'experimental_report',requestId:q.requestId,featureId:q.featureId,
    revision:q.revision,backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    expectedMetrics:metrics,exactAuthority:false,independentInteroperability:false,
    artifactSha256:stepSha256??null,
    step:q.exportStep?'same_engine_readback_reported':'not_requested'};
}
