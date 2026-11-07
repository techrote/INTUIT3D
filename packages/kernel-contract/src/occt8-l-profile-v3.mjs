// Restricted, named six-edge L sketch profile -> real pinned OCCT8 C++ worker.
// A solved six-edge orthogonal profile is an exact admitted geometry subset;
// absence of source-matched physical evidence is NOT promoted to authority.
import {KernelContractError} from './plate-v1.mjs';
import {parseOcct8MixedCutRequest,expectedOcct8MixedCutMetrics}
  from './occt8-mixed-cut-v2.mjs';

export const OCCT8_L_PROFILE_PROTOCOL='intuit3d/kernel/l-profile-cut-chain-v3';
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const fail=msg=>{throw new KernelContractError('OCCT8 L profile: '+msg);};
const strict=(obj,fields,label)=>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
      Object.keys(obj).length!==fields.length||
      fields.some(key=>!Object.hasOwn(obj,key)))fail(label+' fields');
  return obj;
};
export function parseOcct8LProfileRequest(value) {
  const q=strict(value,['protocol','requestId','featureId','revision','units',
    'profile','cuts','exportStep'],'request');
  if(q.protocol!==OCCT8_L_PROFILE_PROTOCOL)fail('wrong protocol');
  const p=strict(q.profile,
    ['profileId','width','depth','thickness','legWidth','footHeight'],'profile');
  if(typeof p.profileId!=='string'||!ID.test(p.profileId)||p.profileId===q.featureId)
    fail('invalid selected profile identity');
  for(const key of ['width','depth','thickness','legWidth','footHeight'])
    if(typeof p[key]!=='number'||!Number.isFinite(p[key])||
       p[key]<1e-6||p[key]>1e6)fail('invalid '+key);
  if(p.legWidth>=p.width||p.footHeight>=p.depth)
    fail('L profile notch must have positive width and depth');
  if(!Array.isArray(q.cuts)||q.cuts.length<2)fail('two ordered cuts required');
  // Reuse the already-admitted cut geometry/semantic identity constraints.
  const proxy=parseOcct8MixedCutRequest({
    protocol:'intuit3d/kernel/plate-mixed-cut-chain-v2',
    requestId:q.requestId,featureId:q.featureId,revision:q.revision,
    units:q.units,plate:{width:p.width,depth:p.depth,thickness:p.thickness,holes:[]},
    cuts:q.cuts,exportStep:q.exportStep,
  });
  for(const c of proxy.cuts) {
    if(c.featureId===p.profileId)fail('cut identity conflicts with source sketch');
    const rx=c.kind==='circle'?c.radius:c.width/2;
    const ry=c.kind==='circle'?c.radius:c.depth/2;
    const leg=Math.abs(c.x+p.width/2-p.legWidth/2)+rx<p.legWidth/2 &&
      Math.abs(c.y)+ry<p.depth/2;
    const foot=Math.abs(c.x)+rx<p.width/2 &&
      Math.abs(c.y+p.depth/2-p.footHeight/2)+ry<p.footHeight/2;
    if(!leg&&!foot)fail('cut extends into missing L-profile material');
  }
  return {...q,profile:{...p},cuts:proxy.cuts};
}
export function expectedOcct8LProfileMetrics(q) {
  const p=q.profile;
  const proxy={plate:{width:p.width,depth:p.depth,thickness:p.thickness,holes:[]},
    cuts:q.cuts};
  const rectangle=expectedOcct8MixedCutMetrics(proxy);
  const delta=p.width*p.footHeight+p.legWidth*(p.depth-p.footHeight)
    -p.width*p.depth;
  return {volumeMm3:rectangle.volumeMm3+delta*p.thickness,
    surfaceAreaMm2:rectangle.surfaceAreaMm2+2*delta};
}
const near=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
function inspect(metrics,expected,circular,label) {
  strict(metrics,['valid','solidCount','volumeMm3','surfaceAreaMm2',
    'cylindricalHoles'],label);
  if(metrics.valid!==true||metrics.solidCount!==1||
     !near(metrics.volumeMm3,expected.volumeMm3)||
     !near(metrics.surfaceAreaMm2,expected.surfaceAreaMm2))
    fail(label+' physical mass/area mismatch');
  if(!Array.isArray(metrics.cylindricalHoles)||
     metrics.cylindricalHoles.length!==circular.length)
    fail(label+' circular wall inventory differs');
  const sorted=[...circular].sort((a,b)=>a.x-b.x||a.y-b.y||a.radius-b.radius);
  for(let i=0;i<sorted.length;i++){
    const item=strict(metrics.cylindricalHoles[i],
      ['x','y','radius','axisZ'],label+' cylindrical wall');
    for(const key of ['x','y','radius'])
      if(typeof item[key]!=='number'||!Number.isFinite(item[key])||
         Math.abs(item[key]-sorted[i][key])>
           Math.max(1e-11,Math.abs(sorted[i][key])*1e-9))
        fail(label+' displaced circular wall');
    if(!near(Math.abs(item.axisZ),1))fail(label+' nonvertical cylinder');
  }
}
export function assessOcct8LProfileResponse(input,raw,{currentRevision}={}) {
  const q=parseOcct8LProfileRequest(input);
  if(!Number.isSafeInteger(currentRevision)||currentRevision<0)
    fail('missing revision fence');
  if(currentRevision!==q.revision)
    return {kind:'unresolved',code:'stale_revision',
      requestId:q.requestId,featureId:q.featureId,revision:q.revision};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     raw.protocol!==q.protocol||raw.requestId!==q.requestId)
    fail('mismatched native response');
  if(raw.status!=='validated_exact') {
    strict(raw,Object.hasOwn(raw,'diagnostic') ?
      ['protocol','requestId','status','message','diagnostic'] :
      ['protocol','requestId','status','message'],'failure');
    if(!['timeout','worker_crash','invalid_request','requires_reconciliation'].includes(raw.status)||
       typeof raw.message!=='string')fail('unsupported native failure');
    return {kind:'unresolved',code:raw.status,
      requestId:q.requestId,featureId:q.featureId,revision:q.revision};
  }
  const {stepPath,stepSha256,stepVerification,part21Audit,...report}=raw;
  strict(report,['protocol','requestId','featureId','revision','backend','occtVersion',
    'status','units','source','stepReadback','stepWritten'],'success');
  if(report.featureId!==q.featureId||report.revision!==q.revision||
     report.backend!=='OCCT-cxx-8.0.1'||report.occtVersion!=='8.0.1'||
     report.units!=='mm'||report.stepWritten!==q.exportStep)
    fail('wrong native source/revision/body identity');
  const expected=expectedOcct8LProfileMetrics(q);
  const holes=q.cuts.filter(c=>c.kind==='circle')
    .map(c=>({x:c.x,y:c.y,radius:c.radius}));
  inspect(report.source,expected,holes,'source');
  if(q.exportStep){
    inspect(report.stepReadback,expected,holes,'STEP readback');
    if(typeof stepPath!=='string'||!stepPath||
       typeof stepSha256!=='string'||!/^[a-f0-9]{64}$/.test(stepSha256)||
       stepVerification!=='occt-8.0.1-same-engine'||part21Audit!==undefined)
      fail('unsupported STEP evidence');
  }else if(report.stepReadback!==null||stepPath!==undefined||
           stepSha256!==undefined||stepVerification!==undefined||
           part21Audit!==undefined)fail('unrequested STEP output');
  return {kind:'experimental_report',requestId:q.requestId,
    featureId:q.featureId,profileId:q.profile.profileId,
    cutFeatureIds:q.cuts.map(c=>c.featureId),revision:q.revision,
    backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    expectedMetrics:expected,exactAuthority:false,
    independentInteroperability:false,artifactSha256:stepSha256??null,
    step:q.exportStep?'same_engine_readback_reported':'not_requested'};
}
