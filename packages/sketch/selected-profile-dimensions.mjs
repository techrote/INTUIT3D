/**
 * Atomic selected-profile dimensional editing and explicit conflict recovery.
 *
 * Reuses the authoritative linear solver and selected-contour admission;
 * neither previews nor commits silently remove, weaken or replace constraints.
 * RUNTIME must journal the returned sketch AND successor selection together.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';
import {explainLinearConflict} from './conflict-explanation.mjs';

export const SELECTED_PROFILE_DIMENSIONS_VERSION=1;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-8;
const refuse=(stamp,reason,detail=null,status=null,diagnostics=[],conflict=null)=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus:status,diagnostics,conflict,previewOnly:true,nativeExact:false
});
const solveMap=solution=>new Map(solution.geometry.points.map(p=>[p.id,p]));
const delta=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

/**
 * Inspect directly editable signed dimensions/radii on the authenticated
 * selected contour and its circular holes. A handle is tied to the real
 * constraint ID, never to an incidental screen-space point index.
 */
export function inspectSelectedProfileDimensions(source,selection){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const profile=proposeSelectedPlateProfile(doc,selection);
  if(profile.kind!=='selected_analytic_profile')
    return refuse(stamp,profile.reason,
      profile.overlappingLineIds?.join(',')??null,profile.sourceStatus??null);
  const solution=solveSketch(doc);
  if(solution.status!=='solved'||!solution.geometry)
    return refuse(stamp,'source_not_solved',null,solution.status,solution.diagnostics);
  const pts=solveMap(solution),byCircle=new Map(doc.circles.map(c=>[c.id,c]));
  const selectedPoints=new Set(profile.boundary.flatMap(e=>
    [e.startPointId,e.endPointId]));
  for(const id of profile.holeIds) {
    const c=byCircle.get(id);
    if(c)selectedPoints.add(c.center);
  }
  const dimensions=[];
  for(const c of doc.constraints){
    if((c.kind==='distanceX'||c.kind==='distanceY')&&
       selectedPoints.has(c.b)&&pts.has(c.a)&&pts.has(c.b)){
      const a=pts.get(c.a),b=pts.get(c.b);
      dimensions.push({constraintId:c.id,kind:c.kind,value:c.value,
        referencePointId:c.a,drivenPointId:c.b,
        handle:{id:'dimension:'+c.id,kind:c.kind,
          position:{x:b.x,y:b.y}}});
    }else if(c.kind==='radius'&&profile.holeIds.includes(c.circle)){
      const circle=byCircle.get(c.circle),center=circle&&pts.get(circle.center);
      if(!center)continue;
      dimensions.push({constraintId:c.id,kind:'radius',value:c.value,
        circleId:c.circle,centerPointId:circle.center,
        handle:{id:'dimension:'+c.id,kind:'radius',
          position:{x:center.x+c.value,y:center.y}}});
    }
  }
  return {kind:'selected_profile_dimensions',version:1,
    sourceSignature:stamp,selection:{...selection},profile,
    dimensions,solverStatus:solution.status,
    degreesOfFreedom:solution.degreesOfFreedom,
    redundantEquations:solution.redundantEquations,
    diagnostics:solution.diagnostics,previewOnly:true,nativeExact:false};
}
function prepare(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','changes'])||
     command.kind!=='edit-selected-dimensions'||command.version!==1||
     !Array.isArray(command.changes)||command.changes.length<1||
     command.changes.length>16)
    return {failure:refuse(stamp,'invalid_command')};
  if(command.sourceSignature!==stamp)
    return {failure:refuse(stamp,'stale_source')};
  const view=inspectSelectedProfileDimensions(doc,selection);
  if(view.kind!=='selected_profile_dimensions')
    return {failure:view};
  const allowed=new Map(view.dimensions.map(d=>[d.constraintId,d]));
  const seen=new Set(),next=structuredClone(doc),changed=[];
  for(const change of command.changes){
    if(!exact(change,['constraintId','value'])||
       typeof change.constraintId!=='string'||!finite(change.value)||
       seen.has(change.constraintId))
      return {failure:refuse(stamp,'invalid_dimension_change')};
    seen.add(change.constraintId);
    const dimension=allowed.get(change.constraintId);
    if(!dimension)
      return {failure:refuse(stamp,'dimension_not_selected_or_editable',change.constraintId)};
    if(dimension.kind==='radius'&&change.value<=0)
      return {failure:refuse(stamp,'nonpositive_radius',change.constraintId)};
    const target=next.constraints.find(c=>c.id===change.constraintId);
    if(target.value!==change.value){
      target.value=change.value;
      changed.push(change.constraintId);
    }
  }
  if(!changed.length)
    return {failure:refuse(stamp,'no_change')};
  return {doc,stamp,view,next,changed:changed.sort()};
}
function evaluate(prepared){
  const {doc,stamp,view,next,changed}=prepared;
  const solution=solveSketch(next);
  if(solution.status!=='solved'||!solution.geometry){
    const conflict=solution.status==='conflicted'?
      explainLinearConflict(next):null;
    return refuse(stamp,'proposed_dimensions_not_solved',null,
      solution.status,solution.diagnostics,conflict);
  }
  const old=solveSketch(doc),before=solveMap(old),after=solveMap(solution);
  const chosen=new Set(view.profile.boundary.flatMap(e=>
    [e.startPointId,e.endPointId]));
  for(const c of doc.circles)
    if(view.profile.holeIds.includes(c.id))chosen.add(c.center);
  // This operation cannot quietly move a disconnected or unselected body.
  for(const [id,p] of before){
    if(chosen.has(id))continue;
    const q=after.get(id);
    if(!q||!close(p.x,q.x)||!close(p.y,q.y))
      return refuse(stamp,'unselected_point_would_move',id,solution.status);
  }
  const discovery=discoverPlateProfiles(next);
  const candidate=discovery.candidates.find(c=>
    same(c.lineIds,view.profile.lineIds)&&
    same(c.holeIds,view.profile.holeIds));
  if(!candidate)
    return refuse(stamp,'selected_contour_no_longer_admissible',
      JSON.stringify({status:discovery.status,rejected:discovery.rejected}),
      solution.status,solution.diagnostics);
  const signature=serializeSketch(next);
  const successor=proposeSelectedPlateProfile(next,{
    candidateId:candidate.id,sourceSignature:signature});
  if(successor.kind!=='selected_analytic_profile')
    return refuse(stamp,'selected_profile_rejected',successor.reason,
      solution.status,solution.diagnostics);
  let profile;
  try{profile=admitSelectedPlateProfile(next,successor);}
  catch(e){return refuse(stamp,'selected_profile_admission_failed',
    String(e?.message||e),solution.status,solution.diagnostics);}
  const changedPointIds=[...chosen].filter(id=>
    before.has(id)&&after.has(id)&&delta(before.get(id),after.get(id))>1e-8).sort();
  const changedRadiusIds=doc.circles.filter(c=>
    view.profile.holeIds.includes(c.id)&&
    !close(old.geometry.circles.find(x=>x.id===c.id).radius,
      solution.geometry.circles.find(x=>x.id===c.id).radius))
    .map(c=>c.id).sort();
  const selection={candidateId:profile.candidateId,sourceSignature:signature};
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:signature,sketch:next,selection,profile,
    previousCandidateId:view.selection.candidateId,
    nextCandidateId:profile.candidateId,
    changedConstraintIds:changed,
    changedPointIds,changedRadiusIds,solverStatus:solution.status,
    degreesOfFreedom:solution.degreesOfFreedom,
    redundantEquations:solution.redundantEquations,
    diagnostics:solution.diagnostics,previewOnly:true,nativeExact:false,
    exactBrepAvailable:false,independentStepQualified:false};
}
/** Validate a multi-dimension transaction, never mutating the source. */
export function editSelectedProfileDimensions(source,selection,command){
  const prepared=prepare(source,selection,command);
  return prepared.failure??evaluate(prepared);
}
/**
 * Convert one semantic pointer move to one real constraint value, preserving
 * all other dimensions. The applied pointer and off-axis deviation are
 * returned as honest UX feedback. Any conflicting edit is refused.
 */
export function dragSelectedProfileDimension(source,selection,gesture){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(gesture,['version','sourceSignature','handleId','target'])||
     gesture.version!==1||gesture.sourceSignature!==stamp||
     !exact(gesture.target,['x','y'])||
     !finite(gesture.target.x)||!finite(gesture.target.y)||
     typeof gesture.handleId!=='string')
    return refuse(stamp,'invalid_pointer_gesture');
  const view=inspectSelectedProfileDimensions(doc,selection);
  if(view.kind!=='selected_profile_dimensions')return view;
  const dimension=view.dimensions.find(d=>d.handle.id===gesture.handleId);
  if(!dimension)return refuse(stamp,'unknown_handle',gesture.handleId);
  const solved=solveSketch(doc),pts=solveMap(solved);
  let value;
  if(dimension.kind==='radius')
    value=gesture.target.x-pts.get(dimension.centerPointId).x;
  else {
    const a=pts.get(dimension.referencePointId);
    value=gesture.target[dimension.kind==='distanceX'?'x':'y']-
      a[dimension.kind==='distanceX'?'x':'y'];
  }
  const result=editSelectedProfileDimensions(doc,selection,{
    kind:'edit-selected-dimensions',version:1,sourceSignature:stamp,
    changes:[{constraintId:dimension.constraintId,value}]});
  if(result.kind!=='accepted')return result;
  const inspected=inspectSelectedProfileDimensions(result.sketch,result.selection);
  if(inspected.kind!=='selected_profile_dimensions')
    return refuse(stamp,'post_edit_inspection_failed');
  const applied=inspected.dimensions.find(d=>d.constraintId===dimension.constraintId);
  if(!applied)return refuse(stamp,'dimension_lost_after_edit');
  const p=applied.handle.position;
  return {...result,gesture:{handleId:gesture.handleId,
    requested:{...gesture.target},applied:{...p},
    projectionDeviationMm:Math.hypot(p.x-gesture.target.x,
      p.y-gesture.target.y)}};
}
