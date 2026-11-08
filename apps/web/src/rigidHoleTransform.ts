/**
 * Browser consumer of the accepted RUNTIME solved rigid-hole transform.
 * INTENT/SKETCH/RUNTIME own the geometry and journal; UI computes only
 * the explicitly selected rotation datum from authoritative constraints.
 */
import {modelHoleValues, previewModelSketchProfile, runtime, type ModelSession} from './runtimeSession.ts';
import type {SketchConstraintBatchResult} from '@intuit3d/workflow-runtime';

export interface SelectedRigidHoleTransform {
  readonly holeIds:readonly string[];
  readonly translateXmm:number;
  readonly translateYmm:number;
  readonly rotateDegrees:number;
}

export function transformSelectedModelHoles(
  h:ModelSession, request:SelectedRigidHoleTransform,
):SketchConstraintBatchResult {
  const {holeIds,translateXmm,translateYmm,rotateDegrees}=request;
  if(!Array.isArray(holeIds)||holeIds.length<2||holeIds.length>32||
      new Set(holeIds).size!==holeIds.length)
    throw Error('Select 2–32 distinct holes for rigid repositioning.');
  if(![translateXmm,translateYmm,rotateDegrees].every(Number.isFinite)||
      [translateXmm,translateYmm].some(n=>Math.abs(n)>10000)||
      Math.abs(rotateDegrees)>=360||
      (translateXmm===0&&translateYmm===0&&rotateDegrees===0))
    throw Error('Enter a finite nonzero transform: translations within ±10,000 mm, rotation below 360°.');
  const holes=modelHoleValues(h);
  for(const id of holeIds)
    if(!Object.hasOwn(holes,id))
      throw Error('Unknown authored hole in rigid selection: '+id);
  if(!previewModelSketchProfile(runtime.inspect(h)))
    throw Error('Rigid transform requires an admitted solved source sketch.');
  const pivotXmm=holeIds.reduce((n,id)=>n+holes[id].x,0)/holeIds.length;
  const pivotYmm=holeIds.reduce((n,id)=>n+holes[id].y,0)/holeIds.length;
  if(![pivotXmm,pivotYmm].every(Number.isFinite))
    throw Error('Selection centroid is not finite.');
  const result=runtime.transformPlateHoles(h,{
    sketchFeatureId:'sketch.plate',
    eventId:'workbench.hole.rigid.'+h.document.revision,
    expectedRevision:h.document.revision,
    admission:'require_admissible',
    holeIds,pivotXmm,pivotYmm,translateXmm,translateYmm,rotateDegrees,
  });
  if(result.kind==='committed'){
    const profile=previewModelSketchProfile(runtime.inspect(result.history));
    if(!profile)throw Error('Rigid transform invalidated the plate profile; model unchanged.');
    // Runtime checks constraint solvability. The current workbench authors an
    // orthogonal mounting plate, whose physical hole rims must also remain
    // strictly inside its actual admitted outer rectangle. The SKETCH profile
    // status alone does not presently guarantee this for translated circles.
    // Fail closed on other contour types rather than silently promoting a
    // bounding-box approximation to arbitrary CAD profile containment.
    const xs=profile.outer.map(p=>p.x),ys=profile.outer.map(p=>p.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs);
    const minY=Math.min(...ys),maxY=Math.max(...ys);
    const rectangular=profile.outer.length===4&&
      profile.outer.every(p=>(p.x===minX||p.x===maxX)&&(p.y===minY||p.y===maxY))&&
      maxX>minX&&maxY>minY;
    if(!rectangular)
      throw Error('Rigid transform needs the workbench orthogonal plate profile; model unchanged.');
    const moved=modelHoleValues(result.history);
    for(const id of holeIds){
      const rim=profile.holes.find(hole=>hole.id===id);
      const p=moved[id];
      if(!rim||!p||!Number.isFinite(rim.radius)||
          p.x-rim.radius<=minX||p.x+rim.radius>=maxX||
          p.y-rim.radius<=minY||p.y+rim.radius>=maxY)
        throw Error('Rigid transform would place a hole rim outside the plate; model unchanged.');
    }
  }
  return result;
}
