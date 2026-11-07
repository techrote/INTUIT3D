/**
 * Analytically guarded line/arc profile handoff for a solved nonlinear sketch.
 * All geometry is finite, 2D millimetres. This is NOT native B-rep admission:
 * provider must independently validate the wire and perform STEP qualification.
 */
import {buildArcWirePreview} from './arc-constraints.mjs';

export const ARC_PROFILE_VERSION = 1;
export const ARC_PROFILE_FORMAT = 'intuit3d.analytic-arc-profile';
const UNCERTAINTY_MM = 1e-6; // rejection/uncertainty band, NEVER a geometric healing tolerance
const TAU = Math.PI * 2;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const fail = message => {throw new TypeError('sketch arc profile: ' + message);};
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const dot = (a,b) => a.x*b.x+a.y*b.y;
const cross = (a,b) => a.x*b.y-a.y*b.x;
const minus = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
const at = (a,d,t) => ({x:a.x+d.x*t,y:a.y+d.y*t});
const norm = angle => (angle%TAU+TAU)%TAU;

function withinArc(arc,p) {
  const angle=Math.atan2(p.y-arc.center.y,p.x-arc.center.x);
  const progress=arc.sweepRad>0?
    norm(angle-arc.startAngleRad):norm(arc.startAngleRad-angle);
  const bound=Math.abs(arc.sweepRad),slack=UNCERTAINTY_MM/arc.radiusMm;
  return progress<=bound+slack || progress>=TAU-slack;
}
function segmentDistance(point,line) {
  const d=minus(line.end,line.start),length2=dot(d,d);
  const t=Math.max(0,Math.min(1,dot(minus(point,line.start),d)/length2));
  return distance(point,at(line.start,d,t));
}
function curveDistance(point,curve) {
  if(curve.kind==='line')return segmentDistance(point,curve);
  const r=distance(point,curve.center);
  let best=Math.min(distance(point,curve.start),distance(point,curve.end));
  if(r>0&&withinArc(curve,point))best=Math.min(best,Math.abs(r-curve.radiusMm));
  return best;
}
function lineLine(a,b) {
  const u=minus(a.end,a.start),v=minus(b.end,b.start),w=minus(b.start,a.start),det=cross(u,v);
  if(Math.abs(det)<1e-12*Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y)) {
    if(Math.min(segmentDistance(a.start,b),segmentDistance(a.end,b),
      segmentDistance(b.start,a),segmentDistance(b.end,a))<=UNCERTAINTY_MM)
      return {ambiguous:true,points:[]};
    return {points:[]};
  }
  const t=cross(w,v)/det,s=cross(w,u)/det;
  const slack=UNCERTAINTY_MM/Math.min(Math.hypot(u.x,u.y),Math.hypot(v.x,v.y));
  return {points:t>=-slack&&t<=1+slack&&s>=-slack&&s<=1+slack?
    [at(a.start,u,t)]:[]};
}
function lineArc(line,arc) {
  const d=minus(line.end,line.start),f=minus(line.start,arc.center);
  const a=dot(d,d),b=2*dot(f,d),c=dot(f,f)-arc.radiusMm**2;
  const discriminant=b*b-4*a*c,near=4*a*arc.radiusMm*UNCERTAINTY_MM;
  if(discriminant < -near)return {points:[]};
  const root=Math.sqrt(Math.max(0,discriminant));
  const ts=Math.abs(discriminant)<=near?[-b/(2*a)]:
    [(-b-root)/(2*a),(-b+root)/(2*a)];
  const slack=UNCERTAINTY_MM/Math.sqrt(a);
  return {points:ts.filter(t=>t>=-slack&&t<=1+slack)
    .map(t=>at(line.start,d,t)).filter(p=>withinArc(arc,p))};
}
function arcArc(a,b) {
  const d=distance(a.center,b.center),r=a.radiusMm,s=b.radiusMm;
  if(d<=UNCERTAINTY_MM&&Math.abs(r-s)<=UNCERTAINTY_MM)
    return {ambiguous:true,points:[]};
  if(d<=UNCERTAINTY_MM||d>r+s+UNCERTAINTY_MM||
    d<Math.abs(r-s)-UNCERTAINTY_MM)return {points:[]};
  const v=minus(b.center,a.center),along=(r*r-s*s+d*d)/(2*d);
  const height2=r*r-along*along;
  if(height2<-(r+s)*UNCERTAINTY_MM)return {points:[]};
  const h=Math.sqrt(Math.max(0,height2));
  const p=at(a.center,v,along/d),o={x:-v.y*h/d,y:v.x*h/d};
  const candidates=h<UNCERTAINTY_MM?[p]:
    [{x:p.x+o.x,y:p.y+o.y},{x:p.x-o.x,y:p.y-o.y}];
  return {points:candidates.filter(q=>withinArc(a,q)&&withinArc(b,q))};
}
function intersections(a,b) {
  if(a.kind==='line'&&b.kind==='line')return lineLine(a,b);
  if(a.kind==='line')return lineArc(a,b);
  if(b.kind==='line')return lineArc(b,a);
  return arcArc(a,b);
}
function checkBoundary(boundary) {
  for(let i=0;i<boundary.length;i++){
    for(let j=i+1;j<boundary.length;j++){
      const adjacent=j===i+1 || (i===0&&j===boundary.length-1);
      const expected=j===i+1?boundary[i].end:boundary[j].end;
      const result=intersections(boundary[i],boundary[j]);
      if(result.ambiguous)fail('coincident or numerically ambiguous boundary curves');
      for(const point of result.points){
        if(!adjacent||distance(point,expected)>UNCERTAINTY_MM)
          fail('global boundary self-intersection or unintended contact');
      }
    }
  }
}
/** Analytic horizontal ray. Null means the chosen ray hits an uncertain vertex/extremum. */
function rayCrossings(boundary,point){
  let count=0;
  for(const curve of boundary){
    if(curve.kind==='line'){
      const a=curve.start,b=curve.end;
      if(Math.abs(point.y-a.y)<=UNCERTAINTY_MM ||
         Math.abs(point.y-b.y)<=UNCERTAINTY_MM)return null;
      if((a.y>point.y)===(b.y>point.y))continue;
      const x=a.x+(point.y-a.y)*(b.x-a.x)/(b.y-a.y);
      if(Math.abs(x-point.x)<=UNCERTAINTY_MM)return null;
      if(x>point.x)count++;
      continue;
    }
    const h=(point.y-curve.center.y)/curve.radiusMm;
    if(Math.abs(Math.abs(h)-1)<=UNCERTAINTY_MM/curve.radiusMm)return null;
    if(Math.abs(h)>1)continue;
    const a=Math.asin(h),angles=[a,Math.PI-a];
    for(const angle of angles){
      const p={x:curve.center.x+curve.radiusMm*Math.cos(angle),
        y:point.y};
      if(!withinArc(curve,p))continue;
      if(distance(p,curve.start)<=UNCERTAINTY_MM ||
         distance(p,curve.end)<=UNCERTAINTY_MM ||
         Math.abs(p.x-point.x)<=UNCERTAINTY_MM)return null;
      if(p.x>point.x)count++;
    }
  }
  return count;
}
function insideBoundary(boundary,hole){
  let answer=null;
  for(const offset of [0,0.173,-0.217,0.311,-0.383]){
    const y=hole.y+offset*hole.radiusMm;
    const crossings=rayCrossings(boundary,{x:hole.x,y});
    if(crossings===null)continue;
    const inside=crossings%2===1;
    if(answer!==null&&inside!==answer)
      fail('ambiguous containment under analytic ray checks');
    answer=inside;
  }
  if(answer===null)fail('unresolved analytic containment');
  return answer;
}

/**
 * Validate a fully solved, revision-matching line/arc sketch for provider
 * submission. No mesh sampling, polygon substitute or tolerance healing.
 * The downstream native worker still independently validates exact B-rep.
 */
export function prepareArcProfileForProvider(source,solution,{profileId,boundaryIds,holeIds=[]}={}){
  if(typeof profileId!=='string'||!/^[A-Za-z][\w:.-]{0,127}$/.test(profileId))
    fail('stable profileId is required');
  const preview=buildArcWirePreview(source,solution,boundaryIds,holeIds);
  const boundary=preview.boundary,holes=preview.holes;
  if(boundary.length<4)fail('at least four analytic boundary curves required');
  if(!finite(preview.signedBoundaryAreaMm2)||
      Math.abs(preview.signedBoundaryAreaMm2)<=UNCERTAINTY_MM**2)
    fail('zero or uncertain boundary area');
  checkBoundary(boundary);
  for(const h of holes){
    if(!insideBoundary(boundary,h))fail('hole outside analytic boundary: '+h.id);
    for(const edge of boundary){
      if(curveDistance({x:h.x,y:h.y},edge)<=h.radiusMm+UNCERTAINTY_MM)
        fail('hole intersects or approaches boundary: '+h.id);
    }
  }
  for(let i=0;i<holes.length;i++)for(let j=i+1;j<holes.length;j++){
    const a=holes[i],b=holes[j];
    if(Math.hypot(a.x-b.x,a.y-b.y)<=a.radiusMm+b.radiusMm+UNCERTAINTY_MM)
      fail('hole overlap or contact: '+a.id+', '+b.id);
  }
  const area=Math.abs(preview.signedBoundaryAreaMm2)-
    holes.reduce((sum,h)=>sum+Math.PI*h.radiusMm*h.radiusMm,0);
  if(!finite(area)||area<=UNCERTAINTY_MM**2)fail('nonpositive material area');
  return {
    format:ARC_PROFILE_FORMAT,version:ARC_PROFILE_VERSION,id:profileId,
    status:'analytic_2d_validated_pending_native',
    units:'mm',sourceSignature:preview.sourceSignature,
    numericalPolicy:{contactUncertaintyMm:UNCERTAINTY_MM,
      action:'reject_ambiguous_contact_no_geometry_healing'},
    boundary:structuredClone(boundary),holes:structuredClone(holes),
    signedBoundaryAreaMm2:preview.signedBoundaryAreaMm2,materialAreaMm2:area,
    globalSelfIntersectionChecked:true,holeContainmentChecked:true,
    providerSubmissionReady:true,nativeProfileAdmissible:false,
    exactBrepAvailable:false,stepQualified:false
  };
}
