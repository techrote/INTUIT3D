/**
 * Immutable, revision-fenced circular hole authoring for a deliberately
 * selected, fully solved linear contour. A hole may be dimensioned relative
 * to a selected boundary vertex or another selected hole centre; it therefore
 * follows retrospective changes through the existing sketch solver.
 *
 * This produces analytic sketch/profile intent, NOT a native B-rep or STEP.
 * The consumer's INTENT/RUNTIME journal owns the actual commit.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {inspectSelectedProfileHandles} from './selected-profile-handles.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';

export const SELECTED_PROFILE_HOLE_AUTHORING_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validId=s=>typeof s==='string'&&/^[A-Za-z][\w:.-]{0,127}$/.test(s);
const exact=(o,fields)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===fields.length&&fields.every(k=>Object.hasOwn(o,k));
const refusal=(stamp,reason,sourceStatus=null,diagnostics=[],detail=null)=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,sourceStatus,
  diagnostics,detail,previewOnly:true,nativeExact:false
});

function dependentIds(doc,holeId,centerId,ownIds) {
  const allowed=new Set(ownIds);
  const related=doc.constraints.filter(c=>!allowed.has(c.id)&&(
    c.point===centerId||c.a===centerId||c.b===centerId||
    c.circle===holeId||(c.kind==='equalRadius'&&(c.a===holeId||c.b===holeId))
  )).map(c=>c.id);
  related.push(...doc.lines.filter(e=>e.start===centerId||e.end===centerId).map(e=>e.id));
  related.push(...doc.circles.filter(e=>e.id!==holeId&&e.center===centerId).map(e=>e.id));
  return related.sort();
}

function inspect(doc,selection) {
  const stamp=serializeSketch(doc);
  const view=inspectSelectedProfileHandles(doc,selection);
  if(view.kind!=='selected_profile_handles')return view;
  const solved=solveSketch(doc);
  if(solved.status!=='solved'||!solved.geometry)
    return refusal(stamp,'source_not_solved',solved.status,solved.diagnostics);
  const points=new Map(solved.geometry.points.map(p=>[p.id,p]));
  const circles=new Map(doc.circles.map(c=>[c.id,c]));
  const anchors=new Map();
  for(const edge of view.profile.boundary){
    const point=points.get(edge.startPointId);
    anchors.set(edge.startPointId,{pointId:edge.startPointId,
      kind:'boundary_vertex',entityId:edge.edgeId,position:{x:point.x,y:point.y}});
  }
  for(const holeId of view.profile.holeIds){
    const centerId=circles.get(holeId).center,point=points.get(centerId);
    anchors.set(centerId,{pointId:centerId,kind:'hole_center',
      entityId:holeId,position:{x:point.x,y:point.y}});
  }
  const holes=view.profile.profile.holes.map(h=>{
    const center=circles.get(h.id).center;
    const pair=view.holeCenters.find(c=>c.holeId===h.id);
    const radiusConstraints=doc.constraints.filter(c=>c.kind==='radius'&&c.circle===h.id)
      .map(c=>c.id);
    const owned=pair?[pair.xConstraintId,pair.yConstraintId,...radiusConstraints]:[];
    const dependents=dependentIds(doc,h.id,center,owned);
    return {holeId:h.id,centerPointId:center,position:{x:h.x,y:h.y},
      radiusMm:h.radius,xConstraintId:pair?.xConstraintId??null,
      yConstraintId:pair?.yConstraintId??null,
      xReferencePointId:pair?.xReferencePointId??null,
      yReferencePointId:pair?.yReferencePointId??null,
      radiusConstraintIds:radiusConstraints,
      dependentEntityIds:dependents,
      canReanchor:!!pair,canRemove:!!pair&&dependents.length===0};
  }).sort((a,b)=>a.holeId.localeCompare(b.holeId,'en'));
  return {kind:'selected_profile_hole_authoring',version:1,
    sourceSignature:stamp,
    selection:{candidateId:view.profile.candidateId,sourceSignature:stamp},
    semanticProfileId:view.semanticProfileId,
    anchors:[...anchors.values()].sort((a,b)=>a.pointId.localeCompare(b.pointId,'en')),
    holes,profile:view.profile,previewOnly:true,nativeExact:false};
}

/** Semantic anchors and explicit dependency diagnostics for a real tool/inspector. */
export function inspectSelectedProfileHoleAuthoring(source,selection) {
  return inspect(createSketch(source),selection);
}

/**
 * Atomic add/remove/reanchor. Every successful result is independently solved
 * and re-admitted with the SAME selected contour ID. Failure never mutates the
 * caller's document or silently changes an unrelated hole.
 */
export function editSelectedProfileHole(source,selection,command) {
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const view=inspect(doc,selection);
  if(view.kind!=='selected_profile_hole_authoring')return view;
  const kinds={
    'add-hole':['kind','sourceSignature','holeId','anchorPointId','xMm','yMm','radiusMm'],
    'remove-hole':['kind','sourceSignature','holeId'],
    'reanchor-hole':['kind','sourceSignature','holeId','anchorPointId']
  };
  if(!command||!kinds[command.kind]||!exact(command,kinds[command.kind])||
     !validId(command.holeId)||typeof command.sourceSignature!=='string')
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const before=view.holes.find(h=>h.holeId===command.holeId);
  const next=structuredClone(doc);
  const anchor=view.anchors.find(a=>a.pointId===command.anchorPointId);
  const used=new Set([...doc.points,...doc.lines,...doc.circles,...doc.constraints].map(e=>e.id));
  let changedConstraintIds=[],offsets=null;
  if(command.kind==='add-hole'){
    if(before||used.has(command.holeId))return refusal(stamp,'hole_id_collision');
    if(!anchor)return refusal(stamp,'unknown_selected_anchor');
    if(!finite(command.xMm)||!finite(command.yMm)||
       !finite(command.radiusMm)||command.radiusMm<=0)
      return refusal(stamp,'invalid_hole_dimensions');
    const ids={center:command.holeId+':center',x:command.holeId+':offsetX',
      y:command.holeId+':offsetY',radius:command.holeId+':radius'};
    if(Object.values(ids).some(id=>!validId(id)||used.has(id)))
      return refusal(stamp,'derived_identity_collision');
    const dx=command.xMm-anchor.position.x,dy=command.yMm-anchor.position.y;
    if(!finite(dx)||!finite(dy))return refusal(stamp,'unrepresentable_offsets');
    next.points.push({id:ids.center,x:command.xMm,y:command.yMm});
    next.circles.push({id:command.holeId,center:ids.center,radius:command.radiusMm});
    next.constraints.push(
      {id:ids.x,kind:'distanceX',a:anchor.pointId,b:ids.center,value:dx},
      {id:ids.y,kind:'distanceY',a:anchor.pointId,b:ids.center,value:dy},
      {id:ids.radius,kind:'radius',circle:command.holeId,value:command.radiusMm}
    );
    changedConstraintIds=[ids.x,ids.y,ids.radius];
    offsets={x:dx,y:dy};
  }else{
    if(!before)return refusal(stamp,'hole_not_in_selected_profile');
    if(!before.canReanchor)
      return refusal(stamp,'hole_not_independently_dimensioned');
    if(command.kind==='remove-hole'){
      if(!before.canRemove)
        return refusal(stamp,'hole_has_dependents',null,[],
          before.dependentEntityIds.join(','));
      const owned=new Set([before.xConstraintId,before.yConstraintId,
        ...before.radiusConstraintIds]);
      next.constraints=next.constraints.filter(c=>!owned.has(c.id));
      next.circles=next.circles.filter(c=>c.id!==before.holeId);
      next.points=next.points.filter(p=>p.id!==before.centerPointId);
      changedConstraintIds=[...owned].sort();
    }else{
      if(!anchor)return refusal(stamp,'unknown_selected_anchor');
      if(anchor.pointId===before.centerPointId)
        return refusal(stamp,'self_reference');
      if(before.xReferencePointId===anchor.pointId&&
         before.yReferencePointId===anchor.pointId)
        return refusal(stamp,'no_change');
      const dx=before.position.x-anchor.position.x;
      const dy=before.position.y-anchor.position.y;
      if(!finite(dx)||!finite(dy))return refusal(stamp,'unrepresentable_offsets');
      const x=next.constraints.find(c=>c.id===before.xConstraintId);
      const y=next.constraints.find(c=>c.id===before.yConstraintId);
      x.a=anchor.pointId;x.value=dx;
      y.a=anchor.pointId;y.value=dy;
      changedConstraintIds=[x.id,y.id];
      offsets={x:dx,y:dy};
    }
  }
  let validated,solved;
  try{
    validated=createSketch(next);
    solved=solveSketch(validated);
  }catch(error){
    return refusal(stamp,'edit_rejected',null,[],String(error?.message||error));
  }
  if(solved.status!=='solved'||!solved.geometry)
    return refusal(stamp,'unsolved_after_edit',solved.status,solved.diagnostics);
  const nextStamp=serializeSketch(validated);
  const proposal=proposeSelectedPlateProfile(validated,{
    candidateId:view.selection.candidateId,sourceSignature:nextStamp});
  if(proposal.kind!=='selected_analytic_profile')
    return refusal(stamp,'profile_rejected_after_edit',solved.status,[],proposal.reason);
  const profile=admitSelectedPlateProfile(validated,proposal);
  if(profile.semanticProfileId!==view.semanticProfileId)
    return refusal(stamp,'semantic_profile_changed',solved.status);
  if(command.kind==='add-hole'&&!profile.holeIds.includes(command.holeId))
    return refusal(stamp,'hole_not_in_selected_profile',solved.status);
  const expected=view.profile.holeIds.filter(id=>command.kind!=='remove-hole'||id!==command.holeId);
  if(command.kind==='add-hole')expected.push(command.holeId);
  if(JSON.stringify([...expected].sort())!==JSON.stringify([...profile.holeIds].sort()))
    return refusal(stamp,'hole_membership_changed',solved.status);
  const actual=profile.profile.holes.find(h=>h.id===command.holeId);
  if(command.kind==='reanchor-hole'&&
     (!actual||Math.hypot(actual.x-before.position.x,actual.y-before.position.y)>1e-9))
    return refusal(stamp,'reanchor_changed_geometry',solved.status);
  return {kind:'accepted',version:1,operation:command.kind,
    sourceSignature:stamp,nextSourceSignature:nextStamp,
    sketch:validated,selection:{candidateId:profile.candidateId,sourceSignature:nextStamp},
    profile,semanticProfileId:profile.semanticProfileId,holeId:command.holeId,
    changedConstraintIds,offsetsMm:offsets,
    beforePosition:before?.position??null,
    afterPosition:actual?{x:actual.x,y:actual.y}:null,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}
