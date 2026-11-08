/**
 * Versioned selected-contour edge-local circular-hole authoring.
 *
 * A hole can be dimensioned against a selected, solver-constrained horizontal
 * or vertical boundary edge using along/inward distances. Both dimensions
 * become real signed distanceX/distanceY constraints from the edge's semantic
 * start point. No auxiliary authoring document or persisted edge metadata:
 * inspection reconstructs edge binding from the existing constraints.
 *
 * This is analytic SKETCH intent only; RUNTIME owns an undoable journal event,
 * KERNEL owns physical B-rep/STEP, and WORKBENCH owns pointer projection.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {inspectSelectedProfileHoleLayout} from './selected-profile-hole-layout.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';

export const SELECTED_EDGE_HOLE_PLACEMENT_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validId=id=>typeof id==='string'&&/^[A-Za-z][\w:.-]{0,127}$/.test(id);
const exact=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
const near=(a,b)=>Math.abs(a-b)<=1e-9;
const refuse=(stamp,reason,detail=null,sourceStatus=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus,diagnostics,previewOnly:true,nativeExact:false
});
const identifiers=(holeId)=>({
  center:holeId+':center',x:holeId+':edgeX',
  y:holeId+':edgeY',radius:holeId+':radius'
});

/**
 * Inspect the real solved selected boundary, not a guessed rectangle.
 * Winding determines which side of every directed edge points inward;
 * only edges backed by a genuine horizontal/vertical constraint are editable
 * by this linear (not nonlinear tangent) constraint provider.
 */
export function inspectSelectedEdgeHolePlacement(source,selection){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const layout=inspectSelectedProfileHoleLayout(doc,selection);
  if(layout.kind!=='selected_profile_hole_layout')
    return refuse(stamp,layout.reason,layout.detail??null,
      layout.sourceStatus??null,layout.diagnostics??[]);
  const boundary=layout.profile.boundary;
  const twiceArea=boundary.reduce((a,e)=>
    a+e.start.x*e.end.y-e.end.x*e.start.y,0);
  if(!finite(twiceArea)||twiceArea===0)
    return refuse(stamp,'invalid_boundary_winding');
  const sign=Math.sign(twiceArea);
  const lines=new Map(doc.lines.map(e=>[e.id,e]));
  const edges=boundary.map(e=>{
    const dx=e.end.x-e.start.x,dy=e.end.y-e.start.y;
    const lengthMm=Math.hypot(dx,dy);
    const line=lines.get(e.edgeId);
    const constraints=doc.constraints.filter(c=>
      c.line===e.edgeId&&(c.kind==='horizontal'||c.kind==='vertical'));
    const horizontal=constraints.find(c=>c.kind==='horizontal');
    const vertical=constraints.find(c=>c.kind==='vertical');
    const kind=(horizontal&&Math.abs(dy)<=1e-9&&Math.abs(dx)>1e-9)
      ?'horizontal':(vertical&&Math.abs(dx)<=1e-9&&Math.abs(dy)>1e-9)
        ?'vertical':null;
    const editable=!!line&&!!kind&&finite(lengthMm)&&lengthMm>0;
    const tangent=editable?{
      x:kind==='horizontal'?Math.sign(dx):0,
      y:kind==='vertical'?Math.sign(dy):0
    }:null;
    const inward=tangent?{x:tangent.y===0?0:-sign*tangent.y,
      y:tangent.x===0?0:sign*tangent.x}:null;
    return {edgeId:e.edgeId,startPointId:e.startPointId,
      endPointId:e.endPointId,start:{...e.start},end:{...e.end},
      lengthMm,editable,axis:kind,
      constraintIds:constraints.map(c=>c.id).sort(),tangent,inward};
  });
  const edgeByStart=new Map(edges.filter(e=>e.editable)
    .map(e=>[e.startPointId,e]));
  const holes=layout.holes.map(h=>{
    const bound=h.canEdit&&h.xReferencePointId===h.yReferencePointId
      ?edgeByStart.get(h.xReferencePointId):null;
    let edgeBinding=null;
    if(bound){
      const px=h.position.x-bound.start.x,py=h.position.y-bound.start.y;
      edgeBinding={edgeId:bound.edgeId,anchorPointId:bound.startPointId,
        alongMm:px*bound.tangent.x+py*bound.tangent.y,
        insetMm:px*bound.inward.x+py*bound.inward.y};
    }
    return {holeId:h.holeId,centerPointId:h.centerPointId,
      position:{...h.position},radiusMm:h.radiusMm,
      xConstraintId:h.xConstraintId,yConstraintId:h.yConstraintId,
      radiusConstraintId:h.radiusConstraintId,
      canEdit:h.canEdit,edgeBinding};
  });
  return {kind:'selected_edge_hole_placement',version:1,
    sourceSignature:stamp,selection:layout.selection,
    semanticProfileId:layout.semanticProfileId,edges,holes,
    profile:layout.profile,previewOnly:true,nativeExact:false};
}

/**
 * Create/reposition 1..16 selected holes in one immutable solver transaction.
 * Existing IDs and dimension IDs are retained; newly authored hole IDs are
 * derived once and checked for collisions. The proposed final profile is
 * solved and re-admitted before any replacement sketch is returned.
 */
export function setSelectedEdgeHoles(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const view=inspectSelectedEdgeHolePlacement(doc,selection);
  if(view.kind!=='selected_edge_hole_placement')return view;
  if(!exact(command,['kind','sourceSignature','edits'])||
      command.kind!=='set-edge-holes'||
      typeof command.sourceSignature!=='string'||
      !Array.isArray(command.edits)||command.edits.length<1||
      command.edits.length>16||
      command.edits.some(e=>!exact(e,
        ['holeId','edgeId','alongMm','insetMm','radiusMm'])||
        !validId(e.holeId)||typeof e.edgeId!=='string'||
        !finite(e.alongMm)||!finite(e.insetMm)||
        !finite(e.radiusMm)||e.radiusMm<=0))
    return refuse(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refuse(stamp,'stale_source');

  const edges=new Map(view.edges.map(e=>[e.edgeId,e]));
  const holes=new Map(view.holes.map(h=>[h.holeId,h]));
  const occupied=new Set([...doc.points,...doc.lines,...doc.circles,
    ...doc.constraints].map(e=>e.id));
  const existingCircles=new Set(doc.circles.map(c=>c.id));
  const changed=new Set(),created=[],reanchored=[],targets=[];
  const seen=new Set(),next=structuredClone(doc);
  const byConstraint=new Map(next.constraints.map(c=>[c.id,c]));
  const byCircle=new Map(next.circles.map(c=>[c.id,c]));
  for(const edit of command.edits){
    if(seen.has(edit.holeId))
      return refuse(stamp,'duplicate_hole_id',edit.holeId);
    seen.add(edit.holeId);
    const edge=edges.get(edit.edgeId);
    if(!edge)return refuse(stamp,'edge_not_in_selected_contour',edit.edgeId);
    if(!edge.editable)return refuse(stamp,'edge_not_axis_constrained',edit.edgeId);
    if(edit.alongMm<0||edit.alongMm>edge.lengthMm||edit.insetMm<=0)
      return refuse(stamp,'invalid_edge_local_dimensions',edit.holeId);
    const x=edge.start.x+edge.tangent.x*edit.alongMm+
      edge.inward.x*edit.insetMm;
    const y=edge.start.y+edge.tangent.y*edit.alongMm+
      edge.inward.y*edit.insetMm;
    const dx=x-edge.start.x,dy=y-edge.start.y;
    if(![x,y,dx,dy].every(finite))
      return refuse(stamp,'unrepresentable_dimension',edit.holeId);
    const old=holes.get(edit.holeId);
    if(!old&&occupied.has(edit.holeId))
      return refuse(stamp,'entity_id_collision',edit.holeId);
    if(!old&&existingCircles.has(edit.holeId))
      return refuse(stamp,'hole_not_in_selected_profile',edit.holeId);
    let centerId,xId,yId,rId;
    if(old){
      if(!old.canEdit)
        return refuse(stamp,'hole_not_independently_dimensioned',edit.holeId);
      centerId=old.centerPointId;xId=old.xConstraintId;
      yId=old.yConstraintId;rId=old.radiusConstraintId;
      const xc=byConstraint.get(xId),yc=byConstraint.get(yId),
        rc=byConstraint.get(rId),circle=byCircle.get(edit.holeId);
      if(!xc||xc.kind!=='distanceX'||xc.b!==centerId||
         !yc||yc.kind!=='distanceY'||yc.b!==centerId||
         !rc||rc.kind!=='radius'||rc.circle!==edit.holeId||
         !circle||circle.center!==centerId)
        return refuse(stamp,'authored_constraints_changed',edit.holeId);
      if(xc.a!==edge.startPointId||yc.a!==edge.startPointId)
        reanchored.push(edit.holeId);
      if(xc.a!==edge.startPointId||xc.value!==dx){
        xc.a=edge.startPointId;xc.value=dx;changed.add(xId);
      }
      if(yc.a!==edge.startPointId||yc.value!==dy){
        yc.a=edge.startPointId;yc.value=dy;changed.add(yId);
      }
      if(rc.value!==edit.radiusMm){
        rc.value=edit.radiusMm;circle.radius=edit.radiusMm;
        changed.add(rId);
      }
    }else{
      const names=identifiers(edit.holeId);
      if(Object.values(names).some(id=>!validId(id)||occupied.has(id)))
        return refuse(stamp,'derived_identity_collision',edit.holeId);
      ({center:centerId,x:xId,y:yId,radius:rId}=names);
      next.points.push({id:centerId,x,y});
      next.circles.push({id:edit.holeId,center:centerId,
        radius:edit.radiusMm});
      const constraints=[
        {id:xId,kind:'distanceX',a:edge.startPointId,b:centerId,value:dx},
        {id:yId,kind:'distanceY',a:edge.startPointId,b:centerId,value:dy},
        {id:rId,kind:'radius',circle:edit.holeId,value:edit.radiusMm}
      ];
      next.constraints.push(...constraints);
      for(const id of [edit.holeId,...Object.values(names)])
        occupied.add(id);
      for(const id of [xId,yId,rId])changed.add(id);
      created.push(edit.holeId);
    }
    targets.push({holeId:edit.holeId,edgeId:edge.edgeId,
      anchorPointId:edge.startPointId,alongMm:edit.alongMm,
      insetMm:edit.insetMm,radiusMm:edit.radiusMm,
      xMm:x,yMm:y,xConstraintId:xId,yConstraintId:yId,
      radiusConstraintId:rId});
  }
  if(!changed.size)return refuse(stamp,'no_change');
  let validated,solved;
  try{validated=createSketch(next);solved=solveSketch(validated);}
  catch(error){return refuse(stamp,'edit_rejected',String(error?.message||error));}
  if(solved.status!=='solved'||!solved.geometry)
    return refuse(stamp,'unsolved_after_edit',null,solved.status,solved.diagnostics);

  const nextStamp=serializeSketch(validated);
  const proposed=proposeSelectedPlateProfile(validated,{
    candidateId:view.selection.candidateId,sourceSignature:nextStamp});
  if(proposed.kind!=='selected_analytic_profile')
    return refuse(stamp,'profile_rejected_after_edit',proposed.reason,
      solved.status);
  let profile;
  try{profile=admitSelectedPlateProfile(validated,proposed);}
  catch(error){return refuse(stamp,'profile_admission_failed',
    String(error?.message||error),solved.status);}
  const expected=[...view.profile.holeIds,...created].sort();
  if(profile.semanticProfileId!==view.semanticProfileId||
     JSON.stringify([...profile.holeIds].sort())!==JSON.stringify(expected)||
     JSON.stringify([...profile.lineIds].sort())!==
       JSON.stringify([...view.profile.lineIds].sort()))
    return refuse(stamp,'selected_profile_identity_changed');

  const actual=new Map(profile.profile.holes.map(h=>[h.id,h]));
  for(const t of targets){
    const h=actual.get(t.holeId);
    if(!h||!near(h.x,t.xMm)||!near(h.y,t.yMm)||
       !near(h.radius,t.radiusMm))
      return refuse(stamp,'explicit_target_not_satisfied',t.holeId,
        solved.status);
  }
  // An edge-based edit must not silently alter a hole on another selected
  // contour. Its authored intent is preserved even if such a dependency exists;
  // the caller must resolve this cross-profile effect explicitly.
  const oldSolution=solveSketch(doc);
  const beforePoints=new Map(oldSolution.geometry.points.map(p=>[p.id,p]));
  const afterPoints=new Map(solved.geometry.points.map(p=>[p.id,p]));
  const selectedLines=new Set(view.profile.lineIds);
  const unselectedPoints=new Set(doc.lines.filter(e=>!selectedLines.has(e.id))
    .flatMap(e=>[e.start,e.end]));
  for(const id of unselectedPoints){
    const p=beforePoints.get(id),q=afterPoints.get(id);
    if(!p||!q||!near(p.x,q.x)||!near(p.y,q.y))
      return refuse(stamp,'unselected_boundary_would_change',id,solved.status);
  }
  for(const circle of doc.circles){
    if(view.profile.holeIds.includes(circle.id))continue;
    const p=beforePoints.get(circle.center),q=afterPoints.get(circle.center);
    const before=oldSolution.geometry.circles.find(c=>c.id===circle.id);
    const after=solved.geometry.circles.find(c=>c.id===circle.id);
    if(!p||!q||!before||!after||!near(p.x,q.x)||
       !near(p.y,q.y)||!near(before.radius,after.radius))
      return refuse(stamp,'unselected_hole_would_change',circle.id,
        solved.status);
  }
  const checked=inspectSelectedEdgeHolePlacement(validated,{
    candidateId:view.selection.candidateId,sourceSignature:nextStamp});
  if(checked.kind!=='selected_edge_hole_placement')
    return refuse(stamp,'post_edit_inspection_failed',
      checked.reason??null,checked.sourceStatus??null);
  for(const t of targets){
    const binding=checked.holes.find(h=>h.holeId===t.holeId)?.edgeBinding;
    if(!binding||binding.edgeId!==t.edgeId||
       !near(binding.alongMm,t.alongMm)||!near(binding.insetMm,t.insetMm))
      return refuse(stamp,'edge_binding_not_preserved',t.holeId);
  }
  const affectedHoleIds=view.holes.filter(h=>{
    const after=actual.get(h.holeId);
    return !after||!near(h.position.x,after.x)||
      !near(h.position.y,after.y)||!near(h.radiusMm,after.radius);
  }).map(h=>h.holeId).concat(created).sort();
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:nextStamp,sketch:validated,
    selection:{candidateId:profile.candidateId,sourceSignature:nextStamp},
    semanticProfileId:profile.semanticProfileId,profile,
    changedConstraintIds:[...changed].sort(),
    createdHoleIds:created.sort(),reanchoredHoleIds:reanchored.sort(),
    affectedHoleIds,edits:targets,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}
