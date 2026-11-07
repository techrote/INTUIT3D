// Selected, solver-admitted straight-edge profile -> pinned OCCT8 C++ v4.
// Simple CCW rectilinear contours only; no guessed topology or geometry healing.
import {KernelContractError} from './plate-v1.mjs';
import {parseOcct8MixedCutRequest} from './occt8-mixed-cut-v2.mjs';

export const OCCT8_ORTHOGONAL_PROFILE_PROTOCOL=
  'intuit3d/kernel/orthogonal-profile-cut-chain-v4';
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const fail=msg=>{throw new KernelContractError('OCCT8 orthogonal profile: '+msg);};
function fields(o,n,label) {
  if(!o||typeof o!=='object'||Array.isArray(o)||
     Object.keys(o).length!==n.length||n.some(k=>!Object.hasOwn(o,k)))
    fail(label+' fields');
  return o;
}
function number(n,label,{positive=false}={}) {
  if(typeof n!=='number'||!Number.isFinite(n)||
     Math.abs(n)>1e6||(positive&&n<1e-6))
    fail(label+' outside supported numeric range');
  return n;
}
function intersection(a,b,c,d) {
  if(a.x===b.x&&c.x===d.x)
    return a.x===c.x&&
      Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=
      Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
  if(a.y===b.y&&c.y===d.y)
    return a.y===c.y&&
      Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=
      Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x));
  if(a.x===b.x)
    return Math.min(c.x,d.x)<=a.x&&a.x<=Math.max(c.x,d.x)&&
      Math.min(a.y,b.y)<=c.y&&c.y<=Math.max(a.y,b.y);
  return Math.min(a.x,b.x)<=c.x&&c.x<=Math.max(a.x,b.x)&&
    Math.min(c.y,d.y)<=a.y&&a.y<=Math.max(c.y,d.y);
}
function geometry(vertices) {
  if(!Array.isArray(vertices)||vertices.length<6||vertices.length>64)
    fail('six to 64 contour vertices required');
  const v=vertices.map((p,i)=>({
    x:number(fields(p,['x','y'],'vertex '+i).x,'vertex x'),
    y:number(p.y,'vertex y'),
  }));
  for(let i=0;i<v.length;i++) {
    const a=v[i],b=v[(i+1)%v.length],c=v[(i+2)%v.length];
    const dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y);
    if(!((dx>=1e-6&&dy===0)||(dy>=1e-6&&dx===0)))
      fail('degenerate or non-orthogonal edge');
    if((a.x===b.x)===(b.x===c.x))fail('adjacent collinear edges');
    for(let j=i+1;j<v.length;j++) {
      if(j===i+1||(i===0&&j===v.length-1))continue;
      if(intersection(a,b,v[j],v[(j+1)%v.length]))
        fail('self-intersecting or touching contour');
    }
  }
  const area=v.reduce((s,a,i)=>{
    const b=v[(i+1)%v.length];return s+a.x*b.y-b.x*a.y;
  },0)/2;
  if(!(area>1e-6))fail('profile must have positive counterclockwise area');
  const perimeter=v.reduce((s,a,i)=>{
    const b=v[(i+1)%v.length];return s+Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  },0);
  const xs=v.map(p=>p.x),ys=v.map(p=>p.y);
  const xmin=Math.min(...xs),xmax=Math.max(...xs);
  const ymin=Math.min(...ys),ymax=Math.max(...ys);
  return {vertices:v,area,perimeter,xmin,xmax,ymin,ymax};
}
function inside(vertices,x,y) {
  let flag=false;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    if((a.y>y)!==(b.y>y)&&x<a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y))
      flag=!flag;
  }
  return flag;
}
function clearOfContour(vertices,c) {
  if(!inside(vertices,c.x,c.y))return false;
  const circular=c.kind==='circle',rx=circular?c.radius:c.width/2;
  const ry=circular?c.radius:c.depth/2;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    if(a.x===b.x){
      const dy=Math.max(0,Math.min(a.y,b.y)-c.y,c.y-Math.max(a.y,b.y));
      if(circular){
        if(Math.hypot(c.x-a.x,dy)<=c.radius)return false;
      }else if(c.x-rx<=a.x&&a.x<=c.x+rx&&
          Math.min(a.y,b.y)<=c.y+ry&&Math.max(a.y,b.y)>=c.y-ry)return false;
    }else{
      const dx=Math.max(0,Math.min(a.x,b.x)-c.x,c.x-Math.max(a.x,b.x));
      if(circular){
        if(Math.hypot(c.y-a.y,dx)<=c.radius)return false;
      }else if(c.y-ry<=a.y&&a.y<=c.y+ry&&
          Math.min(a.x,b.x)<=c.x+rx&&Math.max(a.x,b.x)>=c.x-rx)return false;
    }
  }
  return true;
}
export function parseOcct8OrthogonalProfileRequest(value) {
  const q=fields(value,['protocol','requestId','featureId','revision','units',
    'profile','cuts','exportStep'],'request');
  if(q.protocol!==OCCT8_ORTHOGONAL_PROFILE_PROTOCOL)fail('unsupported protocol');
  if(typeof q.requestId!=='string'||!ID.test(q.requestId)||
     typeof q.featureId!=='string'||!ID.test(q.featureId)||
     !Number.isSafeInteger(q.revision)||q.revision<0||
     q.units!=='mm'||typeof q.exportStep!=='boolean')
    fail('request identity, revision, units or export flag');
  const p=fields(q.profile,['profileId','thickness','vertices'],'profile');
  if(typeof p.profileId!=='string'||!ID.test(p.profileId)||p.profileId===q.featureId)
    fail('invalid selected profile identity');
  number(p.thickness,'extrusion thickness',{positive:true});
  const g=geometry(p.vertices);
  if(!Array.isArray(q.cuts)||q.cuts.length<2||q.cuts.length>16)
    fail('two to sixteen explicitly ordered cuts required');
  const cx=(g.xmin+g.xmax)/2,cy=(g.ymin+g.ymax)/2;
  const shifted=q.cuts.map(c=>({...c,x:c?.x-cx,y:c?.y-cy}));
  const parsed=parseOcct8MixedCutRequest({
    protocol:'intuit3d/kernel/plate-mixed-cut-chain-v2',
    requestId:q.requestId,featureId:q.featureId,revision:q.revision,
    units:'mm',exportStep:q.exportStep,
    plate:{width:g.xmax-g.xmin,depth:g.ymax-g.ymin,
      thickness:p.thickness,holes:[]},cuts:shifted});
  const cuts=parsed.cuts.map(c=>({...c,x:c.x+cx,y:c.y+cy}));
  for(const c of cuts){
    if(c.featureId===p.profileId)fail('cut conflicts with profile ID');
    if(!clearOfContour(g.vertices,c))
      fail('cut touches contour boundary or lies in missing material');
  }
  return {...q,profile:{...p,vertices:g.vertices},cuts};
}
export function expectedOcct8OrthogonalMetrics(q) {
  const g=geometry(q.profile.vertices),t=q.profile.thickness;
  let volumeMm3=g.area*t,surfaceAreaMm2=2*g.area+g.perimeter*t;
  for(const c of q.cuts){
    const footprint=c.kind==='circle'?Math.PI*c.radius*c.radius:c.width*c.depth;
    const wall=c.kind==='circle'?2*Math.PI*c.radius:2*(c.width+c.depth);
    volumeMm3-=footprint*c.cutDepthMm;
    surfaceAreaMm2+=wall*c.cutDepthMm;
    if(c.cutDepthMm===t)surfaceAreaMm2-=2*footprint;
  }
  return {volumeMm3,surfaceAreaMm2};
}
const near=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
function inspect(m,expected,circles,label) {
  fields(m,['valid','solidCount','volumeMm3','surfaceAreaMm2','cylindricalHoles'],label);
  if(m.valid!==true||m.solidCount!==1||
     !near(m.volumeMm3,expected.volumeMm3)||
     !near(m.surfaceAreaMm2,expected.surfaceAreaMm2))
    fail(label+' physical mass or area mismatch');
  const ordered=[...circles].sort((a,b)=>a.x-b.x||a.y-b.y||a.radius-b.radius);
  if(!Array.isArray(m.cylindricalHoles)||m.cylindricalHoles.length!==ordered.length)
    fail(label+' circular wall count mismatch');
  for(let i=0;i<ordered.length;i++){
    const a=fields(m.cylindricalHoles[i],['x','y','radius','axisZ'],label+' cylinder');
    for(const k of ['x','y','radius'])
      if(typeof a[k]!=='number'||!Number.isFinite(a[k])||
         Math.abs(a[k]-ordered[i][k])>Math.max(1e-11,Math.abs(ordered[i][k])*1e-9))
        fail(label+' misplaced bore wall');
    if(!near(Math.abs(a.axisZ),1))fail(label+' wrong cylinder axis');
  }
}
export function assessOcct8OrthogonalResponse(input,raw,{currentRevision}={}) {
  const q=parseOcct8OrthogonalProfileRequest(input);
  if(!Number.isSafeInteger(currentRevision)||currentRevision<0)
    fail('missing current revision');
  if(currentRevision!==q.revision)return {kind:'unresolved',code:'stale_revision',
    requestId:q.requestId,featureId:q.featureId,revision:q.revision};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     raw.protocol!==q.protocol||raw.requestId!==q.requestId)
    fail('request/response identity mismatch');
  if(raw.status!=='validated_exact'){
    fields(raw,Object.hasOwn(raw,'diagnostic')
      ? ['protocol','requestId','status','message','diagnostic']
      : ['protocol','requestId','status','message'],'native failure');
    if(!['timeout','worker_crash','invalid_request','requires_reconciliation'].includes(raw.status)||
       typeof raw.message!=='string')fail('unrecognized native failure');
    return {kind:'unresolved',code:raw.status,requestId:q.requestId,
      featureId:q.featureId,revision:q.revision};
  }
  const {stepPath,stepSha256,stepVerification,part21Audit,...report}=raw;
  fields(report,['protocol','requestId','featureId','revision','backend',
    'occtVersion','status','units','source','stepReadback','stepWritten'],'native report');
  if(report.featureId!==q.featureId||report.revision!==q.revision||
     report.backend!=='OCCT-cxx-8.0.1'||report.occtVersion!=='8.0.1'||
     report.units!=='mm'||report.stepWritten!==q.exportStep)
    fail('wrong native source identity or version');
  const expected=expectedOcct8OrthogonalMetrics(q);
  const holes=q.cuts.filter(c=>c.kind==='circle')
    .map(c=>({x:c.x,y:c.y,radius:c.radius}));
  inspect(report.source,expected,holes,'native source');
  if(q.exportStep){
    inspect(report.stepReadback,expected,holes,'same-engine STEP readback');
    if(typeof stepPath!=='string'||!stepPath||
       typeof stepSha256!=='string'||!/^[a-f0-9]{64}$/.test(stepSha256)||
       stepVerification!=='occt-8.0.1-same-engine'||part21Audit!==undefined)
      fail('unsupported STEP receipt');
  }else if(report.stepReadback!==null||stepPath!==undefined||
    stepSha256!==undefined||stepVerification!==undefined||part21Audit!==undefined)
    fail('unrequested STEP receipt');
  return {kind:'experimental_report',requestId:q.requestId,featureId:q.featureId,
    profileId:q.profile.profileId,cutFeatureIds:q.cuts.map(c=>c.featureId),
    revision:q.revision,backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    expectedMetrics:expected,exactAuthority:false,independentInteroperability:false,
    artifactSha256:stepSha256??null,
    step:q.exportStep?'same_engine_readback_reported':'not_requested'};
}
