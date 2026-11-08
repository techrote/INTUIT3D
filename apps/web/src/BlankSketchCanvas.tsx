import {useEffect,useRef,useState} from 'react';
import type {MouseEvent,PointerEvent as ReactPointerEvent} from 'react';
import {
  canCloseBlankContour,placeBlankContourPointer,type BlankContourDraft,type SketchLocalPoint,
} from './blankContourDraft';
import {DEFAULT_BLANK_CANVAS_VIEW,panBlankCanvas,zoomBlankCanvas,
  type BlankCanvasView} from './blankCanvasView';

const Y_ORIGIN=120;
export function BlankSketchCanvas({
  draft,disabled,onBegin,onPoint,onUndoPoint,onCancel,onClose,runtimeReady,
}: {
  draft:BlankContourDraft|null;
  disabled:boolean; runtimeReady:boolean;
  onBegin:()=>void;onPoint:(point:SketchLocalPoint)=>void;
  onUndoPoint:()=>void;onCancel:()=>void;onClose:()=>void;
}) {
  const [hover,setHover]=useState<SketchLocalPoint|null>(null);
  const [view,setView]=useState<BlankCanvasView>(DEFAULT_BLANK_CANVAS_VIEW);
  const canvas=useRef<SVGSVGElement|null>(null);
  const pan=useRef<{pointerId:number;startX:number;startY:number;
    screenInverse:DOMMatrix;view:BlankCanvasView}|null>(null);
  const zoomAtCenter=(factor:number)=>setView(current=>zoomBlankCanvas(current,{
    x:current.x+current.width/2,y:current.y+current.height/2,
  },factor));
  // React's delegated wheel listener can be passive. Native non-passive
  // listener prevents scrolling the whole workbench while zooming this sketch.
  useEffect(()=>{
    const svg=canvas.current;
    if(!svg)return;
    const onWheel=(event:WheelEvent)=>{
      const matrix=svg.getScreenCTM();
      if(!matrix)return;
      let point:DOMPoint;
      try{point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());}
      catch{return;}
      event.preventDefault();
      const factor=Math.exp(Math.sign(event.deltaY)*0.25);
      setView(current=>zoomBlankCanvas(current,point,factor));
    };
    svg.addEventListener('wheel',onWheel,{passive:false});
    return()=>svg.removeEventListener('wheel',onWheel);
  },[]);
  // Middle-drag uses the original inverse matrix for the entire gesture:
  // each changing viewBox must not feed back into the next pointer delta.
  const startPan=(event:ReactPointerEvent<SVGSVGElement>)=>{
    if(event.button!==1)return;
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    try{
      pan.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
        screenInverse:matrix.inverse(),view};
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      setHover(null);
    }catch{pan.current=null;}
  };
  const movePan=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const gesture=pan.current;
    if(!gesture||event.pointerId!==gesture.pointerId)return false;
    const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
    const m=gesture.screenInverse;
    setView(panBlankCanvas(gesture.view,{
      x:m.a*dx+m.c*dy,y:m.b*dx+m.d*dy,
    }));
    return true;
  };
  const endPan=(event:ReactPointerEvent<SVGSVGElement>)=>{
    if(pan.current?.pointerId!==event.pointerId)return;
    pan.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const pointer=(event:MouseEvent<SVGSVGElement>):SketchLocalPoint|null=>{
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return null;
    try{
      const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      return placeBlankContourPointer({x:p.x,y:Y_ORIGIN-p.y},event.shiftKey);
    }catch{return null;/* Missing/invalid CTM never invents an origin. */}
  };
  const capture=(event:MouseEvent<SVGSVGElement>)=>{
    if(!draft||disabled||event.button!==0)return;
    const point=pointer(event);
    if(point)onPoint(point);
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
      <span role="group" aria-label="Blank sketch navigation">
        <button type="button" className="ribbon-button" data-testid="runtime-blank-zoom-in"
          onClick={()=>zoomAtCenter(1/1.4)}>Zoom in</button>
        <button type="button" className="ribbon-button" data-testid="runtime-blank-zoom-out"
          onClick={()=>zoomAtCenter(1.4)}>Zoom out</button>
        <button type="button" className="ribbon-button" data-testid="runtime-blank-view-reset"
          onClick={()=>setView(DEFAULT_BLANK_CANVAS_VIEW)}>Reset view</button>
      </span>
    </div>
    <svg ref={canvas} data-testid="runtime-blank-sketch" className="runtime-blank-canvas"
      viewBox={view.x+' '+view.y+' '+view.width+' '+view.height}
      preserveAspectRatio="xMidYMid meet"
      aria-label="Empty XY sketch canvas: left-click vertices, wheel zoom, middle-drag pan"
      onClick={capture}
      onPointerDown={startPan}
      onPointerMove={event=>{
        if(!movePan(event))setHover(draft&&!disabled?pointer(event):null);
      }}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={()=>{pan.current=null;}}
      onMouseLeave={()=>setHover(null)}
      style={{cursor:pan.current?'grabbing':draft&&!disabled?'crosshair':'default'}}>
      <defs><pattern id="blank-grid-10mm" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#49616e" strokeWidth=".15"/>
      </pattern></defs>
      <rect x={view.x} y={view.y} width={view.width} height={view.height}
        fill="#162535" pointerEvents="all"/>
      <rect x={view.x} y={view.y} width={view.width} height={view.height}
        fill="url(#blank-grid-10mm)" pointerEvents="none"/>
      <g transform="translate(0 120) scale(1 -1)" pointerEvents="none">
        <path d="M -20 0 H 220 M 0 -20 V 140" stroke="#7797a7" strokeWidth=".35" fill="none"/>
        {points.length>0&&<polyline data-testid="runtime-contour-preview"
          points={points.map(p=>p.x+','+p.y).join(' ')}
          fill="none" stroke="#7bdfec" strokeWidth="1.3" vectorEffect="non-scaling-stroke"/>}
        {points.map((p,i)=><circle key={i} data-testid={'runtime-draft-vertex-'+i}
          cx={p.x} cy={p.y} r="1.5" fill={i===0?'#ffdb92':'#76e0e9'}
          stroke="#183440" strokeWidth=".4"/> )}
        {draft&&hover&&<>
          {points.length>0&&<line data-testid="runtime-contour-pointer-guide"
            x1={points[points.length-1].x} y1={points[points.length-1].y}
            x2={hover.x} y2={hover.y} stroke="#a2b8c8" strokeWidth=".65"
            strokeDasharray="2 2" vectorEffect="non-scaling-stroke"/>}
          <circle data-testid="runtime-contour-pointer-snap"
            cx={hover.x} cy={hover.y} r="1.8" fill="none"
            stroke="#ffdc8d" strokeWidth=".8" vectorEffect="non-scaling-stroke"/>
        </>}
      </g>
      <text x="-16" y="-12" fill="#93b6c8" fontSize="4">SKETCH XY · MILLIMETRES · ANALYTIC ONLY</text>
      <text x="-16" y="-6" fill="#abd6df" fontSize="3.5"
        data-testid="runtime-contour-pointer-coordinate" aria-live="off">
        {draft&&hover?`NEXT X ${hover.x.toFixed(3)} · Y ${hover.y.toFixed(3)} mm`:
          '1 MM SNAP · SHIFT: 0.001 MM'}
      </text>
    </svg>
    <p data-testid="runtime-blank-contour-guidance" className="microcopy">
      {draft?'Click 3–12 vertices. Wheel zooms about the pointer; middle-drag pans; Reset view restores the initial drawing area. The 10 mm grid is visual; clicks snap to 1 mm, or 0.001 mm with Shift. Close commits only after SKETCH/RUNTIME admission. Escape cancels.':
        'This sketch has no seeded outline or holes. Start drawing to create the first solver-owned profile. Wheel zooms, middle-drag pans, and Reset view returns to the origin.'}
      {!runtimeReady&&<strong data-testid="runtime-contour-dependency"> RUNTIME #319 structural journal admission pending; Close will refuse without modifying the model.</strong>}
    </p>
  </div>;
}
