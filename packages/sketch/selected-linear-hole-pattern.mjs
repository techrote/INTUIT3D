/**
 * Atomic, constraint-authored linear circular-hole array on an explicitly
 * selected, fully solved LINEAR profile. A real sketch command, not a preview
 * mesh, a duplicated browser document, or a claim of native/STEP exactness.
 *
 * The first hole follows an authored point; subsequent centres reference
 * their predecessor, so retrospective parent edits preserve the pattern.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {inspectSelectedProfileHoleAuthoring} from './selected-profile-hole-authoring.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';

export const SELECTED_LINEAR_HOLE_PATTERN_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const patternIdValid=s=>typeof s==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(s);
const exact=(o,names)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===names.length&&names.every(k=>Object.hasOwn(o,k));
const ids=(id,i)=>{
  const holeId=id+':hole:'+i;
  return {holeId,centerId:holeId+':center',xId:holeId+':offsetX',
    yId:holeId+':offsetY',radiusId:holeId+':radius'};
};
const refusal=(stamp,reason,detail=null,sourceStatus=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,sourceStatus,
  diagnostics,previewOnly:true,nativeExact:false
});
const countValid=n=>Number.isSafeInteger(n)&&n>=2&&n<=12;
const dimensionsValid=(pitchX,pitchY,radius,count)=>
  finite(pitchX)&&finite(pitchY)&&(pitchX!==0||pitchY!==0)&&
  finite(radius)&&radius>0&&countValid(count);
const references=(c,centres,circles)=>centres.has(c.point)||
  centres.has(c.a)||centres.has(c.b)||circles.has(c.circle)||
  (c.kind==='equalRadius'&&(circles.has(c.a)||circles.has(c.b)));

/** Confirm an existing array still has the original chain of authored
 * X/Y/radius constraints. Independent user edits remain in the sketch but
 * cannot be misinterpreted as array-owned parameters. */
function readPattern(doc,view,patternId) {
  const prefix=patternId+':hole:';
  const found=doc.circles.filter(c=>c.id.startsWith(prefix));
  if(!found.length)return {error:'pattern_not_found'};
  if(!countValid(found.length))return {error:'pattern_modified'};
  const byCircle=new Map(doc.circles.map(c=>[c.id,c]));
  const byConstraint=new Map(doc.constraints.map(c=>[c.id,c]));
  const selected=new Set(view.profile.holeIds);
  const members=[];
  let anchorPointId=null,pitchXmm=null,pitchYmm=null,radiusMm=null;
  for(let i=0;i<found.length;i++){
    const name=ids(patternId,i),circle=byCircle.get(name.holeId);
    const x=byConstraint.get(name.xId),y=byConstraint.get(name.yId);
    const r=byConstraint.get(name.radiusId);
    if(!circle||!selected.has(name.holeId)||
       circle.center!==name.centerId||
       !x||x.kind!=='distanceX'||x.b!==name.centerId||
       !y||y.kind!=='distanceY'||y.b!==name.centerId||
       !r||r.kind!=='radius'||r.circle!==name.holeId||
       !finite(x.value)||!finite(y.value)||!finite(r.value)||r.value<=0)
      return {error:'pattern_modified'};
    if(i===0){
      if(x.a!==y.a||!view.anchors.some(a=>a.pointId===x.a&&
          a.pointId!==name.centerId))return {error:'pattern_modified'};
      anchorPointId=x.a;radiusMm=r.value;
    }else{
      if(x.a!==members[i-1].centerPointId||
         y.a!==members[i-1].centerPointId||r.value!==radiusMm)
        return {error:'pattern_modified'};
      if(i===1){pitchXmm=x.value;pitchYmm=y.value;}
      if(x.value!==pitchXmm||y.value!==pitchYmm)
        return {error:'pattern_modified'};
    }
    const position=view.holes.find(h=>h.holeId===name.holeId)?.position;
    if(!position)return {error:'pattern_modified'};
    members.push({holeId:name.holeId,centerPointId:name.centerId,
      position,radiusMm:r.value,xConstraintId:name.xId,
      yConstraintId:name.yId,radiusConstraintId:name.radiusId});
  }
  if(!dimensionsValid(pitchXmm,pitchYmm,radiusMm,members.length))
    return {error:'pattern_modified'};
  return {patternId,count:members.length,anchorPointId,pitchXmm,pitchYmm,
    radiusMm,members};
}

function inspect(source,selection,patternId) {
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!patternIdValid(patternId))return refusal(stamp,'invalid_pattern_id');
  const selected=inspectSelectedProfileHoleAuthoring(doc,selection);
  if(selected.kind!=='selected_profile_hole_authoring')
    return refusal(stamp,selected.reason,selected.detail,selected.sourceStatus,
      selected.diagnostics);
  const pattern=readPattern(doc,selected,patternId);
  if(pattern.error)return refusal(stamp,pattern.error);
  return {kind:'selected_linear_hole_pattern',version:1,sourceSignature:stamp,
    selection:selected.selection,semanticProfileId:selected.semanticProfileId,
    ...pattern,previewOnly:true,nativeExact:false};
}

/** Inspection feeds a real inspector/manipulator, not a standalone fixture. */
export function inspectSelectedLinearHolePattern(source,selection,patternId) {
  return inspect(source,selection,patternId);
}

/** Only remove entities genuinely owned by an array. Downstream authored
 * constraints/geometry block count reduction or deletion instead of being
 * silently removed, including references from unrelated holes. */
function deletionDependentIds(doc,removedMembers) {
  const centres=new Set(removedMembers.map(m=>m.centerPointId));
  const circles=new Set(removedMembers.map(m=>m.holeId));
  const owned=new Set(removedMembers.flatMap(m=>
    [m.xConstraintId,m.yConstraintId,m.radiusConstraintId]));
  const external=[
    ...doc.constraints.filter(c=>!owned.has(c.id)&&references(c,centres,circles)).map(c=>c.id),
    ...doc.lines.filter(l=>centres.has(l.start)||centres.has(l.end)).map(l=>l.id),
    ...doc.circles.filter(c=>!circles.has(c.id)&&centres.has(c.center)).map(c=>c.id)
  ];
  return [...new Set(external)].sort();
}
function appendMember(next,name,reference,x,y,r,pointX,pointY) {
  if(![x,y,r,pointX,pointY].every(finite))
    throw new TypeError('unrepresentable authored array coordinate');
  next.points.push({id:name.centerId,x:pointX,y:pointY});
  next.circles.push({id:name.holeId,center:name.centerId,radius:r});
  next.constraints.push(
    {id:name.xId,kind:'distanceX',a:reference,b:name.centerId,value:x},
    {id:name.yId,kind:'distanceY',a:reference,b:name.centerId,value:y},
    {id:name.radiusId,kind:'radius',circle:name.holeId,value:r}
  );
}

/**
 * One revision for array creation, reparameterization or removal.
 * A refused edit exposes no replacement sketch; the original, including
 * contradictory/underconstrained authored intent, is never rewritten.
 */
export function editSelectedLinearHolePattern(source,selection,command) {
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const selected=inspectSelectedProfileHoleAuthoring(doc,selection);
  if(selected.kind!=='selected_profile_hole_authoring')
    return refusal(stamp,selected.reason,selected.detail,selected.sourceStatus,
      selected.diagnostics);
  const keysets={
    'create-pattern':['kind','sourceSignature','patternId','anchorPointId',
      'firstXmm','firstYmm','pitchXmm','pitchYmm','radiusMm','count'],
    'set-pattern':['kind','sourceSignature','patternId','pitchXmm','pitchYmm',
      'radiusMm','count'],
    'remove-pattern':['kind','sourceSignature','patternId']
  };
  const fields=keysets[command?.kind];
  if(!fields||!exact(command,fields)||!patternIdValid(command.patternId)||
     typeof command.sourceSignature!=='string')
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const existing=readPattern(doc,selected,command.patternId);
  if(command.kind==='create-pattern'){
    if(!existing.error)return refusal(stamp,'pattern_id_collision');
    if(existing.error!=='pattern_not_found')return refusal(stamp,'pattern_modified');
  }else if(existing.error)return refusal(stamp,existing.error);
  if(command.kind!=='remove-pattern'&&
     !dimensionsValid(command.pitchXmm,command.pitchYmm,
       command.radiusMm,command.count))
    return refusal(stamp,'invalid_pattern_dimensions');
  const next=structuredClone(doc),changedConstraintIds=[];
  let formerCount=existing.error?0:existing.count;
  let anchorPointId=existing.error?null:existing.anchorPointId;
  let first;
  if(command.kind==='create-pattern'){
    if(!finite(command.firstXmm)||!finite(command.firstYmm))
      return refusal(stamp,'invalid_first_position');
    const anchor=selected.anchors.find(a=>a.pointId===command.anchorPointId);
    if(!anchor)return refusal(stamp,'unknown_selected_anchor');
    anchorPointId=anchor.pointId;
    first={x:command.firstXmm,y:command.firstYmm};
    const occupied=new Set([...doc.points,...doc.lines,...doc.circles,
      ...doc.constraints].map(e=>e.id));
    for(let i=0;i<command.count;i++){
      if(Object.values(ids(command.patternId,i)).some(id=>id.length>128||
          occupied.has(id)))return refusal(stamp,'derived_identity_collision');
    }
  }else{
    first=existing.members[0].position;
    if(command.kind==='set-pattern'&&
       existing.count===command.count&&
       existing.pitchXmm===command.pitchXmm&&
       existing.pitchYmm===command.pitchYmm&&
       existing.radiusMm===command.radiusMm)
      return refusal(stamp,'no_change');
  }
  const targetCount=command.kind==='remove-pattern'?0:command.count;
  const removed=existing.error?[]:existing.members.slice(targetCount);
  // Dependencies between removed members are also removed; only surviving
  // external references (including those from retained members) are blockers.
  const deps=deletionDependentIds(doc,removed).filter(id=>
    !removed.some(m=>[m.xConstraintId,m.yConstraintId,m.radiusConstraintId].includes(id)));
  if(deps.length)return refusal(stamp,'pattern_has_dependents',deps.join(','));
  const removedPoints=new Set(removed.map(m=>m.centerPointId));
  const removedCircles=new Set(removed.map(m=>m.holeId));
  const removedConstraints=new Set(removed.flatMap(m=>
    [m.xConstraintId,m.yConstraintId,m.radiusConstraintId]));
  next.points=next.points.filter(p=>!removedPoints.has(p.id));
  next.circles=next.circles.filter(c=>!removedCircles.has(c.id));
  next.constraints=next.constraints.filter(c=>!removedConstraints.has(c.id));
  changedConstraintIds.push(...removedConstraints);
  if(targetCount){
    const used=new Set([...next.points,...next.lines,...next.circles,
      ...next.constraints].map(e=>e.id));
    for(let i=0;i<targetCount;i++){
      const name=ids(command.patternId,i);
      if(i<formerCount){
        const x=next.constraints.find(c=>c.id===name.xId);
        const y=next.constraints.find(c=>c.id===name.yId);
        const r=next.constraints.find(c=>c.id===name.radiusId);
        if(i>0){x.value=command.pitchXmm;y.value=command.pitchYmm;
          changedConstraintIds.push(x.id,y.id);}
        if(r.value!==command.radiusMm){r.value=command.radiusMm;
          next.circles.find(c=>c.id===name.holeId).radius=command.radiusMm;
          changedConstraintIds.push(r.id);}
      }else{
        if(Object.values(name).some(id=>id.length>128||used.has(id)))
          return refusal(stamp,'derived_identity_collision');
        const ref=i===0?anchorPointId:ids(command.patternId,i-1).centerId;
        const x=i===0?first.x-selected.anchors.find(a=>a.pointId===ref).position.x:
          command.pitchXmm;
        const y=i===0?first.y-selected.anchors.find(a=>a.pointId===ref).position.y:
          command.pitchYmm;
        const pointX=first.x+i*command.pitchXmm;
        const pointY=first.y+i*command.pitchYmm;
        try{appendMember(next,name,ref,x,y,command.radiusMm,pointX,pointY);}
        catch(e){return refusal(stamp,'unrepresentable_pattern',String(e.message));}
        changedConstraintIds.push(name.xId,name.yId,name.radiusId);
        Object.values(name).forEach(id=>used.add(id));
      }
    }
  }
  let validated,solved;
  try{validated=createSketch(next);solved=solveSketch(validated);}
  catch(e){return refusal(stamp,'edit_rejected',String(e.message));}
  if(solved.status!=='solved'||!solved.geometry)
    return refusal(stamp,'unsolved_after_edit',null,solved.status,solved.diagnostics);
  const nextStamp=serializeSketch(validated);
  const proposed=proposeSelectedPlateProfile(validated,{
    candidateId:selected.selection.candidateId,sourceSignature:nextStamp});
  if(proposed.kind!=='selected_analytic_profile')
    return refusal(stamp,'profile_rejected_after_edit',proposed.reason,solved.status);
  const admitted=admitSelectedPlateProfile(validated,proposed);
  if(admitted.semanticProfileId!==selected.semanticProfileId)
    return refusal(stamp,'semantic_profile_changed');
  const expected=new Set(selected.profile.holeIds);
  if(command.kind==='create-pattern')
    for(let i=0;i<targetCount;i++)expected.add(ids(command.patternId,i).holeId);
  else for(const m of removed)expected.delete(m.holeId);
  if(admitted.holeIds.length!==expected.size||
     admitted.holeIds.some(id=>!expected.has(id)))
    return refusal(stamp,'hole_membership_changed');
  let pattern=null;
  if(targetCount){
    const refreshed=inspectSelectedLinearHolePattern(validated,{
      candidateId:admitted.candidateId,sourceSignature:nextStamp
    },command.patternId);
    if(refreshed.kind!=='selected_linear_hole_pattern')
      return refusal(stamp,'pattern_reinspection_failed',refreshed.reason);
    pattern=refreshed;
  }
  return {kind:'accepted',version:1,operation:command.kind,
    sourceSignature:stamp,nextSourceSignature:nextStamp,
    sketch:validated,selection:{candidateId:admitted.candidateId,sourceSignature:nextStamp},
    profile:admitted,semanticProfileId:admitted.semanticProfileId,
    patternId:command.patternId,pattern,changedConstraintIds:[...new Set(changedConstraintIds)].sort(),
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}
