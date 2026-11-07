import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PlateProfile } from '@intuit3d/sketch';

/** A visually useful, disposable tessellation of the ACTUAL admitted SKETCH
 * profile. Never used as document state, a STEP source, or geometric proof. */
export function RuntimeGeometryViewport({ profile, thickness, sketchMode }: {
  profile: PlateProfile; thickness: number; sketchMode: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const xs = profile.outer.map(p => p.x), ys = profile.outer.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = Math.max(1, maxX-minX), height = Math.max(1,maxY-minY);
  const frame = `${minX-width*.12} ${minY-height*.12} ${width*1.24} ${height*1.24}`;

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
    viewBox={frame} aria-label="Solved SKETCH boundary and circular holes in millimetres">
    <g transform={`translate(0 ${minY+maxY}) scale(1 -1)`}>
      <polygon points={profile.outer.map(p=>`${p.x},${p.y}`).join(' ')}
        fill="#34758b22" stroke="#76d1e5" strokeWidth=".5" vectorEffect="non-scaling-stroke"/>
      {profile.holes.map(h=><circle key={h.id} cx={h.x} cy={h.y} r={h.radius} fill="#152332"
        stroke="#e4be81" strokeWidth=".5" vectorEffect="non-scaling-stroke"/>)}
    </g>
    <text x={minX+2} y={minY+8} fontSize={Math.max(2,width/30)} fill="#d1e5f1">
      `SKETCH solver · analytic profile only`
    </text>
  </svg> : <div ref={host} className="runtime-3d-canvas" data-testid="runtime-3d-viewport" />;
}
