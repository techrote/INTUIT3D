/**
 * Pointer-to-authoritative-linear-handle adapter for genuinely selected contours.
 *
 * WORKBENCH owns the pointer-to-sketch mm transform and explicit choice UI.
 * This package never infers a target body or trusts a browser-created handle ID.
 * A completed drag delegates to the existing solved, atomic dimension/centre
 * editors. Ambiguous colocated handles always require explicit user choice.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {inspectSelectedProfileDimensions,dragSelectedProfileDimension}
  from './selected-profile-dimensions.mjs';
import {inspectSelectedProfileHandles,moveSelectedProfileHoleCenter}
  from './selected-profile-handles.mjs';

export const POINTER_PROFILE_EDIT_VERSION=1;

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const point=v=>exact(v,['x','y'])&&finite(v.x)&&finite(v.y);
const preview={previewOnly:true,nativeExact:false,exactBrepAvailable:false,
  independentStepQualified:false};
const refuse=(signature,reason,detail=null,sourceStatus=null,diagnostics=[],conflict=null)=>
  ({kind:'refused',version:1,sourceSignature:signature,reason,detail,
    sourceStatus,diagnostics,conflict,...preview});

/**
 * Expose all existing *solver-authored* dimension and two-axis centre
 * handles. No new sketch constraint is invented by this adapter.
 */
export function inspectPointerEditableHandles(source,selection){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const dimensions=inspectSelectedProfileDimensions(doc,selection);
  if(dimensions.kind!=='selected_profile_dimensions'){
    // Older selected-profile contracts preserve a solver status but not always
    // its DOF/conflict witnesses. Recover those only for admitted-size
    // unsolved sources; do not solve a sketch refused for an entity budget.
    const status=dimensions.sourceStatus??null;
    const unsolved=status==='underconstrained'||status==='conflicted'||
      status==='numerical_failure';
    const diagnostics=unsolved?solveSketch(doc).diagnostics:
      (dimensions.diagnostics??[]);
    return refuse(stamp,dimensions.reason,dimensions.detail??null,
      status,diagnostics,dimensions.conflict??null);
  }
  const centers=inspectSelectedProfileHandles(doc,selection);
  if(centers.kind!=='selected_profile_handles')
    return refuse(stamp,centers.reason,centers.detail??null,
      centers.sourceStatus??null,centers.diagnostics??[]);
  if(dimensions.profile.semanticProfileId!==centers.semanticProfileId)
    return refuse(stamp,'inconsistent_selected_profile');
  const handles=dimensions.dimensions.map(d=>({
    handleId:d.handle.id,kind:'dimension',dimensionKind:d.kind,
    constraintIds:[d.constraintId],entityId:d.drivenPointId??
      d.circleId??'',position:{...d.handle.position},valueMm:d.value
  }));
  for(const h of centers.holeCenters){
    handles.push({
      handleId:h.id,kind:'hole_center',dimensionKind:null,
      constraintIds:[h.xConstraintId,h.yConstraintId],
      entityId:h.holeId,position:{...h.position},valueMm:null
    });
  }
  handles.sort((a,b)=>a.handleId<b.handleId?-1:a.handleId>b.handleId?1:0);
  if(new Set(handles.map(h=>h.handleId)).size!==handles.length)
    return refuse(stamp,'duplicate_semantic_handle');
  return {kind:'pointer_editable_handles',version:1,sourceSignature:stamp,
    selection:{...dimensions.selection},
    semanticProfileId:dimensions.profile.semanticProfileId,
    solverStatus:'solved',degreesOfFreedom:dimensions.degreesOfFreedom,
    diagnostics:dimensions.diagnostics,handles,...preview};
}

/**
 * Hit-test explicitly selected contour handles using caller-selected mm
 * radius. Multiple hits return choices, not an arbitrary nearest handle.
 * A separate 'hole_center' mode resolves the X/Y dimension overlay without
 * weakening the general ambiguity rule.
 */
export function pickProfileHandleAtPointer(source,selection,request){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(request,['kind','version','sourceSignature','point','maxDistanceMm','filter'])||
     request.kind!=='pick-profile-handle'||request.version!==1||
     typeof request.sourceSignature!=='string'||!point(request.point)||
     !finite(request.maxDistanceMm)||request.maxDistanceMm<=0||
     request.maxDistanceMm>20||
     !['all','dimension','hole_center'].includes(request.filter))
    return refuse(stamp,'invalid_pointer_command');
  if(request.sourceSignature!==stamp)return refuse(stamp,'stale_source');
  const view=inspectPointerEditableHandles(doc,selection);
  if(view.kind!=='pointer_editable_handles')return view;
  const hits=[];
  for(const h of view.handles){
    if(request.filter!=='all'&&h.kind!==request.filter)continue;
    const distanceMm=Math.hypot(
      h.position.x-request.point.x,h.position.y-request.point.y);
    if(!finite(distanceMm))return refuse(stamp,'numeric_ambiguity',h.handleId);
    if(distanceMm<=request.maxDistanceMm)
      hits.push({...h,distanceMm});
  }
  hits.sort((a,b)=>a.distanceMm-b.distanceMm||
    (a.handleId<b.handleId?-1:a.handleId>b.handleId?1:0));
  if(hits.length===0)return {kind:'miss',version:1,sourceSignature:stamp,
    reason:'no_handle_in_range',...preview};
  if(hits.length>1)return {kind:'ambiguous',version:1,sourceSignature:stamp,
    reason:'multiple_handles_in_range',selection:view.selection,
    choices:hits,...preview};
  return {kind:'picked',version:1,sourceSignature:stamp,
    selection:view.selection,semanticProfileId:view.semanticProfileId,
    handle:hits[0],...preview};
}

/**
 * One semantic handle, one committed replacement sketch/selection.
 * Ambiguous hits must be resolved by WORKBENCH before supplying handleId.
 * All edits are independently revalidated by their original solver API.
 */
export function dragProfileHandleAtPointer(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','handleId','target'])||
     command.kind!=='drag-profile-handle'||command.version!==1||
     typeof command.sourceSignature!=='string'||
     typeof command.handleId!=='string'||!point(command.target))
    return refuse(stamp,'invalid_drag_command');
  if(command.sourceSignature!==stamp)return refuse(stamp,'stale_source');
  const view=inspectPointerEditableHandles(doc,selection);
  if(view.kind!=='pointer_editable_handles')return view;
  const handle=view.handles.find(h=>h.handleId===command.handleId);
  if(!handle)return refuse(stamp,'handle_not_in_selected_contour',command.handleId);
  const result=handle.kind==='dimension'?
    dragSelectedProfileDimension(doc,selection,{
      version:1,sourceSignature:stamp,
      handleId:handle.handleId,target:{...command.target}
    }):
    moveSelectedProfileHoleCenter(doc,selection,{
      kind:'move-hole-center',sourceSignature:stamp,
      handleId:handle.handleId,xMm:command.target.x,yMm:command.target.y
    });
  if(result.kind!=='accepted')
    return refuse(stamp,result.reason,result.detail??null,
      result.sourceStatus??null,result.diagnostics??[],result.conflict??null);
  // Do not silently switch semantic profiles or return stale gesture handles.
  if(result.profile.semanticProfileId!==view.semanticProfileId ||
     result.nextSourceSignature!==serializeSketch(result.sketch) ||
     result.selection.sourceSignature!==result.nextSourceSignature)
    return refuse(stamp,'successor_identity_or_revision_mismatch');
  const successor=inspectPointerEditableHandles(result.sketch,result.selection);
  if(successor.kind!=='pointer_editable_handles'||
     successor.semanticProfileId!==view.semanticProfileId)
    return refuse(stamp,'successor_handles_unavailable');
  const nextHandle=successor.handles.find(h=>h.handleId===handle.handleId);
  if(!nextHandle)return refuse(stamp,'semantic_handle_lost');
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:result.nextSourceSignature,sketch:result.sketch,
    selection:result.selection,profile:result.profile,
    handleId:handle.handleId,handleKind:handle.kind,
    changedConstraintIds:[...handle.constraintIds],
    gesture:{requested:{...command.target},applied:{...nextHandle.position},
      deviationMm:Math.hypot(nextHandle.position.x-command.target.x,
        nextHandle.position.y-command.target.y)},
    handles:successor.handles,...preview};
}
