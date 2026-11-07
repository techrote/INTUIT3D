import {createSketch, editConstraint, serializeSketch, solveSketch} from './index.mjs';
import {admitSelectedPlateProfile,proposeSelectedPlateProfile} from './selected-profile.mjs';

/**
 * Interactive dimension handles for explicitly selected, fully solved LINEAR
 * sketch profiles. This version does not infer a B-rep or automatically
 * promote a preview to native/exact geometry.
 */
export const SELECTED_PROFILE_HANDLES_VERSION=1;
const validNumber=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&
  keys.every(k=>Object.hasOwn(o,k));
const pointMap=solved=>new Map(solved.geometry.points.map(p=>[p.id,p]));
const refuse=(sourceSignature,reason,sourceStatus=null,diagnostics=[],detail=null)=>
  ({kind:'refused',version:1,sourceSignature,reason,sourceStatus,
    diagnostics,detail,previewOnly:true,nativeExact:false});

/** Resolve authored dimensions against the actual solver and profile selection. */
export function inspectSelectedProfileHandles(source,selection) {
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const selected=proposeSelectedPlateProfile(doc,selection);
  if(selected.kind!=='selected_analytic_profile')
    return refuse(stamp,selected.reason,selected.sourceStatus,[],null);
  const solved=solveSketch(doc);
  if(solved.status!=='solved'||!solved.geometry)
    return refuse(stamp,'source_not_solved',solved.status,solved.diagnostics);
  const points=pointMap(solved);
  const eligible=new Set(selected.boundary.flatMap(e=>[e.startPointId,e.endPointId]));
  for(const hole of selected.profile.holes) eligible.add(hole.centerId);
  const holeIds=new Set(selected.holeIds);
  const circles=new Map(doc.circles.map(c=>[c.id,c]));
  const solvedCircles=new Map(solved.geometry.circles.map(c=>[c.id,c]));
  const controls=[];
  for(const c of doc.constraints){
    let anchor,position,entityId;
    if((c.kind==='distanceX'||c.kind==='distanceY')&&
        eligible.has(c.a)&&eligible.has(c.b)){
      anchor=points.get(c.a);
      position=points.get(c.b);
      entityId=c.b;
    }else if(c.kind==='radius'&&holeIds.has(c.circle)){
      const circle=circles.get(c.circle);
      anchor=points.get(circle.center);
      position={x:anchor.x+solvedCircles.get(c.circle).radius,y:anchor.y};
      entityId=c.circle;
    }else continue;
    if(!anchor||!position) return refuse(stamp,'missing_solved_handle','solved');
    controls.push({id:'dimension:'+c.id,constraintId:c.id,kind:c.kind,
      entityId,valueMm:c.value,
      anchor:{x:anchor.x,y:anchor.y},
      position:{x:position.x,y:position.y}});
  }
  controls.sort((a,b)=>a.constraintId.localeCompare(b.constraintId,'en'));
  // A circle centre with exactly one authored X and one Y relation to solved
  // reference points can be dragged as a single *two-dimension* edit. Do not
  // invent a mutable screen-space centre or relax unrelated constraints.
  const holeCenters=[];
  for(const holeId of selected.holeIds){
    const centerPointId=circles.get(holeId)?.center;
    const position=points.get(centerPointId);
    if(!position)continue;
    const x=doc.constraints.filter(c=>c.kind==='distanceX'&&
      c.b===centerPointId&&points.has(c.a));
    const y=doc.constraints.filter(c=>c.kind==='distanceY'&&
      c.b===centerPointId&&points.has(c.a));
    if(x.length!==1||y.length!==1)continue;
    const xAnchor=points.get(x[0].a),yAnchor=points.get(y[0].a);
    holeCenters.push({
      id:'hole-center:'+holeId,holeId,centerPointId,
      position:{x:position.x,y:position.y},
      xConstraintId:x[0].id,yConstraintId:y[0].id,
      xReferencePointId:x[0].a,yReferencePointId:y[0].a,
      xAnchor:{x:xAnchor.x,y:xAnchor.y},
      yAnchor:{x:yAnchor.x,y:yAnchor.y},
      xOffsetMm:x[0].value,yOffsetMm:y[0].value
    });
  }
  holeCenters.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  return {kind:'selected_profile_handles',version:1,sourceSignature:stamp,
    selection:{candidateId:selected.candidateId,sourceSignature:stamp},
    semanticProfileId:selected.semanticProfileId,
    controls,holeCenters,profile:selected,previewOnly:true,nativeExact:false};
}

/**
 * A single dimension edit or completed pointer gesture = one replacement
 * sketch. No intermediate writes, silent constraint relaxation or retained
 * invalid geometry. On refusal the authoritative source remains unchanged.
 */
export function editSelectedProfileHandle(source,selection,command) {
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const inspected=inspectSelectedProfileHandles(doc,selection);
  if(inspected.kind!=='selected_profile_handles') return inspected;
  const isSet=command?.kind==='set-dimension';
  const isDrag=command?.kind==='drag-handle';
  const keys=isSet?['kind','sourceSignature','handleId','valueMm']:
    ['kind','sourceSignature','handleId','xMm','yMm'];
  if((!isSet&&!isDrag)||!exact(command,keys)||
      typeof command.sourceSignature!=='string'||
      typeof command.handleId!=='string')
    return refuse(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)
    return refuse(stamp,'stale_source');
  const handle=inspected.controls.find(h=>h.id===command.handleId);
  if(!handle)return refuse(stamp,'unknown_handle');
  let value=command.valueMm;
  if(isDrag){
    if(!validNumber(command.xMm)||!validNumber(command.yMm))
      return refuse(stamp,'invalid_pointer');
    value=handle.kind==='distanceX'?command.xMm-handle.anchor.x:
      handle.kind==='distanceY'?command.yMm-handle.anchor.y:
      Math.hypot(command.xMm-handle.anchor.x,command.yMm-handle.anchor.y);
  }
  if(!validNumber(value)||(handle.kind==='radius'&&value<=0))
    return refuse(stamp,'invalid_dimension');
  if(value===handle.valueMm)return refuse(stamp,'no_change');
  let next;
  try{next=editConstraint(doc,handle.constraintId,{value});}
  catch(error){return refuse(stamp,'edit_rejected',null,[],String(error?.message||error));}
  const solved=solveSketch(next);
  if(solved.status!=='solved'||!solved.geometry)
    return refuse(stamp,'unsolved_after_edit',solved.status,solved.diagnostics);
  const nextStamp=serializeSketch(next);
  const proposed=proposeSelectedPlateProfile(next,{
    candidateId:inspected.selection.candidateId,sourceSignature:nextStamp});
  if(proposed.kind!=='selected_analytic_profile')
    return refuse(stamp,'profile_rejected_after_edit',solved.status,[],
      proposed.reason);
  const admitted=admitSelectedPlateProfile(next,proposed);
  if(admitted.semanticProfileId!==inspected.semanticProfileId)
    return refuse(stamp,'semantic_profile_changed',solved.status);
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:nextStamp,sketch:next,
    selection:{candidateId:admitted.candidateId,sourceSignature:nextStamp},
    profile:admitted,handleId:handle.id,appliedValueMm:value,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}


// Move the selected L-profile hole centre using both authored solver dimensions
// in one immutable revision. This cannot be implemented as two browser commits:
// an intermediate X-only position may intersect the profile boundary.
export function moveSelectedProfileHoleCenter(source,selection,command) {
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const inspected=inspectSelectedProfileHandles(doc,selection);
  if(inspected.kind!=='selected_profile_handles')return inspected;
  if(!exact(command,['kind','sourceSignature','handleId','xMm','yMm'])||
    command.kind!=='move-hole-center'||typeof command.sourceSignature!=='string'||
    typeof command.handleId!=='string')
    return refuse(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refuse(stamp,'stale_source');
  if(!validNumber(command.xMm)||!validNumber(command.yMm))
    return refuse(stamp,'invalid_pointer');
  const handle=inspected.holeCenters.find(c=>c.id===command.handleId);
  if(!handle)return refuse(stamp,'unknown_hole_center');
  if(command.xMm===handle.position.x&&command.yMm===handle.position.y)
    return refuse(stamp,'no_change');
  const x=command.xMm-handle.xAnchor.x;
  const y=command.yMm-handle.yAnchor.y;
  if(!validNumber(x)||!validNumber(y))
    return refuse(stamp,'unrepresentable_dimension');
  let next;
  try{
    next=editConstraint(doc,handle.xConstraintId,{value:x});
    next=editConstraint(next,handle.yConstraintId,{value:y});
  }catch(error){
    return refuse(stamp,'edit_rejected',null,[],String(error?.message||error));
  }
  const solved=solveSketch(next);
  if(solved.status!=='solved'||!solved.geometry)
    return refuse(stamp,'unsolved_after_edit',solved.status,solved.diagnostics);
  const nextStamp=serializeSketch(next);
  const proposed=proposeSelectedPlateProfile(next,{
    candidateId:inspected.selection.candidateId,sourceSignature:nextStamp
  });
  if(proposed.kind!=='selected_analytic_profile')
    return refuse(stamp,'profile_rejected_after_edit',solved.status,[],proposed.reason);
  const admitted=admitSelectedPlateProfile(next,proposed);
  if(admitted.semanticProfileId!==inspected.semanticProfileId)
    return refuse(stamp,'semantic_profile_changed',solved.status);
  const nextSelection={candidateId:admitted.candidateId,sourceSignature:nextStamp};
  const updated=inspectSelectedProfileHandles(next,nextSelection);
  if(updated.kind!=='selected_profile_handles')
    return refuse(stamp,'updated_handles_unavailable');
  const applied=updated.holeCenters.find(c=>c.id===handle.id)?.position;
  if(!applied)return refuse(stamp,'updated_hole_center_unavailable');
  return {
    kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:nextStamp,sketch:next,selection:nextSelection,
    profile:admitted,handleId:handle.id,holeId:handle.holeId,
    editedConstraintIds:[handle.xConstraintId,handle.yConstraintId],
    appliedOffsetsMm:{x,y},
    gesture:{
      target:{x:command.xMm,y:command.yMm},appliedPoint:applied,
      deviationMm:Math.hypot(applied.x-command.xMm,applied.y-command.yMm)
    },
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false
  };
}
