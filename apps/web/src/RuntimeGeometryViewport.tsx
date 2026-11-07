import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PlateProfile } from '@intuit3d/sketch';
import { handleDimensionAtPoint, nudgeSketchHandle, type SketchDimensionHandle } from './runtimeSketchHandles';
import { circleDrawingPreview, type CircleDrawingState } from './circleDrawing';

/** A visually useful, disposable tessellation of the ACTUAL admitted SKETCH
 * profile. Never used as document state, a STEP source, or geometric proof. */
type HoleId = string;
export function RuntimeGeometryViewport({ profile, thickness, sketchMode, onHoleMove, onDimensionEdit, circleDrawing, onCirclePick }: {
  profile: PlateProfile; thickness: number; sketchMode: boolean;
  onHoleMove?: (id: HoleId,x:number,y:number)=>void;
  onDimensionEdit?: (id: SketchDimensionHandle, millimetres:number)=>void;
  circleDrawing?: CircleDrawingState;
  onCirclePick?: (x:number,y:number)=>void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const moving = useRef<{id:HoleId;pointerId:number}|null>(null);
  const [dragPreview,setDragPreview] = useState<{id:HoleId;x:number;y:number}|null>(null);
  const [circleHover,setCircleHover]=useState<{x:number;y:number}|null>(null);
  const dimensionMove=useRef<{id:SketchDimensionHandle;pointerId:number;source:PlateProfile;original:number}|null>(null);
  const [dimensionPreview,setDimensionPreview]=useState<{id:SketchDimensionHandle;value:number}|null>(null);
  const xs = profile.outer.map(p => p.x), ys = profile.outer.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = Math.max(1, maxX-minX), height = Math.max(1,maxY-minY);
  const frame = `${minX-width*.12} ${minY-height*.12} ${width*1.24} ${height*1.24}`;
  const bounds={minX,minY,maxX,maxY};
  const holeA=profile.holes.find(h=>h.id==='holeA');
  const holeB=profile.holes.find(h=>h.id==='holeB');
  // Unknown/missing semantic holes never acquire synthetic editable handles.
  const centers={holeA:{x:holeA?.x??NaN,y:holeA?.y??NaN},
                 holeB:{x:holeB?.x??NaN,y:holeB?.y??NaN}};
  const dimensionValue=(id:SketchDimensionHandle):number=>
    id==='width'?maxX-minX:id==='depth'?maxY-minY:
      id==='holeA.diameter'?2*(holeA?.radius??NaN):2*(holeB?.radius??NaN);
  const dimensionAnchor=(id:SketchDimensionHandle)=>
    id==='width'?{x:maxX,y:(minY+maxY)/2}:
    id==='depth'?{x:(minX+maxX)/2,y:maxY}:
    id==='holeA.diameter'?{x:(holeA?.x??NaN)+(holeA?.radius??NaN),y:holeA?.y??NaN}:
      {x:(holeB?.x??NaN)+(holeB?.radius??NaN),y:holeB?.y??NaN};
  // Actual DOM pointer conversion: viewBox scaling and letterboxing are handled
  // by the root SVG CTM, before undoing the sketch's vertical axis flip.
  const pointFromScreen=(svg:SVGSVGElement|null,xScreen:number,yScreen:number)=>{
    try{
      const screen=svg?.getScreenCTM();
      if(!screen)return null;
      const point=new DOMPoint(xScreen,yScreen).matrixTransform(screen.inverse());
      const x=point.x,y=minY+maxY-point.y;
      if(!Number.isFinite(x)||!Number.isFinite(y))return null;
      return {x,y};
    }catch{return null;}
  };
  const pointerPosition=(event:ReactPointerEvent<SVGCircleElement>)=>
    pointFromScreen(event.currentTarget.ownerSVGElement,event.clientX,event.clientY);
  const ghost=onCirclePick&&circleDrawing&&circleHover
    ?circleDrawingPreview(circleDrawing,circleHover):null;

  useEffect(() => {
    if (sketchMode || !host.current) return;
    const node = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#182738');
    const midX=(minX+maxX)/2, midY=(minY+maxY)/2, span=Math.max(width,height,thickness,1);
    const camera = new THREE.PerspectiveCamera(40,1,.1,Math.max(span*1000,1000));
    camera.position.set(midX+span*1.6,midY-span*1.45,thickness+span*1.55);
    const renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.domElement.setAttribute('aria-label','Model-backed analytic-profile tessellation, not exact CAD geometry');
    node.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera,renderer.domElement);
    controls.target.set(midX,midY,thickness/2);
    controls.enableDamping=true;
    controls.update();
    scene.add(new THREE.AmbientLight(0xffffff,1.6));
    const key = new THREE.DirectionalLight(0xffffff,2);
    key.position.set(midX-span,midY-span,span*2);
    scene.add(key);
    const shape = new THREE.Shape();
    profile.outer.forEach((p,i)=>i===0?shape.moveTo(p.x,p.y):shape.lineTo(p.x,p.y));
    shape.closePath();
    for(const h of profile.holes){
      const hole = new THREE.Path();
      hole.absarc(h.x,h.y,h.radius,0,Math.PI*2,true);
      shape.holes.push(hole);
    }
    const geometry = new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:36});
    const material = new THREE.MeshStandardMaterial({color:'#5ca5b6',metalness:.28,roughness:.46,side:THREE.DoubleSide});
    const body = new THREE.Mesh(geometry,material);
    scene.add(body);
    const edgeGeometry = new THREE.EdgesGeometry(geometry,20);
    const edgeMaterial = new THREE.LineBasicMaterial({color:'#a3d9e7',transparent:true,opacity:.55});
    scene.add(new THREE.LineSegments(edgeGeometry,edgeMaterial));
    const resize = () => {
      const rect = node.getBoundingClientRect();
      if(rect.width<=0||rect.height<=0)return;
      camera.aspect=rect.width/rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width,rect.height,false);
    };
    const observer=new ResizeObserver(resize);
    observer.observe(node);resize();
    let frameId=0,alive=true;
    const animate=()=>{if(!alive)return;controls.update();renderer.render(scene,camera);frameId=requestAnimationFrame(animate);};
    animate();
    return ()=>{alive=false;cancelAnimationFrame(frameId);observer.disconnect();controls.dispose();
      edgeGeometry.dispose();edgeMaterial.dispose();geometry.dispose();material.dispose();
      renderer.dispose();renderer.domElement.remove();};
  },[profile,thickness,sketchMode,minX,maxX,minY,maxY,width,height]);

  return sketchMode ? <svg data-testid="runtime-sketch" className="runtime-sketch-svg"
    viewBox={frame} aria-label="Solved SKETCH boundary and circular holes in millimetres"
    style={onCirclePick?{cursor:'crosshair'}:undefined}
    onPointerMove={event=>{
      if(onCirclePick)setCircleHover(pointFromScreen(event.currentTarget,event.clientX,event.clientY));
    }}
    onPointerLeave={()=>setCircleHover(null)}
    onClick={event=>{
      if(!onCirclePick||event.button!==0)return;
      const point=pointFromScreen(event.currentTarget,event.clientX,event.clientY);
      if(point)onCirclePick(point.x,point.y);
    }}>
    <g transform={`translate(0 ${minY+maxY}) scale(1 -1)`}
       pointerEvents={onCirclePick?'none':undefined}>
      <polygon points={profile.outer.map(p=>`${p.x},${p.y}`).join(' ')}
        fill="#34758b22" stroke="#76d1e5" strokeWidth=".5" vectorEffect="non-scaling-stroke"/>
      {profile.holes.map(h=><g key={h.id}>
        <circle data-testid={`runtime-sketch-outline-hole-${h.id}`} cx={h.x} cy={h.y} r={h.radius} fill="#152332"
          stroke="#e4be81" strokeWidth=".5" vectorEffect="non-scaling-stroke"/>
        {onHoleMove&&
          <circle data-testid={`runtime-sketch-hole-${h.id}`}
            aria-label={`Drag ${h.id} center`}
            cx={h.x} cy={h.y} r={Math.max(2,Math.min(width,height)/35)}
            fill="#eef6ed" stroke="#174d69" strokeWidth=".7"
            style={{cursor:'grab',touchAction:'none'}}
            onPointerDown={event=>{
              if(event.button!==0)return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              moving.current={id:h.id as HoleId,pointerId:event.pointerId};
              setDragPreview({id:h.id as HoleId,x:h.x,y:h.y});
            }}
            onPointerMove={event=>{
              if(moving.current?.id!==h.id||moving.current.pointerId!==event.pointerId)return;
              const point=pointerPosition(event);
              if(point)setDragPreview({id:h.id as HoleId,x:Math.round(point.x*2)/2,y:Math.round(point.y*2)/2});
            }}
            onPointerUp={event=>{
              if(moving.current?.id!==h.id||moving.current.pointerId!==event.pointerId)return;
              const point=pointerPosition(event);
              moving.current=null;setDragPreview(null);
              if(point){
                const x=Math.round(point.x*2)/2,y=Math.round(point.y*2)/2;
                if(x!==h.x||y!==h.y)onHoleMove(h.id as HoleId,x,y);
              }
            }}
            onPointerCancel={()=>{moving.current=null;setDragPreview(null);}}
          />}
      </g>)}
      {onDimensionEdit&&(['width','depth','holeA.diameter','holeB.diameter'] as const)
        .filter(id=>Number.isFinite(dimensionValue(id)))
        .map(id=>{
          const at=dimensionAnchor(id),current=dimensionValue(id);
          return <circle key={id} data-testid={`runtime-sketch-dimension-${id}`}
            role="slider" tabIndex={0} aria-label={`Edit ${id.replace('.', ' ')} in millimetres`}
            aria-valuemin={0.1} aria-valuemax={10000} aria-valuenow={current}
            cx={at.x} cy={at.y} r={Math.max(2.2,Math.min(width,height)/40)}
            fill="#6af0cd" stroke="#103d4a" strokeWidth=".8"
            style={{cursor:id==='depth'?'ns-resize':'ew-resize',touchAction:'none'}}
            onPointerDown={event=>{
              if(event.button!==0||moving.current)return;
              event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
              dimensionMove.current={id,pointerId:event.pointerId,source:profile,original:current};
              setDimensionPreview({id,value:current});
            }}
            onPointerMove={event=>{
              const active=dimensionMove.current;
              if(!active||active.id!==id||active.pointerId!==event.pointerId||active.source!==profile)return;
              const point=pointerPosition(event);
              const value=point&&handleDimensionAtPoint(id,point,bounds,centers,event.shiftKey);
              if(value!==null&&value!==undefined)setDimensionPreview({id,value});
            }}
            onPointerUp={event=>{
              const active=dimensionMove.current;
              if(!active||active.id!==id||active.pointerId!==event.pointerId)return;
              dimensionMove.current=null;setDimensionPreview(null);
              if(active.source!==profile)return;
              const point=pointerPosition(event);
              const value=point&&handleDimensionAtPoint(id,point,bounds,centers,event.shiftKey);
              if(value!==null&&value!==undefined&&value!==active.original)onDimensionEdit(id,value);
            }}
            onPointerCancel={()=>{dimensionMove.current=null;setDimensionPreview(null);}}
            onLostPointerCapture={()=>{dimensionMove.current=null;setDimensionPreview(null);}}
            onKeyDown={event=>{
              if(event.key==='Escape'){
                dimensionMove.current=null;setDimensionPreview(null);event.preventDefault();return;
              }
              if(event.key.startsWith('Arrow')){
                event.preventDefault();
                const value=nudgeSketchHandle(id,current,event.key,event.shiftKey);
                if(value!==null&&value!==current)onDimensionEdit(id,value);
              }
            }}/>;
        })}
      {dimensionPreview&&<>
        {dimensionPreview.id==='width'&&<line x1={minX+dimensionPreview.value} y1={minY}
          x2={minX+dimensionPreview.value} y2={maxY} stroke="#6af0cd"
          strokeDasharray="2 2" strokeWidth=".55" pointerEvents="none"/>}
        {dimensionPreview.id==='depth'&&<line x1={minX} y1={minY+dimensionPreview.value}
          x2={maxX} y2={minY+dimensionPreview.value} stroke="#6af0cd"
          strokeDasharray="2 2" strokeWidth=".55" pointerEvents="none"/>}
        {dimensionPreview.id.endsWith('.diameter')&&
          <circle cx={centers[dimensionPreview.id.startsWith('holeA')?'holeA':'holeB'].x}
            cy={centers[dimensionPreview.id.startsWith('holeA')?'holeA':'holeB'].y}
            r={dimensionPreview.value/2} fill="none" stroke="#6af0cd"
            strokeDasharray="2 2" strokeWidth=".55" pointerEvents="none"/>}
      </>}
      {ghost&&<circle data-testid="runtime-sketch-circle-preview"
        cx={ghost.x} cy={ghost.y} r={ghost.radius || Math.max(1.5,Math.min(width,height)/60)}
        fill="#6af0cd24" stroke="#6af0cd" strokeDasharray="2 1"
        strokeWidth=".55" pointerEvents="none"/>}
      {dragPreview&&<circle cx={dragPreview.x} cy={dragPreview.y}
        r={Math.max(2.5,Math.min(width,height)/30)}
        fill="#6af0cd55" stroke="#84f2d3" strokeDasharray="1 1"
        strokeWidth=".6" pointerEvents="none"/>}
    </g>
    <text x={minX+2} y={minY+8} fontSize={Math.max(2,width/30)} fill="#d1e5f1">
      SKETCH solver · analytic profile only
    </text>
    {onDimensionEdit&&<text x={maxX-2} y={(minY+maxY)/2-6} textAnchor="end"
      fontSize={Math.max(2,width/43)} fill="#a5f2de" pointerEvents="none">
      W {dimensionPreview?.id==='width'?dimensionPreview.value:width} mm
    </text>}
    {onDimensionEdit&&<text x={(minX+maxX)/2-3} y={minY+14} textAnchor="end"
      fontSize={Math.max(2,width/43)} fill="#a5f2de" pointerEvents="none">
      D {dimensionPreview?.id==='depth'?dimensionPreview.value:height} mm
    </text>}
  </svg> : <div ref={host} className="runtime-3d-canvas" data-testid="runtime-3d-viewport" />;
}
