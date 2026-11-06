/**
 * @intuit3d/sketch/analytic-area/v1 — exact-dyadic polygon-area and
 * positive net-area certification for finite encoded binary64 inputs.
 * Reported areaMm2 is a rounded binary64 ANALYTIC PREVIEW, never exact B-rep.
 * Circle containment/overlap must separately pass circle-guard/v1.
 */
import {assessPolygonBoundary} from './boundary-guard.mjs';
export const ANALYTIC_AREA_GUARD_VERSION=1;
function rejectArea(reason) {
  return {version:1,status:'rejected',reason,areaMm2:null};
}
function decodeDyadic(value) {
  const bytes=new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0,value,false);
  const bits=bytes.getBigUint64(0,false);
  const biased=Number((bits>>52n)&2047n);
  let coefficient=bits&((1n<<52n)-1n);
  if(biased!==0) coefficient|=1n<<52n;
  if((bits>>63n)!==0n) coefficient=-coefficient;
  return {coefficient,exponent:coefficient===0n?0:biased?biased-1075:-1074};
}
function positiveRatioToBinary64(numerator,denominator,power2) {
  if(numerator<=0n||denominator<=0n)return null;
  const bits=n=>n.toString(2).length;
  let ratioExponent=bits(numerator)-bits(denominator);
  if(ratioExponent>=0
    ? numerator<(denominator<<BigInt(ratioExponent))
    : (numerator<<BigInt(-ratioExponent))<denominator) ratioExponent--;
  const exponent=ratioExponent+power2;
  if(exponent>1023||exponent< -1074)return null;
  const shift=52-ratioExponent;
  const scaledNumerator=shift>=0?numerator<<BigInt(shift):numerator;
  const scaledDenominator=shift<0?denominator<<BigInt(-shift):denominator;
  let quotient=scaledNumerator/scaledDenominator;
  const remainder=scaledNumerator%scaledDenominator;
  if(2n*remainder>scaledDenominator ||
    (2n*remainder===scaledDenominator && (quotient&1n)===1n)) quotient++;
  const measured=Number(quotient)/2**52*2**exponent;
  return Number.isFinite(measured)&&measured>0?measured:null;
}
function computeEncodedArea(vertices,holes) {
  const raw=vertices.map(p=>({x:decodeDyadic(p.x),y:decodeDyadic(p.y)}));
  const radii=holes.map(h=>decodeDyadic(h.radius));
  let exponent=0;
  for(const p of raw)exponent=Math.min(exponent,p.x.exponent,p.y.exponent);
  for(const radius of radii)exponent=Math.min(exponent,radius.exponent);
  const scale=d=>d.coefficient<<BigInt(d.exponent-exponent);
  const polygon=raw.map(p=>({x:scale(p.x),y:scale(p.y)}));
  let doubleArea=0n;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    doubleArea+=a.x*b.y-b.x*a.y;
  }
  if(doubleArea===0n)return rejectArea('zero_area');
  if(doubleArea<0n)doubleArea=-doubleArea;
  const radiusSquared=radii.reduce((sum,r)=>{const n=scale(r);return sum+n*n;},0n);
  // 103993/33102 < pi < 355/113. A close result is unresolved,
  // not promoted to a silently positive area via floating cancellation.
  if(33102n*doubleArea<=207986n*radiusSquared)
    return rejectArea('nonpositive_net_area');
  if(113n*doubleArea<=710n*radiusSquared)
    return rejectArea('uncertain_net_area');
  // Area is an APPROXIMATE binary64 preview. Topology and positive-area
  // certification above use exact dyadic integer comparisons.
  const piDigits='31415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679';
  const piNumerator=BigInt(piDigits),piDenominator=10n**BigInt(piDigits.length-1);
  const areaNumerator=doubleArea*piDenominator-2n*radiusSquared*piNumerator;
  const area=positiveRatioToBinary64(areaNumerator,2n*piDenominator,2*exponent);
  if(area===null)return rejectArea('unrepresentable_area');
  return {version:1,status:'verified',reason:null,areaMm2:area};
}
function assessAnalyticProfileArea(vertices,holes=[]) {
  if(!Array.isArray(vertices)||vertices.length<3||
    !Array.isArray(holes)||
    vertices.some(p=>!p||typeof p!=='object'||!Number.isFinite(p.x)||!Number.isFinite(p.y))||
    holes.some(h=>!h||typeof h!=='object'||!Number.isFinite(h.radius)||h.radius<=0))
    return rejectArea('invalid_input');
  if(vertices.length>256||holes.length>64)return rejectArea('budget_exceeded');
  const boundary=assessPolygonBoundary(vertices);
  if(boundary.status!=='verified')return rejectArea('invalid_boundary:'+boundary.reason);
  return computeEncodedArea(vertices,holes);
}
export {assessAnalyticProfileArea};
