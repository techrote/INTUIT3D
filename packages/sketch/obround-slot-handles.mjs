/**
 * Direct-manipulation controls for a solved obround mounting slot.
 *
 * Every pointer gesture proposes ONE complete authored sketch replacement.
 * The returned analytic wire is only provider-ready SKETCH data; neither a
 * browser preview nor solver convergence establishes native B-rep/STEP truth.
 */
import {serializeArcSketch} from './arc-constraints.mjs';
import {editObroundSlot,inspectObroundSlot} from './obround-slot.mjs';

export const OBROUND_SLOT_HANDLES_VERSION = 1;
export const OBROUND_SLOT_HANDLES_FORMAT = 'intuit3d.obround-slot-handles';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const exact = (value,keys) => value && typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
const handle = (id,kind,axis,x,y,valueMm) => ({
  id:id+':'+kind,kind,axis,position:{x,y},valueMm
});

/**
 * Stable five-handle interface: left/right cap (overall length), top/bottom
 * edge (diameter) and center (translate). The opposite edge/cap stays fixed
 * during a one-sided drag, matching mechanical sketch editor expectations.
 */
export function inspectObroundSlotHandles(source,id) {
  const inspected=inspectObroundSlot(source,id);
  const d=inspected.dimensions;
  const x=d.originXmm,y=d.originYmm,L=d.overallLengthMm,D=d.diameterMm;
  const handles=inspected.profile?[
    handle(id,'length-left','x',x,y+D/2,L),
    handle(id,'length-right','x',x+L,y+D/2,L),
    handle(id,'diameter-bottom','y',x+L/2,y,D),
    handle(id,'diameter-top','y',x+L/2,y+D,D),
    handle(id,'position','xy',x+L/2,y+D/2,null)
  ]:[];
  return {format:OBROUND_SLOT_HANDLES_FORMAT,version:1,
    sourceSignature:inspected.sourceSignature,
    status:inspected.status,reason:inspected.reason,
    dimensions:d,handles,profile:inspected.profile,previewOnly:true};
}

/**
 * Revision-fenced pointer drag. Two internal template proposals may be needed
 * to change an anchor AND a dimension, but only the final authored sketch is
 * returned for an atomic INTENT/RUNTIME journal event. No input is mutated.
 */
export function dragObroundSlotHandle(source,id,request) {
  const view=inspectObroundSlotHandles(source,id),stamp=view.sourceSignature;
  const refuse=reason=>({kind:'refused',format:OBROUND_SLOT_HANDLES_FORMAT,
    version:1,sourceSignature:stamp,reason,previewOnly:true});
  if(!exact(request,['version','handleId','expectedSignature','target'])||
     request.version!==1||!exact(request.target,['x','y'])||
     !finite(request.target.x)||!finite(request.target.y))
    return refuse('invalid versioned pointer gesture');
  if(request.expectedSignature!==stamp)return refuse('stale slot revision');
  if(!view.profile)return refuse('slot is not solved and profile-admitted');
  const selected=view.handles.find(h=>h.id===request.handleId);
  if(!selected)return refuse('unknown slot handle');
  const {originXmm:x,originYmm:y,overallLengthMm:L,diameterMm:D}=view.dimensions;
  const t=request.target;
  let nextX=x,nextY=y,nextL=L,nextD=D;
  switch(selected.kind){
    case 'length-left':
      nextX=t.x;nextL=x+L-t.x;break;
    case 'length-right':
      nextL=t.x-x;break;
    case 'diameter-bottom':
      nextY=t.y;nextD=y+D-t.y;break;
    case 'diameter-top':
      nextD=t.y-y;break;
    case 'position':
      nextX=t.x-L/2;nextY=t.y-D/2;break;
    default:return refuse('unsupported handle');
  }
  if(![nextX,nextY,nextL,nextD].every(finite) ||
     nextD<=0||nextL<=nextD ||
     !finite(nextX+nextL)||!finite(nextY+nextD))
    return refuse('drag would collapse or overflow the mounting slot');
  try{
    let result=null;
    // Length or diameter changes are solved first without committing them.
    if(nextL!==L||nextD!==D){
      result=editObroundSlot(source,id,
        {kind:'resize',overallLengthMm:nextL,diameterMm:nextD},stamp);
      if(result.kind!=='accepted')return refuse(result.reason);
    }
    if(nextX!==x||nextY!==y){
      const intermediate=result?.sketch??source;
      result=editObroundSlot(intermediate,id,
        {kind:'move',originXmm:nextX,originYmm:nextY},
        result?.sourceSignature??stamp);
      if(result.kind!=='accepted')return refuse(result.reason);
    }
    if(!result){
      // A click with no travel still produces a validated, stable revision.
      result=editObroundSlot(source,id,
        {kind:'move',originXmm:x,originYmm:y},stamp);
      if(result.kind!=='accepted')return refuse(result.reason);
    }
    const after=inspectObroundSlotHandles(result.sketch,id);
    const applied=after.handles.find(h=>h.id===selected.id).position;
    const deviationMm=Math.hypot(applied.x-t.x,applied.y-t.y);
    if(!finite(deviationMm))return refuse('unrepresentable pointer projection');
    return {kind:'accepted',format:OBROUND_SLOT_HANDLES_FORMAT,version:1,
      priorSourceSignature:stamp,sourceSignature:serializeArcSketch(result.sketch),
      sketch:result.sketch,solution:result.solution,profile:result.profile,
      dimensions:result.dimensions,handles:after.handles,
      gesture:{handleId:selected.id,axis:selected.axis,target:{...t},
        appliedPoint:applied,deviationMm},
      previewOnly:true};
  }catch(error){
    return refuse('slot drag rejected: '+String(error?.message||error));
  }
}
