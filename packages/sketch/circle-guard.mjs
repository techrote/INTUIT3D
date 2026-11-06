import { assessPolygonBoundary } from './boundary-guard.mjs';

/** Exact predicates on finite *encoded* binary64 coordinates, not exact B-rep geometry. */
export const CIRCLE_GUARD_VERSION = 1;
const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
const fractionMask = (1n << 52n) - 1n;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const reject = reason => ({version:CIRCLE_GUARD_VERSION,status:'rejected',reason,insideIds:[],outsideIds:[]});

function dyadic(value) {
  view.setFloat64(0,value,false);
  const bits=view.getBigUint64(0,false),biased=Number((bits>>52n)&2047n);
  let mantissa=bits&fractionMask;
  if(biased)mantissa|=1n<<52n;
  if(bits>>63n)mantissa=-mantissa;
  return {mantissa,exponent:mantissa===0n?0:biased?biased-1075:-1074};
}
function integers(vertices,circles) {
  const pts=[...vertices.flatMap(p=>[dyadic(p.x),dyadic(p.y)]),
    ...circles.flatMap(c=>[dyadic(c.x),dyadic(c.y),dyadic(c.radius)])];
  const base=Math.min(0,...pts.map(p=>p.exponent));
  const scale=p=>p.mantissa<<BigInt(p.exponent-base);
  return {
    polygon:vertices.map((p,i)=>({x:scale(pts[i*2]),y:scale(pts[i*2+1])})),
    circles:circles.map((c,i)=>{
      const j=vertices.length*2+i*3;
      return {id:c.id,x:scale(pts[j]),y:scale(pts[j+1]),r:scale(pts[j+2])};
    })
  };
}
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
const sq=(x,y)=>x*x+y*y;
function touchesSegment(c,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,wx=c.x-a.x,wy=c.y-a.y;
  const length2=sq(dx,dy),projection=wx*dx+wy*dy,radius2=c.r*c.r;
  if(length2===0n)return null;
  if(projection<=0n)return sq(wx,wy)<=radius2;
  if(projection>=length2)return sq(c.x-b.x,c.y-b.y)<=radius2;
  const area2=cross(dx,dy,wx,wy);
  return area2*area2<=radius2*length2;
}
function insidePolygon(c,polygon) {
  let inside=false;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    if((a.y>c.y)===(b.y>c.y))continue;
    const orientation=cross(b.x-a.x,b.y-a.y,c.x-a.x,c.y-a.y);
    if((b.y>a.y?orientation>0n:orientation<0n))inside=!inside;
  }
  return inside;
}

/**
 * Check polygon/circle incidence and circle-circle clearance with exact
 * BigInt dyadic comparisons. No epsilon, snapping, or tolerance widening.
 * 'verified' means only a compatible analytic 2D topology of encoded doubles.
 * Outside circles are reported, never silently promoted to profile holes.
 */
export function assessCircularProfile(vertices,circles) {
  if(!Array.isArray(vertices)||vertices.length<3||!Array.isArray(circles))return reject('invalid_input');
  if(vertices.length>256||circles.length>64)return reject('budget_exceeded');
  if(vertices.some(p=>!p||!finite(p.x)||!finite(p.y)) ||
     circles.some(c=>!c||typeof c.id!=='string'||!c.id||!finite(c.x)||!finite(c.y)||
       !finite(c.radius)||c.radius<=0) ||
     new Set(circles.map(c=>c.id)).size!==circles.length)return reject('invalid_input');
  const boundary=assessPolygonBoundary(vertices);
  if(boundary.status!=='verified')return reject('invalid_boundary:'+boundary.reason);
  const {polygon,circles:scaled}=integers(vertices,circles);
  const insideIds=[],outsideIds=[],inside=[];
  for(const c of scaled){
    for(let i=0;i<polygon.length;i++){
      const contact=touchesSegment(c,polygon[i],polygon[(i+1)%polygon.length]);
      if(contact===null)return reject('invalid_boundary:zero_length_edge');
      if(contact)return reject('circle_touches_or_crosses_boundary:'+c.id);
    }
    if(insidePolygon(c,polygon)){insideIds.push(c.id);inside.push(c);}
    else outsideIds.push(c.id);
  }
  for(let i=0;i<inside.length;i++)for(let j=i+1;j<inside.length;j++){
    const a=inside[i],b=inside[j];
    if(sq(a.x-b.x,a.y-b.y)<=(a.r+b.r)*(a.r+b.r))
      return reject('circular_holes_touch_or_overlap:'+a.id+':'+b.id);
  }
  return {version:CIRCLE_GUARD_VERSION,status:'verified',reason:null,insideIds,outsideIds};
}
