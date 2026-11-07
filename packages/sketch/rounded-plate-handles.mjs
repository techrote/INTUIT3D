import {validateSketch, serializeSketch, solveSketch, editConstraint} from './index.mjs';
import {createRoundedPlateIntent, serializeRoundedPlateIntent, editRoundedPlateRadius, solveRoundedPlate} from './rounded-plate.mjs';

/**
 * Rounded plate interaction v1. Converts real pointer handles into authored
 * dimensional changes, NOT temporary moved points or trusted native geometry.
 * The existing constrained sketch and fillet intent remain the only authority.
 */
export const ROUNDED_PLATE_HANDLES_VERSION = 1;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const fail = message => { throw new TypeError('sketch rounded handles: ' + message); };
const copyPoint = p => ({x:p.x,y:p.y});
const signedProjection = (from, to, axis) => axis === 'x' ? to.x-from.x : to.y-from.y;
const mk = (kind,id,position,extra) => ({kind,id,position:copyPoint(position),...extra});

/**
 * Discover editable controls from the actual solved graph. Do not assume
 * particular fixture constraint IDs, or claim a drag can change a redundant/
 * unbound dimension when its source equation cannot be identified.
 */
export function inspectRoundedPlateHandles(sketchSource, intentSource) {
  const sketch = validateSketch(sketchSource);
  const intent = createRoundedPlateIntent(intentSource);
  const result = solveRoundedPlate(sketch,intent);
  const base = {
    version:1, sketchSignature:serializeSketch(sketch),
    intentSignature:serializeRoundedPlateIntent(intent),
    status:result.status, diagnostics:structuredClone(result.diagnostics),
    previewOnly:true, geometry:result.geometry, handles:[]
  };
  if(result.status !== 'solved') return base;
  const solved = solveSketch(sketch);
  const points = new Map(solved.geometry.points.map(p => [p.id,p]));
  const lines = new Map(sketch.lines.map(e => [e.id,e]));
  const corners = new Set();
  for(const edgeId of intent.edgeIds){
    const e=lines.get(edgeId);
    if(!e)fail('missing edge in admitted rounded profile: '+edgeId);
    corners.add(e.start);corners.add(e.end);
  }
  const handles=[];
  for(const c of sketch.constraints){
    if((c.kind==='distanceX'||c.kind==='distanceY') &&
       corners.has(c.a)&&corners.has(c.b)){
      const a=points.get(c.a), b=points.get(c.b);
      const axis=c.kind==='distanceX'?'x':'y';
      handles.push(mk('dimension','dimension:'+c.id,b,{
        constraintId:c.id,axis,fromPointId:c.a,toPointId:c.b,valueMm:c.value
      }));
    }
  }
  for(const arc of result.geometry.boundary.filter(x=>x.kind==='arc')){
    const corner=points.get(arc.sourceVertexId);
    if(!corner)fail('missing source vertex for arc');
    handles.push(mk('corner_radius','corner-radius:'+arc.sourceVertexId,arc.start,{
      sourceVertexId:arc.sourceVertexId,valueMm:intent.radiusMm
    }));
  }
  for(const hole of result.geometry.holes){
    const circle=sketch.circles.find(c=>c.id===hole.id);
    const fixed=sketch.constraints.filter(c=>c.kind==='fixed'&&c.point===hole.centerId);
    if(fixed.length===1){
      handles.push(mk('hole_center','hole-center:'+hole.id,{x:hole.x,y:hole.y},{
        circleId:hole.id,pointId:hole.centerId,constraintId:fixed[0].id
      }));
    }
    const radii=sketch.constraints.filter(c=>c.kind==='radius'&&c.circle===hole.id);
    if(radii.length===1){
      handles.push(mk('hole_radius','hole-radius:'+hole.id,{
        x:hole.x+hole.radius,y:hole.y},{
        circleId:hole.id,centerId:hole.centerId,constraintId:radii[0].id,
        valueMm:hole.radius
      }));
    }
  }
  return {...base,handles};
}

/**
 * One prospective document edit. The returned sketch/fillet are *authored*
 * candidate state, and may deliberately be conflicted; consumers can journal
 * them for undo/recovery, but MUST NOT treat preview geometry as exact.
 * Stale pointer drags are rejected before modifying either document.
 */
export function editRoundedPlateHandle(sketchSource,intentSource,request){
  const sketch=validateSketch(sketchSource),intent=createRoundedPlateIntent(intentSource);
  if(!request||typeof request!=='object'||request.version!==1||
     typeof request.handleId!=='string'||!request.target||
     !finite(request.target.x)||!finite(request.target.y))
    fail('expected versioned handle ID and finite target');
  const inspection=inspectRoundedPlateHandles(sketch,intent);
  if(request.expectedSketchSignature!==inspection.sketchSignature ||
     request.expectedIntentSignature!==inspection.intentSignature)
    fail('stale edit: authored sketch or fillet intent changed');
  if(inspection.status!=='solved')
    fail('solve authored constraints before beginning a new handle drag');
  const handle=inspection.handles.find(h=>h.id===request.handleId);
  if(!handle)fail('unavailable or ambiguous handle '+request.handleId);
  const target=copyPoint(request.target);
  const solved=solveSketch(sketch);
  const points=new Map(solved.geometry.points.map(p=>[p.id,p]));
  let newSketch=sketch,newIntent=intent,appliedPoint;
  if(handle.kind==='dimension'){
    const origin=points.get(handle.fromPointId);
    const value=signedProjection(origin,target,handle.axis);
    newSketch=editConstraint(sketch,handle.constraintId,{value});
    appliedPoint=handle.axis==='x'?{x:target.x,y:handle.position.y}:
      {x:handle.position.x,y:target.y};
  }else if(handle.kind==='corner_radius'){
    const corner=points.get(handle.sourceVertexId);
    const ux=(corner.x-handle.position.x)/intent.radiusMm;
    const uy=(corner.y-handle.position.y)/intent.radiusMm;
    const radius=(corner.x-target.x)*ux+(corner.y-target.y)*uy;
    if(!finite(radius)||radius<=0){
      return {version:1,status:'rejected',sketch:null,intent:null,geometry:null,
        diagnostics:[{code:'nonpositive_drag_radius',message:'Fillet radius must be positive'}],
        sourceSketchSignature:inspection.sketchSignature,
        sourceIntentSignature:inspection.intentSignature,
        projection:null,previewOnly:true};
    }
    newIntent=editRoundedPlateRadius(intent,radius);
    appliedPoint={x:corner.x-radius*ux,y:corner.y-radius*uy};
  }else if(handle.kind==='hole_center'){
    newSketch=editConstraint(sketch,handle.constraintId,{x:target.x,y:target.y});
    appliedPoint=target;
  }else if(handle.kind==='hole_radius'){
    const center=points.get(handle.centerId);
    const radius=target.x-center.x;
    if(!finite(radius)||radius<=0){
      return {version:1,status:'rejected',sketch:null,intent:null,geometry:null,
        diagnostics:[{code:'nonpositive_drag_radius',message:'Hole radius must be positive'}],
        sourceSketchSignature:inspection.sketchSignature,
        sourceIntentSignature:inspection.intentSignature,
        projection:null,previewOnly:true};
    }
    newSketch=editConstraint(sketch,handle.constraintId,{value:radius});
    appliedPoint={x:center.x+radius,y:center.y};
  }else fail('unsupported handle kind');
  const next=solveRoundedPlate(newSketch,newIntent);
  return {
    version:1,status:next.status,sketch:newSketch,intent:newIntent,
    geometry:next.geometry,diagnostics:structuredClone(next.diagnostics),
    sourceSketchSignature:inspection.sketchSignature,
    sourceIntentSignature:inspection.intentSignature,
    projection:{target,appliedPoint,
      deviationMm:Math.hypot(appliedPoint.x-target.x,appliedPoint.y-target.y)},
    previewOnly:true
  };
}
