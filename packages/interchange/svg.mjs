/** Standalone, unit-scaled SVG preview of bounded analytical DXF sketch geometry. */
import {validateDxfSketch} from './dxf.mjs';
export const SVG_INTERCHANGE_VERSION = 1;
const full = 360, rad = Math.PI / 180;
const mod = a => ((a % full) + full) % full;
const fmt = n => {
  if (!Number.isFinite(n)) throw new RangeError('SVG preview: nonfinite drawing extent');
  return String(Object.is(Number(n.toFixed(9)), -0) ? 0 : Number(n.toFixed(9)));
};
const xml = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[c]);
function onArc(e, angle) {
  const near = (n, target) => Math.abs(n - target) <= 1e-14;
  const unit = n => near(n, 0) ? 0 : near(n, 1) ? 1 : near(n, -1) ? -1 : n;
  return {x:e.center.x + e.radiusMm * unit(Math.cos(angle * rad)),
    y:e.center.y + e.radiusMm * unit(Math.sin(angle * rad))};
}
function extents(entities) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  function include(p) {
    minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
    minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
  }
  for(const e of entities) {
    if(e.kind==='line') { include(e.start);include(e.end); }
    else if(e.kind==='circle') {
      include({x:e.center.x-e.radiusMm,y:e.center.y-e.radiusMm});
      include({x:e.center.x+e.radiusMm,y:e.center.y+e.radiusMm});
    } else if(e.kind==='arc') {
      const start=mod(e.startAngleDeg),sweep=mod(e.endAngleDeg-e.startAngleDeg);
      include(onArc(e,start));include(onArc(e,start+sweep));
      // Cardinal extrema must be included: endpoint-only bounds crop arcs.
      for(const a of [0,90,180,270])if(mod(a-start)<=sweep+1e-10)include(onArc(e,a));
    }
  }
  if(![minX,minY,maxX,maxY].every(Number.isFinite))
    throw new RangeError('SVG preview: nonfinite drawing bounds');
  return {minX,minY,maxX,maxY};
}
/**
 * Turn a parsed DxfSketch into a deterministic standalone SVG sketch preview.
 * Source coordinates stay in mm; SVG Y is inverted for CAD-style Y-up.
 * ARC is a true circular SVG elliptical-arc segment, never a polyline.
 * This is a *visualization*, not an imported INTENT journal, certified STEP,
 * physical validation, drawing tolerance or machining document.
 */
export function renderDxfSketchSvg(source, {paddingMm=5,strokeWidthMm=0.3}={}) {
  const d=validateDxfSketch(source);
  if(!Number.isFinite(paddingMm)||paddingMm<0||!Number.isFinite(strokeWidthMm)||strokeWidthMm<=0)
    throw new RangeError('SVG preview: padding and stroke must be finite nonnegative/positive millimetres');
  const b=extents(d.entities),width=b.maxX-b.minX+2*paddingMm,
    height=b.maxY-b.minY+2*paddingMm;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
    throw new RangeError('SVG preview: invalid extent');
  const vbox=[b.minX-paddingMm,-b.maxY-paddingMm,width,height].map(fmt).join(' ');
  const attrs=e=>'data-entity-id="'+xml(e.id)+'" data-layer="'+xml(e.layer)+'" data-kind="'+e.kind+'"'
     +(e.sourceHandle?' data-source-handle="'+xml(e.sourceHandle)+'"':'');
  const fpt=p=>fmt(p.x)+' '+fmt(-p.y);
  const shapes=d.entities.map(e=>{
    if(e.kind==='line')
      return '    <path '+attrs(e)+' d="M '+fpt(e.start)+' L '+fpt(e.end)+'"/>';
    if(e.kind==='circle')
      return '    <circle '+attrs(e)+' cx="'+fmt(e.center.x)+'" cy="'+fmt(-e.center.y)+'" r="'+fmt(e.radiusMm)+'"/>';
    const start=mod(e.startAngleDeg),sweep=mod(e.endAngleDeg-e.startAngleDeg);
    return '    <path '+attrs(e)+' d="M '+fpt(onArc(e,start))+
      ' A '+fmt(e.radiusMm)+' '+fmt(e.radiusMm)+' 0 '+(sweep>180?1:0)+
      ' 0 '+fpt(onArc(e,start+sweep))+'"/>';
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+fmt(width)+'mm" height="'+fmt(height)+'mm" viewBox="'+vbox+'">',
    '  <title>INTUIT3D sketch preview</title>',
    '  <desc>Analytic 2D DXF sketch in millimetres; preview only, not an exact B-rep, STEP or manufacturing drawing.</desc>',
    '  <g fill="none" stroke="#222" stroke-width="'+fmt(strokeWidthMm)+'" stroke-linecap="round" stroke-linejoin="round">',
    ...shapes,
    '  </g>',
    '</svg>',''
  ].join('\n');
}
