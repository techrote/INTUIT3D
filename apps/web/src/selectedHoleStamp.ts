/**
 * One-shot multi-selection hole stamping and removal for the real plate editor.
 * All edits go through accepted RUNTIME/SKETCH admission and one INTENT journal
 * event; the browser does not retain its own CAD model or a tessellation cache.
 */
import type {SketchConstraintBatchResult} from '@intuit3d/workflow-runtime';
import {modelHoleValues,previewModelSketchProfile,runtime,type ModelSession} from './runtimeSession.ts';

export interface SelectedHoleStamp {
  readonly holeIds:readonly string[];
  readonly deltaXmm:number;
  readonly deltaYmm:number;
}

function requireSelection(h:ModelSession,ids:readonly string[]):void {
  if(!Array.isArray(ids)||ids.length<1||ids.length>32||new Set(ids).size!==ids.length)
    throw Error('Select 1–32 distinct authored holes.');
  const authored=modelHoleValues(h);
  for(const id of ids)
    if(typeof id!=='string'||!Object.hasOwn(authored,id))
      throw Error('Selection contains an unknown authored hole: '+String(id));
}

/** The ordinary Workbench currently authors only orthogonal rectangular plates.
 * Do not mistake the bounding box of a future arbitrary contour for material. */
function admittedRectangularPlate(h:ModelSession) {
  const profile=previewModelSketchProfile(runtime.inspect(h));
  if(!profile)throw Error('Selected-hole stamping requires an admitted solved sketch profile.');
  const xs=profile.outer.map(p=>p.x),ys=profile.outer.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  const corners=new Set(profile.outer.map(p=>p.x+','+p.y));
  if(profile.outer.length!==4||!Number.isFinite(minX+maxX+minY+maxY)||
      minX>=maxX||minY>=maxY||corners.size!==4||
      profile.outer.some(p=>(p.x!==minX&&p.x!==maxX)||(p.y!==minY&&p.y!==maxY)))
    throw Error('Selected-hole stamping is supported only on an admitted rectangular plate.');
  return {profile,minX,maxX,minY,maxY};
}

/** Copy arbitrary selected solved holes by a single signed XY displacement.
 * Copies have new semantic IDs; unlike an associative pattern, subsequent
 * edits to the sources do not move or resize these independent constraints. */
export function stampSelectedModelHoles(h:ModelSession,request:SelectedHoleStamp):{
  result:SketchConstraintBatchResult; copiedHoleIds:readonly string[];
} {
  const {holeIds,deltaXmm,deltaYmm}=request;
  requireSelection(h,holeIds);
  if(![deltaXmm,deltaYmm].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000)||
      (deltaXmm===0&&deltaYmm===0))
    throw Error('Stamp offset requires a nonzero finite X/Y displacement within ±10,000 mm.');
  const {profile,minX,maxX,minY,maxY}=admittedRectangularPlate(h);
  const existing=profile.holes.map(circle=>({
    id:circle.id,x:circle.x,y:circle.y,radius:circle.radius,
  }));
  const copies:typeof existing=[];
  const ids:string[]=[];
  const authored=modelHoleValues(h);
  for(const [index,id] of holeIds.entries()){
    const source=existing.find(circle=>circle.id===id);
    if(!source||![source.x,source.y,source.radius].every(Number.isFinite)||source.radius<=0)
      throw Error('Selected hole is not present in the solved source profile: '+id);
    const x=source.x+deltaXmm,y=source.y+deltaYmm;
    if(![x,y].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000)||
        x-source.radius<=minX||x+source.radius>=maxX||
        y-source.radius<=minY||y+source.radius>=maxY)
      throw Error('Stamp would place a hole rim outside the admitted plate; model unchanged.');
    if([...existing,...copies].some(circle=>
        Math.hypot(x-circle.x,y-circle.y)<=source.radius+circle.radius))
      throw Error('Stamp would overlap an existing or another copied hole; model unchanged.');
    const newId=`stamp.${h.document.revision}:${index}`;
    if(Object.hasOwn(authored,newId))
      throw Error('Stamp semantic ID is already authored; model unchanged.');
    ids.push(newId);
    copies.push({id:newId,x,y,radius:source.radius});
  }
  const result=runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',
    eventId:`workbench.hole.stamp.${h.document.revision}`,
    expectedRevision:h.document.revision,
    admission:'require_admissible',
    operations:copies.map(circle=>({kind:'add' as const,...circle})),
  });
  return {result,copiedHoleIds:result.kind==='committed'?ids:[]};
}

/** Delete an explicitly selected custom-hole set in one reversible transaction.
 * Seed holes are protected because their constraints feed the plate controls. */
export function removeSelectedModelHoles(
  h:ModelSession,holeIds:readonly string[],
):SketchConstraintBatchResult {
  requireSelection(h,holeIds);
  if(holeIds.some(id=>id==='holeA'||id==='holeB'))
    throw Error('Base holes A/B are referenced by plate dimensions; select only custom holes.');
  return runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',
    eventId:`workbench.hole.remove-selected.${h.document.revision}`,
    expectedRevision:h.document.revision,
    admission:'require_admissible',
    operations:holeIds.map(id=>({kind:'remove' as const,id})),
  });
}
