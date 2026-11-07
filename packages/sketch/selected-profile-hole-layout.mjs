/**
 * Revision-fenced multi-hole numeric inspector/drag commit for an explicitly
 * selected, solved linear sketch contour. A batch is one immutable candidate:
 * simultaneous positions can exchange places even if intermediate gestures
 * would collide. All axes/radii remain authored solver constraints.
 *
 * Consumer journal (INTENT/RUNTIME) owns committing, undo and persistence.
 * This is analytic sketch intent, never a B-rep, native cut or STEP result.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {inspectSelectedProfileHoleAuthoring} from './selected-profile-hole-authoring.mjs';
import {admitSelectedPlateProfile,proposeSelectedPlateProfile} from './selected-profile.mjs';

export const SELECTED_PROFILE_HOLE_LAYOUT_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(obj,fields)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k));
const refusal=(stamp,reason,detail=null,sourceStatus=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus,diagnostics,previewOnly:true,nativeExact:false
});
const near=(a,b)=>Math.abs(a-b)<=1e-8;

/** Show the actual editable constraint triplets and dependent-hole references. */
export function inspectSelectedProfileHoleLayout(source,selection){
  const doc=createSketch(source),view=inspectSelectedProfileHoleAuthoring(doc,selection);
  if(view.kind!=='selected_profile_hole_authoring')return view;
  const holes=view.holes.map(h=>({
    holeId:h.holeId,centerPointId:h.centerPointId,
    position:{...h.position},radiusMm:h.radiusMm,
    xConstraintId:h.xConstraintId,yConstraintId:h.yConstraintId,
    radiusConstraintId:h.radiusConstraintIds.length===1?h.radiusConstraintIds[0]:null,
    xReferencePointId:h.xReferencePointId,yReferencePointId:h.yReferencePointId,
    dependentEntityIds:[...h.dependentEntityIds],
    canEdit:!!h.canReanchor&&h.radiusConstraintIds.length===1
  }));
  return {kind:'selected_profile_hole_layout',version:1,
    sourceSignature:view.sourceSignature,selection:view.selection,
    semanticProfileId:view.semanticProfileId,holes,
    profile:view.profile,previewOnly:true,nativeExact:false};
}

/**
 * Apply 1–16 absolute XY/radius edits atomically; edited hole references use
 * their *simultaneously requested* coordinate, not a transient old anchor.
 * An implicitly moved reference can never silently shift an explicit target:
 * the post-solve comparison refuses that ambiguous result.
 */
export function editSelectedProfileHoleLayout(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const view=inspectSelectedProfileHoleAuthoring(doc,selection);
  if(view.kind!=='selected_profile_hole_authoring')return view;
  if(!exact(command,['kind','sourceSignature','edits'])||
     command.kind!=='set-hole-layout'||typeof command.sourceSignature!=='string'||
     !Array.isArray(command.edits)||command.edits.length<1||command.edits.length>16||
     command.edits.some(e=>!exact(e,['holeId','xMm','yMm','radiusMm'])||
       typeof e.holeId!=='string'||!finite(e.xMm)||!finite(e.yMm)||
       !finite(e.radiusMm)||e.radiusMm<=0))
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const requested=new Map();
  const byId=new Map(view.holes.map(h=>[h.holeId,h]));
  const targetByCenter=new Map();
  for(const edit of command.edits){
    if(requested.has(edit.holeId))return refusal(stamp,'duplicate_hole_id',edit.holeId);
    const control=byId.get(edit.holeId);
    if(!control)return refusal(stamp,'hole_not_in_selected_profile',edit.holeId);
    if(!control.canReanchor||control.radiusConstraintIds.length!==1)
      return refusal(stamp,'hole_not_independently_dimensioned',edit.holeId);
    requested.set(edit.holeId,edit);
    targetByCenter.set(control.centerPointId,{x:edit.xMm,y:edit.yMm});
  }
  const byConstraint=new Map(doc.constraints.map(c=>[c.id,c]));
  const next=structuredClone(doc),nextConstraints=new Map(next.constraints.map(c=>[c.id,c]));
  const anchors=new Map(view.anchors.map(a=>[a.pointId,a.position]));
  const changed=new Set();
  const offsets=[];
  for(const edit of command.edits){
    const h=byId.get(edit.holeId);
    const xc=byConstraint.get(h.xConstraintId),yc=byConstraint.get(h.yConstraintId);
    const rc=byConstraint.get(h.radiusConstraintIds[0]);
    if(!xc||xc.kind!=='distanceX'||xc.b!==h.centerPointId||
       xc.a!==h.xReferencePointId||
       !yc||yc.kind!=='distanceY'||yc.b!==h.centerPointId||
       yc.a!==h.yReferencePointId||
       !rc||rc.kind!=='radius'||rc.circle!==h.holeId)
      return refusal(stamp,'authored_constraints_changed',h.holeId);
    const xAnchor=targetByCenter.get(xc.a)||anchors.get(xc.a);
    const yAnchor=targetByCenter.get(yc.a)||anchors.get(yc.a);
    if(!xAnchor||!yAnchor)
      return refusal(stamp,'unresolved_reference',h.holeId);
    const dx=edit.xMm-xAnchor.x,dy=edit.yMm-yAnchor.y;
    if(!finite(dx)||!finite(dy))
      return refusal(stamp,'unrepresentable_dimension',h.holeId);
    if(xc.value!==dx){nextConstraints.get(xc.id).value=dx;changed.add(xc.id);}
    if(yc.value!==dy){nextConstraints.get(yc.id).value=dy;changed.add(yc.id);}
    if(rc.value!==edit.radiusMm){
      nextConstraints.get(rc.id).value=edit.radiusMm;
      next.circles.find(c=>c.id===h.holeId).radius=edit.radiusMm;
      changed.add(rc.id);
    }
    offsets.push({holeId:h.holeId,xConstraintId:xc.id,yConstraintId:yc.id,
      radiusConstraintId:rc.id,xOffsetMm:dx,yOffsetMm:dy});
  }
  if(!changed.size)return refusal(stamp,'no_change');
  let validated,solved;
  try{validated=createSketch(next);solved=solveSketch(validated);}
  catch(error){return refusal(stamp,'edit_rejected',String(error?.message||error));}
  if(solved.status!=='solved'||!solved.geometry)
    return refusal(stamp,'unsolved_after_edit',null,solved.status,solved.diagnostics);
  const nextStamp=serializeSketch(validated);
  const proposed=proposeSelectedPlateProfile(validated,{
    candidateId:view.selection.candidateId,sourceSignature:nextStamp});
  if(proposed.kind!=='selected_analytic_profile')
    return refusal(stamp,'profile_rejected_after_edit',proposed.reason,solved.status);
  let profile;
  try{profile=admitSelectedPlateProfile(validated,proposed);}
  catch(error){return refusal(stamp,'profile_admission_failed',String(error?.message||error));}
  if(profile.semanticProfileId!==view.semanticProfileId ||
     JSON.stringify([...profile.holeIds].sort())!==
       JSON.stringify([...view.profile.holeIds].sort()) ||
     JSON.stringify([...profile.lineIds].sort())!==
       JSON.stringify([...view.profile.lineIds].sort()))
    return refusal(stamp,'selected_profile_identity_changed');
  const actual=new Map(profile.profile.holes.map(h=>[h.id,h]));
  const edits=[];
  for(const edit of command.edits){
    const h=actual.get(edit.holeId),prior=byId.get(edit.holeId);
    if(!h||!near(h.x,edit.xMm)||!near(h.y,edit.yMm)||
       !near(h.radius,edit.radiusMm))
      return refusal(stamp,'explicit_target_not_satisfied',edit.holeId,solved.status);
    edits.push({holeId:edit.holeId,before:{...prior.position,radiusMm:prior.radiusMm},
      after:{x:h.x,y:h.y,radiusMm:h.radius},
      ...offsets.find(o=>o.holeId===edit.holeId)});
  }
  const affectedHoleIds=view.holes.filter(old=>{
    const h=actual.get(old.holeId);
    return !h||!near(old.position.x,h.x)||!near(old.position.y,h.y)||
      !near(old.radiusMm,h.radius);
  }).map(h=>h.holeId).sort();
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:nextStamp,sketch:validated,
    selection:{candidateId:profile.candidateId,sourceSignature:nextStamp},
    profile,semanticProfileId:profile.semanticProfileId,
    changedConstraintIds:[...changed].sort(),edits,affectedHoleIds,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}
