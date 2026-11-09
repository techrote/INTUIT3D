import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { frameCadCamera, type CameraViewPreset } from './cameraViews';
import { pickTopFaceHole } from './solidHolePick';
import type { PlateProfile } from '@intuit3d/sketch';
import type {ContourOffsetEdge} from '@intuit3d/sketch/contour-edge-offset/v1';
import { handleDimensionAtPoint, nudgeSketchHandle, type SketchDimensionHandle } from './runtimeSketchHandles';
import { circleDrawingPreview, type CircleDrawingState } from './circleDrawing';
import { radialHoleDiameter, nudgeHoleDiameter } from './holeDiameterDrag';
import { projectThicknessAxis, proposeThicknessDrag, nudgeThickness, type ScreenPoint, type ThicknessDrag } from './thicknessDrag';
import { panBlankCanvas, zoomBlankCanvas, type BlankCanvasView } from './blankCanvasView';

/** A visually useful, disposable tessellation of the ACTUAL admitted SKETCH
 * profile. Never used as document state, a STEP source, or geometric proof. */
type HoleId = string;
export function RuntimeGeometryViewport({ profile, thickness, sketchMode, onHoleMove, onDimensionEdit, onHoleDiameterEdit, onHoleSelect, selectedHoleId, selectedHoleIds, circleDrawing, onCirclePick, onThicknessEdit, onProfilePick, profileEditHandle, onProfileHandleDrag,
  contourEdges, selectedContourEdgeId, onContourEdgePick, onContourEdgeDrag, onContourEdgeOffset,
  tabPoints,tabEdge,onTabPoint,sketchProjectKey,contourVertexHandles,onContourVertexPick,onContourVertexDrag }: {
  profile: PlateProfile; thickness: number; sketchMode: boolean;
  /** Clear ephemeral navigation on project replacement; never on a CAD edit. */
  sketchProjectKey?: string;
  onHoleMove?: (id: HoleId,x:number,y:number,selectedIds?:readonly HoleId[])=>void;
  onDimensionEdit?: (id: SketchDimensionHandle, millimetres:number)=>void;
  /** Commits only after SKETCH/RUNTIME has admitted the edited circle. */
  onHoleDiameterEdit?: (id: HoleId,diameterMm:number)=>void;
  onHoleSelect?: (id:HoleId,additive?:boolean)=>void;
  selectedHoleId?: string|null;
  selectedHoleIds?: readonly HoleId[];
  circleDrawing?: CircleDrawingState;
  onCirclePick?: (x:number,y:number)=>void;
  /** Commits extrusion thickness through the authoritative INTENT/RUNTIME journal. */
  onThicknessEdit?: (millimetres:number)=>void;
  /** Explicitly select a solver-admitted contour; pixel positions are never CAD authority. */
  onProfilePick?: (x:number,y:number)=>void;
  /** One explicitly chosen semantic handle; colocated handles require user choice. */
  profileEditHandle?: {handleId:string;position:{x:number;y:number}}|null;
  onProfileHandleDrag?: (handleId:string,x:number,y:number)=>void;
  /** SKETCH-inspected handles only. Clicking selects an exact semantic ID,
   * never a nearest inferred vertex; coincident points retain the inspector fallback. */
  contourVertexHandles?:readonly {handleId:string;position:{x:number;y:number}}[];
  onContourVertexPick?:(handleId:string)=>void;
  /** Direct drag commits only through the selected SKETCH/RUNTIME structural editor. */
  onContourVertexDrag?:(handleId:string,x:number,y:number)=>void;
  /** Only current SKETCH-inspected source-owned edges may render manipulators. */
  contourEdges?:readonly ContourOffsetEdge[];
  selectedContourEdgeId?:string;
  onContourEdgePick?:(edgeId:string)=>void;
  onContourEdgeDrag?:(edgeId:string,start:{x:number;y:number},target:{x:number;y:number})=>void;
  onContourEdgeOffset?:(edgeId:string,offsetMm:number)=>void;
  /** Uncommitted, entirely ephemeral two-point tab overlay. */
  tabPoints?:readonly {x:number;y:number}[];
  tabEdge?:ContourOffsetEdge|null;
  onTabPoint?:(x:number,y:number,precise:boolean)=>void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // A long-lived Three.js canvas must always call the latest React selection callback.
  const solidSelect = useRef(onHoleSelect);
  solidSelect.current = onHoleSelect;
  const thicknessGrip = useRef<HTMLButtonElement>(null);
  const thicknessAxis = useRef<ScreenPoint|null>(null);
  const thicknessMove = useRef<(ThicknessDrag & { pointerId:number })|null>(null);
  const [thicknessPreview,setThicknessPreview] = useState<number|null>(null);
  const [sketchView,setSketchView] = useState<BlankCanvasView|null>(null);
  const sketchSvg=useRef<SVGSVGElement|null>(null);
  const sketchPan=useRef<{pointerId:number;startX:number;startY:number;
    inverse:DOMMatrix;origin:BlankCanvasView}|null>(null);
  const moving = useRef<{id:HoleId;pointerId:number;groupIds:readonly HoleId[]}|null>(null);
  const [dragPreview,setDragPreview] = useState<{id:HoleId;x:number;y:number}|null>(null);
  const radialMove=useRef<{id:HoleId;pointerId:number;source:PlateProfile;original:number}|null>(null);
  const [radialPreview,setRadialPreview]=useState<{id:HoleId;diameter:number}|null>(null);
  const [circleHover,setCircleHover]=useState<{x:number;y:number}|null>(null);
  const dimensionMove=useRef<{id:SketchDimensionHandle;pointerId:number;source:PlateProfile;original:number}|null>(null);
  const [dimensionPreview,setDimensionPreview]=useState<{id:SketchDimensionHandle;value:number}|null>(null);
  const profileMove=useRef<{handleId:string;pointerId:number;source:PlateProfile;
    startScreen:{x:number;y:number}}|null>(null);
  const [profilePreview,setProfilePreview]=useState<{x:number;y:number}|null>(null);
  // The pointer proposal stays ephemeral. Parent commits source-owned geometry via RUNTIME.
  const contourVertexMove=useRef<{handleId:string;pointerId:number;source:PlateProfile;
    startScreen:{x:number;y:number}}|null>(null);
  const [contourVertexPreview,setContourVertexPreview]=useState<
    {handleId:string;x:number;y:number}|null>(null);
  const contourMove=useRef<{edgeId:string;pointerId:number;source:PlateProfile;
    start:{x:number;y:number}}|null>(null);
  const [contourPreview,setContourPreview]=useState<{edgeId:string;offsetMm:number}|null>(null);
  const xs = profile.outer.map(p => p.x), ys = profile.outer.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = Math.max(1, maxX-minX), height = Math.max(1,maxY-minY);
  const fittedSketchView:BlankCanvasView={
    x:minX-width*.12,y:minY-height*.12,width:width*1.24,height:height*1.24,
  };
  const activeSketchView=sketchView??fittedSketchView;
  const sketchViewBox=`${activeSketchView.x} ${activeSketchView.y} ${activeSketchView.width} ${activeSketchView.height}`;
  // Sketch handles remain display-legible while zooming; geometry, constraints
  // and the solver's millimetre coordinate system never change.
  const sketchMarkerScale=activeSketchView.width/fittedSketchView.width;
  const zoomSketchAtCenter=(factor:number)=>setSketchView(previous=>{
    const view=previous??fittedSketchView;
    return zoomBlankCanvas(view,{x:view.x+view.width/2,y:view.y+view.height/2},factor);
  });
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
  const pointerPosition=(event:ReactPointerEvent<SVGElement>)=>
    pointFromScreen(event.currentTarget.ownerSVGElement,event.clientX,event.clientY);
  const ghost=onCirclePick&&circleDrawing&&circleHover
    ?circleDrawingPreview(circleDrawing,circleHover):null;
  // The admitted sketch has the same ordinary wheel/middle-pan controls as
  // the empty drawing. The gesture's original inverse must be frozen: using a
  // moving viewBox's inverse would introduce pan drift or alter selection.
  useEffect(()=>{
    const svg=sketchSvg.current;
    if(!sketchMode||!svg)return;
    const onWheel=(event:WheelEvent)=>{
      const matrix=svg.getScreenCTM();
      if(!matrix)return;
      try{
        const anchor=new DOMPoint(event.clientX,event.clientY)
          .matrixTransform(matrix.inverse());
        event.preventDefault();
        setSketchView(previous=>zoomBlankCanvas(previous??{
          x:minX-width*.12,y:minY-height*.12,width:width*1.24,height:height*1.24,
        },anchor,Math.exp(Math.sign(event.deltaY)*.25)));
      }catch{/* No SVG matrix: do not invent a zoom origin. */}
    };
    svg.addEventListener('wheel',onWheel,{passive:false});
    return()=>svg.removeEventListener('wheel',onWheel);
  },[sketchMode,minX,minY,width,height]);
  useEffect(()=>{
    sketchPan.current=null;
    setSketchView(null);
  },[sketchProjectKey]);

  // A CAD revision changes the mesh, not the camera, OrbitControls, canvas or
  // WebGL context. These are browser presentation resources, never CAD state.
  const previewScene = useRef<{update:(profile:PlateProfile,thickness:number)=>void}|null>(null);
  // Only a disposable preview camera; this state never changes CAD authority.
  const cameraCommand = useRef<((view:CameraViewPreset|'fit')=>void)|null>(null);
  const [cameraView,setCameraView] = useState<CameraViewPreset|'custom'>('isometric');
  const [previewError,setPreviewError] = useState<string|null>(null);
  useEffect(() => {
    if (sketchMode || !host.current) return;
    const node=host.current;
    const scene=new THREE.Scene();
    scene.background=new THREE.Color('#182738');
    const camera=new THREE.PerspectiveCamera(40,1,.1,1000);
    const material=new THREE.MeshStandardMaterial({color:'#5ca5b6',metalness:.28,roughness:.46,side:THREE.DoubleSide});
    const edgeMaterial=new THREE.LineBasicMaterial({color:'#a3d9e7',transparent:true,opacity:.55});
    const light=new THREE.DirectionalLight(0xffffff,2);
    scene.add(new THREE.AmbientLight(0xffffff,1.6),light);
    let renderer:THREE.WebGLRenderer|null=null;
    let controls:OrbitControls|null=null;
    let observer:ResizeObserver|null=null;
    let body:THREE.Mesh|null=null;
    let edges:THREE.LineSegments|null=null;
    let geometry:THREE.ExtrudeGeometry|null=null;
    let edgeGeometry:THREE.EdgesGeometry|null=null;
    let lastProfile:PlateProfile|null=null, lastThickness:number|null=null;
    let lastCenter:THREE.Vector3|null=null;
    let projectedMaxX=0, projectedMidY=0, projectedThickness=0;
    let frameId=0, disposed=false, contextLost=false;
    let solidPointerStart:{pointerId:number;x:number;y:number;button:number}|null=null;
    const solidPicker=new THREE.Raycaster();
    const onSolidPointerDown=(event:PointerEvent)=>{
      solidPointerStart={pointerId:event.pointerId,x:event.clientX,y:event.clientY,button:event.button};
      if(renderer)renderer.domElement.dataset.pickTrace='down '+event.pointerId+'/'+event.button;
    };
    const markUserView=()=>{
      if(renderer)renderer.domElement.dataset.cameraPreset='custom';
      setCameraView('custom');
    };
    const onSolidPointerMove=(event:PointerEvent)=>{
      if(solidPointerStart && solidPointerStart.pointerId===event.pointerId &&
         Math.hypot(event.clientX-solidPointerStart.x,event.clientY-solidPointerStart.y)>4){
        solidPointerStart=null; // A drag must never accidentally pick a hole.
        markUserView();
      }
    };
    const onSolidWheel=()=>markUserView();
    const onSolidPointerCancel=()=>{solidPointerStart=null;};
    const onSolidPointerUp=(event:PointerEvent)=>{
      const start=solidPointerStart;
      solidPointerStart=null;
      if(renderer)renderer.domElement.dataset.pickTrace='up '+event.pointerId+'/'+event.button+' start '+JSON.stringify(start);
      if(!start||start.pointerId!==event.pointerId||start.button!==0||event.button!==0||
         Math.hypot(event.clientX-start.x,event.clientY-start.y)>4||
         !renderer||!geometry||!lastProfile||lastThickness===null||contextLost||!solidSelect.current)return;
      const rect=renderer.domElement.getBoundingClientRect();
      if(rect.width<=0||rect.height<=0)return;
      solidPicker.setFromCamera(new THREE.Vector2(
        (event.clientX-rect.left)/rect.width*2-1,
        1-(event.clientY-rect.top)/rect.height*2),camera);
      // The front and underside do not expose the top-face hole openings.
      // Do not select an occluded hole through the solid from these views.
      if(solidPicker.ray.direction.z>=-0.2)return;
      const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-lastThickness);
      const hit=solidPicker.ray.intersectPlane(plane,new THREE.Vector3());
      const id=hit&&pickTopFaceHole(hit,lastProfile.holes);
      renderer.domElement.dataset.pickTrace=JSON.stringify({dirZ:solidPicker.ray.direction.z,hit:hit&&[hit.x,hit.y],id,holes:lastProfile.holes.map(h=>[h.id,h.x,h.y])});
      if(id)solidSelect.current(id,event.ctrlKey||event.metaKey);
    };
    const dropMesh=()=>{
      if(body)scene.remove(body);
      if(edges)scene.remove(edges);
      body=null;edges=null;
      geometry?.dispose();edgeGeometry?.dispose();
      geometry=null;edgeGeometry=null;
    };
    const updateThicknessGrip=()=>{
      const handle=thicknessGrip.current;
      if(!handle)return;
      if(contextLost||!geometry){handle.hidden=true;thicknessAxis.current=null;return;}
      try{
        const rect=node.getBoundingClientRect();
        const project=(z:number)=>{
          const p=new THREE.Vector3(projectedMaxX,projectedMidY,z).project(camera);
          return {x:(p.x+1)*rect.width/2,y:(1-p.y)*rect.height/2};
        };
        const base=project(0),raised=project(projectedThickness);
        const axis=projectThicknessAxis(base,raised,projectedThickness);
        thicknessAxis.current=axis;
        handle.hidden=false;
        handle.style.left=raised.x+'px';handle.style.top=raised.y+'px';
        handle.dataset.axisX=String(axis.x);handle.dataset.axisY=String(axis.y);
      }catch{thicknessAxis.current=null;handle.hidden=true;}
    };
    // A camera preset changes world matrices before Three's next render. Keep
    // projected semantic-hole click markers source-matched to that camera,
    // not one GPU frame behind a just-selected TOP orientation.
    const publishHolePickMarkers=()=>{
      if(!renderer)return;
      camera.updateMatrixWorld(true);
      const displayedHoles=geometry && Array.isArray(lastProfile?.holes) && lastProfile.holes.length<=256
        ?lastProfile.holes:[];
      renderer.domElement.dataset.holePickMarkers=JSON.stringify(displayedHoles.map(h=>{
        const p=new THREE.Vector3(h.x,h.y,lastThickness??0).project(camera);
        return {id:h.id,x:(p.x+1)*renderer!.domElement.clientWidth/2,
          y:(1-p.y)*renderer!.domElement.clientHeight/2,depth:p.z};
      }).filter(p=>[p.x,p.y,p.depth].every(Number.isFinite)&&p.depth>=-1&&p.depth<=1));
    };
    // Demand-driven frames: OrbitControls emits changes during pointer drags
    // and damping, but the GPU does not render continuously while idle.
    const requestFrame=()=>{
      if(disposed||contextLost||frameId!==0||!renderer)return;
      frameId=requestAnimationFrame(()=>{
        frameId=0;
        if(disposed||contextLost||!renderer)return;
        try{
          controls?.update();
          camera.updateMatrixWorld(true);
          updateThicknessGrip();
          renderer.domElement.dataset.cameraPosition=[camera.position.x,camera.position.y,camera.position.z].map(x=>x.toFixed(4)).join(',');
          renderer.domElement.dataset.cameraTarget=[controls?.target.x??0,controls?.target.y??0,controls?.target.z??0].map(x=>x.toFixed(4)).join(',');
          // Display-only semantic projections never become geometry authority.
          publishHolePickMarkers();
          renderer.render(scene,camera);
        }catch{
          contextLost=true;
          thicknessAxis.current=null;
          setPreviewError('3D preview rendering failed. Sketch and authoritative model remain editable.');
        }
      });
    };
    const update=(nextProfile:PlateProfile,nextThickness:number)=>{
      if(disposed||(lastProfile===nextProfile&&lastThickness===nextThickness))return;
      let nextGeometry:THREE.ExtrudeGeometry|null=null;
      let nextEdges:THREE.EdgesGeometry|null=null;
      try{
        // A valid CAD model is not necessarily safe to tessellate as a browser
        // preview. Fail closed to a visible warning instead of choking the UI.
        if(nextProfile.outer.length<3||nextProfile.outer.length>512||
           nextProfile.holes.length>256||!Number.isFinite(nextThickness)||
           nextThickness<=0||nextThickness>10000)
          throw Error('Preview mesh exceeds bounded 3D limits.');
        const coords=[...nextProfile.outer.flatMap(p=>[p.x,p.y]),
          ...nextProfile.holes.flatMap(h=>[h.x,h.y,h.radius])];
        if(coords.some(v=>!Number.isFinite(v)||Math.abs(v)>10000)||
           nextProfile.holes.some(h=>h.radius<=0))
          throw Error('Preview profile has invalid geometry.');
        const xs=nextProfile.outer.map(p=>p.x),ys=nextProfile.outer.map(p=>p.y);
        const minX=Math.min(...xs),maxX=Math.max(...xs);
        const minY=Math.min(...ys),maxY=Math.max(...ys);
        const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY);
        const midX=(minX+maxX)/2,midY=(minY+maxY)/2;
        const span=Math.max(width,height,nextThickness,1);
        const shape=new THREE.Shape();
        nextProfile.outer.forEach((p,i)=>i===0?shape.moveTo(p.x,p.y):shape.lineTo(p.x,p.y));
        shape.closePath();
        for(const hole of nextProfile.holes){
          const path=new THREE.Path();
          path.absarc(hole.x,hole.y,hole.radius,0,Math.PI*2,true);
          shape.holes.push(path);
        }
        nextGeometry=new THREE.ExtrudeGeometry(shape,{
          depth:nextThickness,bevelEnabled:false,curveSegments:36,
        });
        nextEdges=new THREE.EdgesGeometry(nextGeometry,20);
        dropMesh();
        geometry=nextGeometry;edgeGeometry=nextEdges;
        body=new THREE.Mesh(geometry,material);
        edges=new THREE.LineSegments(edgeGeometry,edgeMaterial);
        scene.add(body,edges);
        const center=new THREE.Vector3(midX,midY,nextThickness/2);
        if(lastCenter){
          // Preserve the user's orbit and zoom; translate its target with the
          // edited model, rather than snapping back to the initial camera.
          const delta=center.clone().sub(lastCenter);
          camera.position.add(delta);controls?.target.add(delta);
        }else{
          camera.position.set(midX+span*1.6,midY-span*1.45,nextThickness+span*1.55);
          controls?.target.copy(center);
        }
        lastCenter=center;
        camera.far=Math.max(span*1000,1000);
        camera.updateProjectionMatrix();
        light.position.set(midX-span,midY-span,span*2);
        projectedMaxX=maxX;projectedMidY=midY;projectedThickness=nextThickness;
        controls?.update();
        lastProfile=nextProfile;lastThickness=nextThickness;
        setPreviewError(null);
        requestFrame();
      }catch{
        nextGeometry?.dispose();nextEdges?.dispose();
        dropMesh();
        lastProfile=nextProfile;lastThickness=nextThickness;
        thicknessAxis.current=null;
        setPreviewError('3D mesh preview is unavailable for this profile. The sketch, model and native STEP authority are unaffected.');
        requestFrame();
      }
    };
    const switchCameraView=(preset:CameraViewPreset|'fit')=>{
      if(!renderer||!controls||!lastCenter||!lastProfile||lastThickness===null||contextLost)return;
      try{
        const xs=lastProfile.outer.map(p=>p.x),ys=lastProfile.outer.map(p=>p.y);
        const frame=frameCadCamera({
          minX:Math.min(...xs),maxX:Math.max(...xs),
          minY:Math.min(...ys),maxY:Math.max(...ys),thickness:lastThickness,
        },Math.max(.1,node.clientWidth/Math.max(1,node.clientHeight)),
        preset==='fit'?'isometric':preset);
        const target=new THREE.Vector3(frame.center.x,frame.center.y,frame.center.z);
        // FIT keeps a manually chosen view direction. Presets align to the
        // sketch axes; neither operation reconstructs the canvas/renderer.
        const direction=preset==='fit'
          ?camera.position.clone().sub(controls.target).normalize()
          :new THREE.Vector3(frame.offset.x,frame.offset.y,frame.offset.z);
        if(direction.lengthSq()<.5)direction.set(1,-1,1).normalize();
        if(preset!=='fit'){
          camera.up.set(frame.up.x,frame.up.y,frame.up.z);
          renderer.domElement.dataset.cameraPreset=preset;
          setCameraView(preset);
        }
        controls.target.copy(target);
        camera.position.copy(target).addScaledVector(direction,frame.distance);
        camera.near=Math.max(.01,frame.distance/10000);
        camera.far=Math.max(1000,frame.distance+Math.hypot(
          frame.center.x,frame.center.y,frame.center.z)*10+1000);
        camera.updateProjectionMatrix();controls.update();
        camera.updateMatrixWorld(true);
        publishHolePickMarkers();
        // Publish the new camera pose *before* the next animation frame, so
        // actual browser click tests never read the preceding frame's pose.
        renderer.domElement.dataset.cameraPosition=[camera.position.x,camera.position.y,camera.position.z].map(x=>x.toFixed(4)).join(',');
        renderer.domElement.dataset.cameraTarget=[controls.target.x,controls.target.y,controls.target.z].map(x=>x.toFixed(4)).join(',');
        requestFrame();
      }catch{setPreviewError('Cannot frame this preview. The model remains unchanged.');}
    };
    const onContextLost=(event:Event)=>{
      event.preventDefault();
      contextLost=true;thicknessAxis.current=null;
      if(thicknessGrip.current)thicknessGrip.current.hidden=true;
      setPreviewError('3D graphics context lost. The model is preserved; use Sketch view while graphics recover.');
    };
    const onContextRestored=()=>{
      contextLost=false;setPreviewError(null);requestFrame();
    };
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      renderer.domElement.setAttribute('aria-label','Model-backed analytic-profile tessellation, not exact CAD geometry');
      renderer.domElement.addEventListener('webglcontextlost',onContextLost);
      renderer.domElement.addEventListener('webglcontextrestored',onContextRestored);
      node.appendChild(renderer.domElement);
      renderer.domElement.addEventListener('pointerdown',onSolidPointerDown);
      renderer.domElement.addEventListener('pointerup',onSolidPointerUp);
      renderer.domElement.addEventListener('pointermove',onSolidPointerMove);
      renderer.domElement.addEventListener('wheel',onSolidWheel);
      renderer.domElement.addEventListener('pointercancel',onSolidPointerCancel);
      controls=new OrbitControls(camera,renderer.domElement);
      controls.enableDamping=true;
      controls.addEventListener('change',requestFrame);
      renderer.domElement.dataset.cameraPreset='isometric';
      const resize=()=>{
        if(!renderer)return;
        const rect=node.getBoundingClientRect();
        if(rect.width<=0||rect.height<=0)return;
        camera.aspect=rect.width/rect.height;
        camera.updateProjectionMatrix();
        renderer.setSize(rect.width,rect.height,false);
        requestFrame();
      };
      observer=new ResizeObserver(resize);
      observer.observe(node);
      resize();
      previewScene.current={update};
      update(profile,thickness);
      cameraCommand.current=switchCameraView;
    }catch{
      setPreviewError('WebGL preview could not start. Sketch, history and file operations remain available.');
    }
    return ()=>{
      disposed=true;previewScene.current=null;cameraCommand.current=null;
      if(frameId)cancelAnimationFrame(frameId);
      observer?.disconnect();
      controls?.dispose();
      dropMesh();material.dispose();edgeMaterial.dispose();
      if(renderer){
        renderer.domElement.removeEventListener('webglcontextlost',onContextLost);
        renderer.domElement.removeEventListener('pointerdown',onSolidPointerDown);
        renderer.domElement.removeEventListener('pointerup',onSolidPointerUp);
        renderer.domElement.removeEventListener('pointermove',onSolidPointerMove);
        renderer.domElement.removeEventListener('wheel',onSolidWheel);
        renderer.domElement.removeEventListener('pointercancel',onSolidPointerCancel);
        renderer.domElement.removeEventListener('webglcontextrestored',onContextRestored);
        renderer.dispose();
        // Release this single context on actual 3D→Sketch unmount. Model
        // revisions do not create or destroy contexts.
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      thicknessAxis.current=null;
    };
  },[sketchMode]);
  useEffect(()=>{
    if(!sketchMode)previewScene.current?.update(profile,thickness);
  },[profile,thickness,sketchMode]);

  const startSketchPan=(event:ReactPointerEvent<SVGSVGElement>)=>{
    if(event.button!==1)return;
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    try{
      sketchPan.current={pointerId:event.pointerId,startX:event.clientX,
        startY:event.clientY,inverse:matrix.inverse(),origin:activeSketchView};
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      setCircleHover(null);
    }catch{sketchPan.current=null;}
  };
  const moveSketchPan=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const gesture=sketchPan.current;
    if(!gesture||gesture.pointerId!==event.pointerId)return false;
    const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
    setSketchView(panBlankCanvas(gesture.origin,{
      x:gesture.inverse.a*dx+gesture.inverse.c*dy,
      y:gesture.inverse.b*dx+gesture.inverse.d*dy,
    }));
    return true;
  };
  const endSketchPan=(event:ReactPointerEvent<SVGSVGElement>)=>{
    if(sketchPan.current?.pointerId!==event.pointerId)return;
    sketchPan.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return sketchMode ? <>
    <svg ref={sketchSvg} data-testid="runtime-sketch" className="runtime-sketch-svg"
    viewBox={sketchViewBox} aria-label="Solved SKETCH boundary and circular holes in millimetres"
    style={onCirclePick||onProfilePick||onTabPoint?{cursor:'crosshair'}:undefined}
    onPointerDown={startSketchPan}
    onPointerMove={event=>{
      if(moveSketchPan(event))return;
      if(onCirclePick)setCircleHover(pointFromScreen(event.currentTarget,event.clientX,event.clientY));
    }}
    onPointerUp={endSketchPan}
    onPointerCancel={endSketchPan}
    onLostPointerCapture={()=>{sketchPan.current=null;}}
    onPointerLeave={()=>setCircleHover(null)}
    onClick={event=>{
      if(event.button!==0||(!onCirclePick&&!onProfilePick&&!onTabPoint))return;
      const point=pointFromScreen(event.currentTarget,event.clientX,event.clientY);
      if(point){
        if(onTabPoint)onTabPoint(point.x,point.y,event.shiftKey);
         else if(onCirclePick)onCirclePick(point.x,point.y);
        else onProfilePick?.(point.x,point.y);
      }
    }}>
    {(onCirclePick||onTabPoint)&&<rect x={activeSketchView.x} y={activeSketchView.y}
      width={activeSketchView.width} height={activeSketchView.height}
      fill="transparent" pointerEvents="all" data-testid="runtime-circle-hit-surface"/>}
    <g transform={`translate(0 ${minY+maxY}) scale(1 -1)`}
       pointerEvents={onCirclePick||onTabPoint?'none':undefined}>
      <polygon points={profile.outer.map(p=>`${p.x},${p.y}`).join(' ')}
        fill="#34758b22" stroke="#76d1e5" strokeWidth=".5" vectorEffect="non-scaling-stroke"/>
       {tabEdge&&tabPoints&&tabPoints.length>0&&<polyline data-testid="runtime-tab-outline-preview"
         pointerEvents="none" points={[tabEdge.start,...tabPoints,tabEdge.end].map(p=>`${p.x},${p.y}`).join(' ')}
         fill="none" stroke="#ffdb7c" strokeDasharray="4 2" strokeWidth="2"
         vectorEffect="non-scaling-stroke"/>}
       {tabPoints?.map((p,i)=><circle key={i} data-testid="runtime-tab-draft-vertex"
         pointerEvents="none" cx={p.x} cy={p.y}
         r={Math.max(2,Math.min(width,height)/36)*sketchMarkerScale}
         stroke="#332a10" fill="#ffdb7c" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
      {profile.holes.map(h=><g key={h.id}>
        <circle data-testid={`runtime-sketch-outline-hole-${h.id}`} cx={h.x} cy={h.y} r={h.radius} fill="#152332"
          stroke={(selectedHoleIds?selectedHoleIds.includes(h.id):selectedHoleId===h.id)?'#6af0cd':'#e4be81'}
          strokeWidth={(selectedHoleIds?selectedHoleIds.includes(h.id):selectedHoleId===h.id)?'.9':'.5'} vectorEffect="non-scaling-stroke"
          onClick={event=>{event.stopPropagation();onHoleSelect?.(h.id,event.ctrlKey||event.metaKey);}}/>
        {onHoleMove&&
          <circle data-testid={`runtime-sketch-hole-${h.id}`}
            aria-label={`Drag ${h.id} center`}
            cx={h.x} cy={h.y} r={Math.max(2,Math.min(width,height)/35)*sketchMarkerScale}
            fill="#eef6ed" stroke="#174d69" strokeWidth=".7"
            style={{cursor:'grab',touchAction:'none'}}
            onPointerDown={event=>{
              if(event.button!==0)return;
              event.preventDefault();
              if(event.ctrlKey||event.metaKey){
                event.stopPropagation();
                onHoleSelect?.(h.id,true);
                return;
              }
              const groupIds=selectedHoleIds?.includes(h.id)&&selectedHoleIds.length>1
                ?[...selectedHoleIds]:[h.id];
              if(groupIds.length===1)onHoleSelect?.(h.id,false);
              event.currentTarget.setPointerCapture(event.pointerId);
              moving.current={id:h.id as HoleId,pointerId:event.pointerId,groupIds};
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
              const groupIds=moving.current.groupIds;
              moving.current=null;setDragPreview(null);
              if(point){
                const x=Math.round(point.x*2)/2,y=Math.round(point.y*2)/2;
                if(x!==h.x||y!==h.y)onHoleMove(h.id as HoleId,x,y,groupIds);
              }
            }}
            onPointerCancel={()=>{moving.current=null;setDragPreview(null);}}
          />}
        {onHoleDiameterEdit&&<circle
          data-testid={`runtime-sketch-diameter-${h.id}`}
          role="slider" tabIndex={0}
          aria-label={`Resize ${h.id} circular cut diameter in millimetres`}
          aria-valuemin={0.5} aria-valuemax={10000} aria-valuenow={2*h.radius}
          cx={h.x} cy={h.y-h.radius} r={Math.max(2.1,Math.min(width,height)/43)*sketchMarkerScale}
          fill="#fed792" stroke="#4b3122" strokeWidth=".7"
          style={{cursor:'nwse-resize',touchAction:'none'}}
          onPointerDown={event=>{
            if(event.button!==0||moving.current||dimensionMove.current)return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onHoleSelect?.(h.id);
            radialMove.current={id:h.id,pointerId:event.pointerId,source:profile,original:2*h.radius};
            setRadialPreview({id:h.id,diameter:2*h.radius});
          }}
          onPointerMove={event=>{
            const current=radialMove.current;
            if(!current||current.id!==h.id||current.pointerId!==event.pointerId||current.source!==profile)return;
            const point=pointerPosition(event);
            const diameter=point&&radialHoleDiameter({x:h.x,y:h.y},point,event.shiftKey);
            if(diameter!==null&&diameter!==undefined)setRadialPreview({id:h.id,diameter});
          }}
          onPointerUp={event=>{
            const current=radialMove.current;
            if(!current||current.id!==h.id||current.pointerId!==event.pointerId)return;
            radialMove.current=null;setRadialPreview(null);
            if(current.source!==profile)return;
            const point=pointerPosition(event);
            const diameter=point&&radialHoleDiameter({x:h.x,y:h.y},point,event.shiftKey);
            if(diameter!==null&&diameter!==undefined&&diameter!==current.original)
              onHoleDiameterEdit(h.id,diameter);
          }}
          onPointerCancel={()=>{radialMove.current=null;setRadialPreview(null);}}
          onLostPointerCapture={()=>{radialMove.current=null;setRadialPreview(null);}}
          onKeyDown={event=>{
            if(event.key==='Escape'){
              radialMove.current=null;setRadialPreview(null);event.preventDefault();return;
            }
            const diameter=nudgeHoleDiameter(2*h.radius,event.key,event.shiftKey);
            if(diameter!==null){
              event.preventDefault();onHoleSelect?.(h.id);onHoleDiameterEdit(h.id,diameter);
            }
          }}/>}
      </g>)}
      {onDimensionEdit&&(['width','depth','holeA.diameter','holeB.diameter'] as const)
        .filter(id=>Number.isFinite(dimensionValue(id)))
        .map(id=>{
          const at=dimensionAnchor(id),current=dimensionValue(id);
          return <circle key={id} data-testid={`runtime-sketch-dimension-${id}`}
            role="slider" tabIndex={0} aria-label={`Edit ${id.replace('.', ' ')} in millimetres`}
            aria-valuemin={0.1} aria-valuemax={10000} aria-valuenow={current}
            cx={at.x} cy={at.y} r={Math.max(2.2,Math.min(width,height)/40)*sketchMarkerScale}
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
      {radialPreview&&profile.holes.filter(h=>h.id===radialPreview.id).map(h=>
        <circle key={h.id} data-testid="runtime-sketch-diameter-preview"
          cx={h.x} cy={h.y} r={radialPreview.diameter/2}
          fill="none" stroke="#fed792" strokeDasharray="2 1"
          strokeWidth=".65" pointerEvents="none"/>)}
      {dragPreview&&<circle cx={dragPreview.x} cy={dragPreview.y}
        r={Math.max(2.5,Math.min(width,height)/30)*sketchMarkerScale}
        fill="#6af0cd55" stroke="#84f2d3" strokeDasharray="1 1"
        strokeWidth=".6" pointerEvents="none"/>}
      {contourEdges&&onContourEdgeDrag&&contourEdges.map(edge=>{
        const selected=selectedContourEdgeId===edge.edgeId;
        const offset=contourPreview?.edgeId===edge.edgeId?contourPreview.offsetMm:0;
        return <g key={edge.edgeId}>
          {offset!==0&&<line
            data-testid="runtime-contour-edge-drag-preview"
            x1={edge.start.x+edge.normal.x*offset} y1={edge.start.y+edge.normal.y*offset}
            x2={edge.end.x+edge.normal.x*offset} y2={edge.end.y+edge.normal.y*offset}
            stroke="#ffdb7c" strokeWidth="2" strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
          <line data-testid={'runtime-contour-edge-'+edge.startIndex}
            role="slider" tabIndex={0}
            aria-label={'Drag source contour edge '+edge.edgeId+' normal to itself'}
            aria-valuemin={-10000} aria-valuemax={10000} aria-valuenow={0}
            x1={edge.start.x} y1={edge.start.y} x2={edge.end.x} y2={edge.end.y}
            stroke={selected?'#ffdb7c':'#77e1e9'} opacity={selected?1:0.75}
            strokeWidth="8" vectorEffect="non-scaling-stroke"
            style={{cursor:'grab',touchAction:'none'}}
            onPointerDown={event=>{
              if(event.button!==0||contourMove.current)return;
              const at=pointerPosition(event);
              if(!at)return;
              event.preventDefault();event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              contourMove.current={edgeId:edge.edgeId,pointerId:event.pointerId,
                source:profile,start:at};
              setContourPreview({edgeId:edge.edgeId,offsetMm:0});
              onContourEdgePick?.(edge.edgeId);
            }}
            onPointerMove={event=>{
              const active=contourMove.current;
              if(!active||active.edgeId!==edge.edgeId||
                  active.pointerId!==event.pointerId||active.source!==profile)return;
              const at=pointerPosition(event);
              if(!at)return;
              const offsetMm=(at.x-active.start.x)*edge.normal.x+
                (at.y-active.start.y)*edge.normal.y;
              if(Number.isFinite(offsetMm)&&Math.abs(offsetMm)<=10000)
                setContourPreview({edgeId:edge.edgeId,offsetMm});
            }}
            onPointerUp={event=>{
              const active=contourMove.current;
              if(!active||active.edgeId!==edge.edgeId||active.pointerId!==event.pointerId)return;
              event.stopPropagation();
              contourMove.current=null;setContourPreview(null);
              if(active.source!==profile)return;
              const at=pointerPosition(event);
              if(at&&Math.hypot(at.x-active.start.x,at.y-active.start.y)>0.01)
                onContourEdgeDrag(edge.edgeId,active.start,at);
            }}
            onPointerCancel={()=>{contourMove.current=null;setContourPreview(null);}}
            onLostPointerCapture={()=>{contourMove.current=null;setContourPreview(null);}}
            onKeyDown={event=>{
              if(event.key==='Escape'){
                contourMove.current=null;setContourPreview(null);event.preventDefault();return;
              }
              if((event.key==='ArrowUp'||event.key==='ArrowDown')&&onContourEdgeOffset){
                event.preventDefault();onContourEdgePick?.(edge.edgeId);
                onContourEdgeOffset(edge.edgeId,
                  (event.key==='ArrowUp'?1:-1)*(event.shiftKey?0.1:1));
              }
            }}/>
        </g>;
      })}
      {onContourVertexPick&&contourVertexHandles?.filter(handle=>
        handle.handleId!==profileEditHandle?.handleId &&
        Number.isFinite(handle.position.x)&&Number.isFinite(handle.position.y) &&
        // An exact SVG target is selectable only when it identifies one source
        // vertex. Coincident semantic IDs are still available in the inspector.
        contourVertexHandles.filter(other=>
          other.position.x===handle.position.x&&other.position.y===handle.position.y).length===1
      ).map(handle=><circle key={handle.handleId}
        data-testid="runtime-contour-vertex-marker" data-handle-id={handle.handleId}
        role="button" tabIndex={0}
        aria-label={'Select source contour vertex '+handle.handleId}
        cx={handle.position.x} cy={handle.position.y}
        r={Math.max(3,Math.min(width,height)/28)*sketchMarkerScale}
        fill="#73c5d6" stroke="#162c39" strokeWidth="1"
        style={{cursor:onContourVertexDrag?'grab':'pointer',touchAction:'none'}}
        title="Click to select exact source vertex; drag to move via SKETCH. Escape cancels."
        onPointerDown={event=>{
          if(!onContourVertexDrag||event.button!==0||contourVertexMove.current)return;
          event.preventDefault();event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          contourVertexMove.current={handleId:handle.handleId,pointerId:event.pointerId,
            source:profile,startScreen:{x:event.clientX,y:event.clientY}};
          setContourVertexPreview({handleId:handle.handleId,...handle.position});
        }}
        onPointerMove={event=>{
          const active=contourVertexMove.current;
          if(!active||active.handleId!==handle.handleId||
              active.pointerId!==event.pointerId||active.source!==profile)return;
          const at=pointerPosition(event);
          if(at)setContourVertexPreview({handleId:handle.handleId,...at});
        }}
        onPointerUp={event=>{
          const active=contourVertexMove.current;
          if(!active||active.handleId!==handle.handleId||active.pointerId!==event.pointerId)return;
          event.preventDefault();event.stopPropagation();
          contourVertexMove.current=null;setContourVertexPreview(null);
          if(active.source!==profile)return;
          if(Math.hypot(event.clientX-active.startScreen.x,
            event.clientY-active.startScreen.y)<=3){
            onContourVertexPick(handle.handleId);return;
          }
          const at=pointerPosition(event);
          if(at)onContourVertexDrag?.(handle.handleId,at.x,at.y);
        }}
        onPointerCancel={()=>{contourVertexMove.current=null;setContourVertexPreview(null);}}
        onLostPointerCapture={()=>{contourVertexMove.current=null;setContourVertexPreview(null);}}
        onClick={event=>{event.preventDefault();event.stopPropagation();
          if(!onContourVertexDrag)onContourVertexPick(handle.handleId);
        }}
        onKeyDown={event=>{
          if(event.key==='Escape'){
            const active=contourVertexMove.current;
            contourVertexMove.current=null;setContourVertexPreview(null);
            if(active&&event.currentTarget.hasPointerCapture(active.pointerId))
              event.currentTarget.releasePointerCapture(active.pointerId);
            event.preventDefault();return;
          }
          if(event.key==='Enter'||event.key===' '){
            event.preventDefault();event.stopPropagation();
            onContourVertexPick(handle.handleId);
          }
        }}/>)}
      {contourVertexPreview&&<circle
        data-testid="runtime-contour-vertex-drag-preview"
        cx={contourVertexPreview.x} cy={contourVertexPreview.y}
        r={Math.max(3,Math.min(width,height)/28)*sketchMarkerScale}
        fill="#ffdb7c55" stroke="#ffdb7c" strokeDasharray="3 2"
        strokeWidth="1" pointerEvents="none"/>}
      {profileEditHandle&&onProfileHandleDrag&&<circle
        data-testid="runtime-profile-drag-handle"
        aria-label={'Drag selected semantic profile handle '+profileEditHandle.handleId}
        role="slider" tabIndex={0}
        cx={profilePreview?.x??profileEditHandle.position.x}
        cy={profilePreview?.y??profileEditHandle.position.y}
        r={Math.max(3,Math.min(width,height)/28)*sketchMarkerScale}
        fill="#ffdb7c" stroke="#312913" strokeWidth=".9"
        style={{cursor:'move',touchAction:'none'}}
        onPointerDown={event=>{
          if(event.button!==0)return;
          event.preventDefault();event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          profileMove.current={handleId:profileEditHandle.handleId,pointerId:event.pointerId,
            source:profile,startScreen:{x:event.clientX,y:event.clientY}};
          setProfilePreview(profileEditHandle.position);
        }}
        onPointerMove={event=>{
          const active=profileMove.current;
          if(!active||active.handleId!==profileEditHandle.handleId||
             active.pointerId!==event.pointerId||active.source!==profile)return;
          const at=pointerPosition(event);
          if(at)setProfilePreview(at);
        }}
        onPointerUp={event=>{
          const active=profileMove.current;
          if(!active||active.pointerId!==event.pointerId)return;
          event.stopPropagation();
          profileMove.current=null;setProfilePreview(null);
          if(active.source!==profile)return;
          // A click selecting/focusing the marker is not a CAD movement.
          // Screen-pixel threshold only; SKETCH still admits actual geometry.
          if(Math.hypot(event.clientX-active.startScreen.x,
            event.clientY-active.startScreen.y)<=3)return;
          const at=pointerPosition(event);
          if(at)onProfileHandleDrag(active.handleId,at.x,at.y);
        }}
        onPointerCancel={()=>{profileMove.current=null;setProfilePreview(null);}}
        onLostPointerCapture={()=>{profileMove.current=null;setProfilePreview(null);}}
      />}
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
    </svg>
    <nav className="runtime-solved-navigation" aria-label="Solved sketch navigation">
      <button type="button" data-testid="runtime-solved-zoom-in"
        onClick={()=>zoomSketchAtCenter(1/1.4)} title="Zoom in about the view centre">+</button>
      <button type="button" data-testid="runtime-solved-zoom-out"
        onClick={()=>zoomSketchAtCenter(1.4)} title="Zoom out about the view centre">−</button>
      <button type="button" data-testid="runtime-solved-view-fit"
        onClick={()=>setSketchView(null)} title="Fit the current solved profile">FIT</button>
    </nav>
  </> : <div ref={host} className="runtime-3d-canvas" data-testid="runtime-3d-viewport">
    <div className="runtime-solid-selection-hint" data-testid="runtime-solid-selected-hole" role="status">
      {selectedHoleIds?.length ? `Selected sketch holes: ${selectedHoleIds.join(', ')}`
        : 'ISO/TOP: click a visible hole opening to select; drag to orbit.'}
    </div>
    <nav className="runtime-camera-toolbar" aria-label="3D preview camera views">
      {(['isometric','top','front','right'] as const).map(preset=>
        <button key={preset} type="button" data-testid={'runtime-camera-'+preset}
          aria-pressed={cameraView===preset}
          title={'Frame '+preset+' view, display only; no CAD edit'}
          onClick={()=>cameraCommand.current?.(preset)}>
          {preset==='isometric'?'ISO':preset.toUpperCase()}
        </button>)}
      <button type="button" data-testid="runtime-camera-fit"
        title="Fit the current 3D preview, retaining its orbit direction"
        onClick={()=>cameraCommand.current?.('fit')}>FIT</button>
    </nav>
    {onThicknessEdit&&<button type="button" ref={thicknessGrip}
      className="runtime-3d-thickness-grip" data-testid="runtime-thickness-handle"
      role="slider" aria-label="Extrusion thickness direct handle in millimetres"
      aria-valuemin={0.001} aria-valuemax={10000} aria-valuenow={thickness}
      aria-valuetext={thicknessPreview===null?`${thickness} mm`:`Proposed ${thicknessPreview} mm; not yet committed`}
      title="Drag projected extrusion axis or use ↑/↓ (Shift: 0.1 mm). Escape cancels."
      onPointerDown={event=>{
        if(event.button!==0||!thicknessAxis.current)return;
        event.preventDefault();event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        thicknessMove.current={
          pointerId:event.pointerId,startClient:{x:event.clientX,y:event.clientY},
          initialMm:thickness,axisPixelsPerMm:{...thicknessAxis.current},
        };
        setThicknessPreview(thickness);
      }}
      onPointerMove={event=>{
        const gesture=thicknessMove.current;
        if(!gesture||gesture.pointerId!==event.pointerId)return;
        try{
          setThicknessPreview(proposeThicknessDrag(gesture,{x:event.clientX,y:event.clientY},event.shiftKey?0.1:1));
        }catch{setThicknessPreview(null);}
      }}
      onPointerUp={event=>{
        const gesture=thicknessMove.current;
        if(!gesture||gesture.pointerId!==event.pointerId)return;
        thicknessMove.current=null;setThicknessPreview(null);
        try{
          const value=proposeThicknessDrag(gesture,{x:event.clientX,y:event.clientY},event.shiftKey?0.1:1);
          if(value!==gesture.initialMm)onThicknessEdit(value);
        }catch{/* A failed projection cannot author a dimension. */}
      }}
      onPointerCancel={()=>{thicknessMove.current=null;setThicknessPreview(null);}}
      onLostPointerCapture={()=>{thicknessMove.current=null;setThicknessPreview(null);}}
      onKeyDown={event=>{
        if(event.key==='Escape'){
          thicknessMove.current=null;setThicknessPreview(null);event.preventDefault();return;
        }
        if(event.key==='ArrowUp'||event.key==='ArrowDown'){
          event.preventDefault();
          const value=nudgeThickness(thickness,event.key==='ArrowUp'?'up':'down',event.shiftKey?0.1:1);
          if(value!==thickness)onThicknessEdit(value);
        }
      }}>
      <span aria-hidden="true">↕</span> {thicknessPreview??thickness} mm
    </button>}
    {previewError&&<p role="alert" data-testid="runtime-3d-preview-error" className="runtime-3d-preview-error">{previewError}</p>}
  </div>;
}
