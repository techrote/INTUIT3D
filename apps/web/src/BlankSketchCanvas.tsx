import type {MouseEvent} from 'react';
import {
  canCloseBlankContour,type BlankContourDraft,type SketchLocalPoint,
  undoBlankContourVertex,
} from './blankContourDraft';

const Y_ORIGIN=120;
export function BlankSketchCanvas({
  draft,disabled,onBegin,onPoint,onUndoPoint,onCancel,onClose,runtimeReady,
}: {
  draft:BlankContourDraft|null;
  disabled:boolean; runtimeReady:boolean;
  onBegin:()=>void;onPoint:(point:SketchLocalPoint)=>void;
  onUndoPoint:()=>void;onCancel:()=>void;onClose:()=>void;
}) {
  const capture=(event:MouseEvent<SVGSVGElement>)=>{
    if(!draft||disabled||event.button!==0)return;
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    try{
      const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      const x=Math.round(p.x*1000)/1000,y=Math.round((Y_ORIGIN-p.y)*1000)/1000;
      if(Number.isFinite(x)&&Number.isFinite(y))onPoint({x,y});
    }catch{/* Missing/invalid CTM refuses a pointer; never invent origin. */}
  };
  const points=draft?.vertices??[];
  return <div className="runtime-blank-stage" data-testid="runtime-empty-sketch-stage">
    <div className="runtime-blank-toolbar" role="group" aria-label="Closed outline authoring">
      {!draft?<button type="button" className="ribbon-button" data-testid="runtime-begin-blank-contour"
        disabled={disabled} onClick={onBegin}>Draw outline · click vertices</button>:<>
        <span data-testid="runtime-contour-vertex-count">{points.length} / 12 vertices</span>
        <button type="button" className="ribbon-button" data-testid="runtime-undo-contour-point"
          disabled={disabled||!points.length} onClick={onUndoPoint}>Undo vertex</button>
        <button type="button" className="ribbon-button" data-testid="runtime-close-contour"
          disabled={disabled||!canCloseBlankContour(draft)} onClick={onClose}>Close outline</button>
        <button type="button" className="ribbon-button" data-testid="runtime-cancel-contour"
          disabled={disabled} onClick={onCancel}>Cancel</button>
      </>}
    </div>
    <svg data-testid="runtime-blank-sketch" className="runtime-blank-canvas"
      viewBox="-20 -20 240 160" preserveAspectRatio="xMidYMid meet"
      aria-label="Empty XY sketch canvas: left-click to place sketch-local vertices in millimetres"
      onClick={capture} style={{cursor:draft&&!disabled?'crosshair':'default'}}>
      <defs><pattern id="blank-grid-10mm" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#49616e" strokeWidth=".15"/>
      </pattern></defs>
      <rect x="-20" y="-20" width="240" height="160" fill="#162535" pointerEvents="all"/>
      <rect x="-20" y="-20" width="240" height="160" fill="url(#blank-grid-10mm)" pointerEvents="none"/>
      <g transform="translate(0 120) scale(1 -1)" pointerEvents="none">
        <path d="M -20 0 H 220 M 0 -20 V 140" stroke="#7797a7" strokeWidth=".35" fill="none"/>
        {points.length>0&&<polyline data-testid="runtime-contour-preview"
          points={points.map(p=>p.x+','+p.y).join(' ')}
          fill="none" stroke="#7bdfec" strokeWidth="1.3" vectorEffect="non-scaling-stroke"/>}
        {points.map((p,i)=><circle key={i} data-testid={'runtime-draft-vertex-'+i}
          cx={p.x} cy={p.y} r="1.5" fill={i===0?'#ffdb92':'#76e0e9'}
          stroke="#183440" strokeWidth=".4"/>)}
      </g>
      <text x="-16" y="-12" fill="#93b6c8" fontSize="4">SKETCH XY · MILLIMETRES · ANALYTIC ONLY</text>
    </svg>
    <p data-testid="runtime-blank-contour-guidance" className="microcopy">
      {draft?'Click 3–12 different vertices, then Close. No CAD revision exists until SKETCH and RUNTIME admit the entire closed contour. Escape cancels.':
        'This sketch has no seeded outline or holes. Start drawing to create the first solver-owned profile.'}
      {!runtimeReady&&<strong data-testid="runtime-contour-dependency"> RUNTIME #319 structural journal admission pending; Close will refuse without modifying the model.</strong>}
    </p>
  </div>;
}
