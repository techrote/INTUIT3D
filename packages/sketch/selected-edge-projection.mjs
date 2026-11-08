/**
 * Associative, perpendicular projection of solved edge datums onto a second
 * selected axis-constrained contour edge. Target points are genuine boundary
 * vertices, tied to source breakpoints with authored zero signed-distance
 * constraints. No hidden metadata, polygonal approximation, or native claims.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';
import {inspectSelectedEdgeHolePlacement} from './selected-edge-hole-placement.mjs';
import {inspectSelectedEdgeBreakpoints,MAX_SELECTED_EDGE_BREAKPOINTS}
  from './selected-edge-breakpoints.mjs';

export const SELECTED_EDGE_PROJECTION_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const idOK=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_:.-]{0,88}$/.test(id);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-8;
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const at=(a,t,d)=>({x:a.x+t.x*d,y:a.y+t.y*d});
const pt=(id,i)=>id+':point'+i;
const seg=(id,i)=>id+':segment'+i;
const axis=(id,i)=>id+':axis'+i;
const link=(id,i)=>id+':align'+i;
const sourcePoint=(id,i)=>id+':break'+i;
const sourceDimension=(id,i)=>id+':offset'+i;
const reject=(s,reason,detail=null,status=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:s,reason,detail,
  sourceStatus:status,diagnostics,previewOnly:true,nativeExact:false
});
const equalSet=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const clearance=1e-7;

function projectOnEdge(start,tangent,position,length){
  const offset=dot(sub(position,start),tangent);
  return finite(offset)&&offset>clearance&&offset<length-clearance
    ?offset:null;
}
function selectionFor(sketch,profile){
  return {candidateId:profile.candidateId,sourceSignature:serializeSketch(sketch)};
}
function admission(before,proposed,previous,expected,allowed,stamp){
  let sketch,solution;
  try{sketch=createSketch(proposed);solution=solveSketch(sketch);}
  catch(e){return reject(stamp,'invalid_proposed_sketch',String(e?.message||e));}
  if(solution.status!=='solved'||!solution.geometry)
    return reject(stamp,'unsolved_after_edit',null,solution.status,solution.diagnostics);
  const base=solveSketch(before);
  if(base.status!=='solved'||!base.geometry)
    return reject(stamp,'source_not_solved',null,base.status,base.diagnostics);
  const after=new Map(solution.geometry.points.map(p=>[p.id,p]));
  for(const p of base.geometry.points){
    if(allowed.has(p.id))continue;
    const q=after.get(p.id);
    if(!q||!near(p.x,q.x)||!near(p.y,q.y))
      return reject(stamp,'existing_geometry_would_move',p.id,solution.status);
  }
  const discovery=discoverPlateProfiles(sketch);
  const candidate=discovery.candidates.find(c=>equalSet(c.lineIds,expected));
  if(!candidate)
    return reject(stamp,'successor_contour_not_admissible',
      JSON.stringify({status:discovery.status,rejected:discovery.rejected}),
      solution.status,solution.diagnostics);
  const selection={candidateId:candidate.id,sourceSignature:serializeSketch(sketch)};
  const proposal=proposeSelectedPlateProfile(sketch,selection);
  if(proposal.kind!=='selected_analytic_profile')
    return reject(stamp,'successor_selection_refused',proposal.reason,solution.status);
  if(!equalSet(proposal.holeIds,previous.holeIds))
    return reject(stamp,'hole_membership_changed',null,solution.status);
  if(!near(proposal.profile.areaMm2,previous.profile.areaMm2))
    return reject(stamp,'profile_area_changed',null,solution.status);
  try{
    const profile=admitSelectedPlateProfile(sketch,proposal);
    return {sketch,selection,profile,solution};
  }catch(e){return reject(stamp,'profile_admission_failed',
    String(e?.message||e),solution.status);}
}
function accepted(out,stamp,prior,projectionId,sourceSplitId,targetEdgeId,ids=[],changed=[],handles=[]){
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:out.selection.sourceSignature,sketch:out.sketch,
    selection:out.selection,profile:out.profile,
    previousCandidateId:prior.candidateId,nextCandidateId:out.profile.candidateId,
    projectionId,sourceSplitId,targetEdgeId,
    createdEntityIds:ids,changedConstraintIds:changed,handles,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}

/** Project every existing dimensioned source breakpoint onto a parallel selected edge. */
export function createSelectedEdgeProjection(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','projectionId',
      'sourceSplitId','targetEdgeId'])||
      command.kind!=='create-edge-projection'||command.version!==1||
      !idOK(command.projectionId)||!idOK(command.sourceSplitId)||
      typeof command.targetEdgeId!=='string')
    return reject(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return reject(stamp,'stale_source');
  const src=inspectSelectedEdgeBreakpoints(doc,selection,command.sourceSplitId);
  if(src.kind!=='selected_edge_breakpoints')return src;
  const edges=inspectSelectedEdgeHolePlacement(doc,selection);
  if(edges.kind!=='selected_edge_hole_placement')return edges;
  const dst=edges.edges.find(e=>e.edgeId===command.targetEdgeId);
  if(!dst)return reject(stamp,'target_not_in_selected_contour');
  if(!dst.editable||dst.axis!==src.axis)
    return reject(stamp,'target_not_parallel_axis_constrained');
  if(dst.edgeId===src.originalEdgeId||
      dst.edgeId.startsWith(command.sourceSplitId+':segment'))
    return reject(stamp,'source_and_target_same_edge');
  if(src.axis==='horizontal'?near(dst.start.y,src.start.y):
      near(dst.start.x,src.start.x))
    return reject(stamp,'coincident_projection_edges');
  const sorted=src.handles.map((h,i)=>({
    sourceIndex:i+1,offset:projectOnEdge(dst.start,dst.tangent,h.position,dst.lengthMm)
  })).sort((a,b)=>a.offset-b.offset);
  if(sorted.some(e=>e.offset===null)||
      sorted.some((e,i)=>i>0&&e.offset-sorted[i-1].offset<=clearance))
    return reject(stamp,'projection_outside_target_or_collapsed');
  const id=command.projectionId,n=sorted.length;
  const names=Array.from({length:n},(_,i)=>i+1).flatMap(i=>
    [pt(id,i),seg(id,i),axis(id,i),link(id,i)]);
  const occupied=new Set([...doc.points,...doc.lines,...doc.circles,
    ...doc.constraints].map(e=>e.id));
  if(occupied.has(id)||names.some(name=>name.length>127||occupied.has(name)))
    return reject(stamp,'semantic_id_collision');
  const next=structuredClone(doc),original=next.lines.find(l=>l.id===dst.edgeId);
  if(!original)return reject(stamp,'target_edge_missing');
  const forward=original.start===dst.startPointId&&original.end===dst.endPointId;
  if(!forward&&!(original.end===dst.startPointId&&original.start===dst.endPointId))
    return reject(stamp,'target_topology_modified');
  if(forward)original.end=pt(id,1);else original.start=pt(id,1);
  const kind=src.axis==='horizontal'?'distanceX':'distanceY';
  for(let i=1;i<=n;i++){
    const here=pt(id,i),end=i===n?dst.endPointId:pt(id,i+1);
    const position=at(dst.start,dst.tangent,sorted[i-1].offset);
    next.points.push({id:here,...position});
    next.lines.push(forward?{id:seg(id,i),start:here,end}:
      {id:seg(id,i),start:end,end:here});
    next.constraints.push({id:axis(id,i),kind:src.axis,line:seg(id,i)});
    next.constraints.push({id:link(id,i),kind,
      a:sourcePoint(command.sourceSplitId,sorted[i-1].sourceIndex),
      b:here,value:0});
  }
  const outcome=admission(doc,next,src.profile,
    [...src.profile.lineIds,...Array.from({length:n},(_,i)=>seg(id,i+1))],
    new Set(),stamp);
  if(!outcome.sketch)return outcome;
  const inspected=inspectSelectedEdgeProjection(outcome.sketch,
    outcome.selection,id,command.sourceSplitId);
  if(inspected.kind!=='selected_edge_projection')
    return reject(stamp,'post_create_inspection_failed',inspected.reason);
  return accepted(outcome,stamp,src.profile,id,command.sourceSplitId,
    dst.edgeId,names,Array.from({length:n},(_,i)=>link(id,i+1)),
    inspected.handles);
}

/** Reconstruct every cross-edge association from saved dimensional constraints. */
export function inspectSelectedEdgeProjection(source,selection,projectionId,sourceSplitId){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!idOK(projectionId)||!idOK(sourceSplitId))
    return reject(stamp,'invalid_projection_identity');
  const src=inspectSelectedEdgeBreakpoints(doc,selection,sourceSplitId);
  if(src.kind!=='selected_edge_breakpoints')return src;
  const p=src.profile,n=src.offsetsMm.length;
  if(n<1||n>MAX_SELECTED_EDGE_BREAKPOINTS)
    return reject(stamp,'invalid_source_breakpoints');
  const original=p.boundary.find(e=>e.endPointId===pt(projectionId,1)&&
    !e.edgeId.startsWith(projectionId+':segment'));
  if(!original)return reject(stamp,'projection_original_edge_missing');
  const c=new Map(doc.constraints.map(x=>[x.id,x]));
  const points=new Map(solveSketch(doc).geometry?.points.map(x=>[x.id,x])??[]);
  const start=points.get(original.startPointId);
  const chain=[],links=[],seen=new Set();
  let from=pt(projectionId,1);
  for(let i=1;i<=n;i++){
    const e=p.boundary.find(x=>x.edgeId===seg(projectionId,i));
    const a=c.get(axis(projectionId,i)),l=c.get(link(projectionId,i));
    if(!e||e.startPointId!==from||
        !a||a.kind!==src.axis||a.line!==e.edgeId||
        !l||l.kind!==(src.axis==='horizontal'?'distanceX':'distanceY')||
        l.b!==from||!near(l.value,0)||
        !/^.*:break[1-8]$/.test(l.a))
      return reject(stamp,'projection_topology_or_constraints_modified',String(i));
    const suffix=l.a.slice(sourceSplitId.length+6);
    const sourceIndex=Number(suffix);
    if(l.a!==sourcePoint(sourceSplitId,sourceIndex)||
        !Number.isInteger(sourceIndex)||sourceIndex<1||sourceIndex>n||
        seen.has(sourceIndex))
      return reject(stamp,'projection_reference_modified',String(i));
    seen.add(sourceIndex);
    const q=points.get(from),s=points.get(l.a);
    if(!q||!s||!near(q[src.axis==='horizontal'?'x':'y'],
      s[src.axis==='horizontal'?'x':'y']))
      return reject(stamp,'projection_not_aligned',String(i));
    chain.push({targetPointId:from,sourcePointId:l.a,sourceIndex,position:{x:q.x,y:q.y}});
    links.push(l.id);
    from=e.endPointId;
  }
  if(points.has(pt(projectionId,n+1))||seen.size!==n)
    return reject(stamp,'projection_count_mismatch');
  const end=points.get(from);
  if(!start||!end)return reject(stamp,'projection_endpoints_missing');
  const delta=sub(end,start),lengthMm=Math.hypot(delta.x,delta.y);
  if(!finite(lengthMm)||lengthMm<=0||
      (src.axis==='horizontal'?!near(delta.y,0):!near(delta.x,0)))
    return reject(stamp,'projection_target_not_axis_aligned');
  const tangent={x:delta.x/lengthMm,y:delta.y/lengthMm};
  const constraints=doc.constraints.filter(x=>x.line===original.edgeId);
  if(!constraints.some(x=>x.kind===src.axis))
    return reject(stamp,'projection_original_axis_constraint_missing');
  const offsets=chain.map(e=>dot(sub(e.position,start),tangent));
  if(offsets.some(o=>o<=clearance||o>=lengthMm-clearance)||
      offsets.some((o,i)=>i>0&&o-offsets[i-1]<=clearance))
    return reject(stamp,'projection_outside_target_or_collapsed');
  if(src.axis==='horizontal'?near(start.y,src.start.y):
      near(start.x,src.start.x))
    return reject(stamp,'coincident_projection_edges');
  return {kind:'selected_edge_projection',version:1,sourceSignature:stamp,
    selection:{...selection},projectionId,sourceSplitId,
    targetEdgeId:original.edgeId,targetStartPointId:original.startPointId,
    targetEndPointId:from,targetStart:{x:start.x,y:start.y},
    targetEnd:{x:end.x,y:end.y},targetTangent:tangent,lengthMm,
    sourceOffsetsMm:[...src.offsetsMm],targetOffsetsMm:offsets,
    associations:chain,handles:chain.map(e=>({
      id:projectionId+':handle'+e.sourceIndex,kind:'projected_offset',
      sourcePointId:e.sourcePointId,targetPointId:e.targetPointId,
      position:e.position})),profile:p,previewOnly:true,nativeExact:false};
}

/** Edit source driving dimensions and linked target positions in one solved transaction. */
export function editSelectedEdgeProjection(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','projectionId',
      'sourceSplitId','sourceOffsetsMm'])||
      command.kind!=='edit-edge-projection'||command.version!==1||
      !idOK(command.projectionId)||!idOK(command.sourceSplitId))
    return reject(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return reject(stamp,'stale_source');
  const view=inspectSelectedEdgeProjection(doc,selection,
    command.projectionId,command.sourceSplitId);
  if(view.kind!=='selected_edge_projection')return view;
  const src=inspectSelectedEdgeBreakpoints(doc,selection,command.sourceSplitId);
  if(!Array.isArray(command.sourceOffsetsMm)||
      command.sourceOffsetsMm.length!==src.offsetsMm.length||
      command.sourceOffsetsMm.some((o,i)=>!finite(o)||o<=clearance||
        o>=src.lengthMm-clearance||
        (i>0&&o-command.sourceOffsetsMm[i-1]<=clearance)))
    return reject(stamp,'invalid_source_offsets');
  if(command.sourceOffsetsMm.every((o,i)=>near(o,src.offsetsMm[i])))
    return reject(stamp,'no_change');
  const next=structuredClone(doc),updated=new Set();
  for(let i=1;i<=src.offsetsMm.length;i++){
    const pos=at(src.start,src.tangent,command.sourceOffsetsMm[i-1]);
    const q=next.points.find(p=>p.id===sourcePoint(command.sourceSplitId,i));
    const d=next.constraints.find(c=>c.id===sourceDimension(command.sourceSplitId,i));
    if(!q||!d||d.a!==src.startPointId||d.b!==q.id||
        d.kind!==(src.axis==='horizontal'?'distanceX':'distanceY'))
      return reject(stamp,'source_dimension_modified',String(i));
    q.x=pos.x;q.y=pos.y;
    d.value=src.axis==='horizontal'?pos.x-src.start.x:pos.y-src.start.y;
    updated.add(d.id);
  }
  const targets=[];
  for(const a of view.associations){
    const srcPos=at(src.start,src.tangent,
      command.sourceOffsetsMm[a.sourceIndex-1]);
    const o=projectOnEdge(view.targetStart,view.targetTangent,
      srcPos,view.lengthMm);
    if(o===null)return reject(stamp,'projection_outside_target_or_collapsed');
    targets.push({a,o});
  }
  if(targets.some((entry,i)=>i>0&&entry.o-targets[i-1].o<=clearance))
    return reject(stamp,'projection_order_would_change');
  for(const {a,o} of targets){
    const q=next.points.find(p=>p.id===a.targetPointId);
    if(!q)return reject(stamp,'projection_target_missing');
    const pos=at(view.targetStart,view.targetTangent,o);
    q.x=pos.x;q.y=pos.y;
  }
  const allowed=new Set([
    ...src.handles.map((_,i)=>sourcePoint(command.sourceSplitId,i+1)),
    ...view.associations.map(a=>a.targetPointId)
  ]);
  const out=admission(doc,next,view.profile,view.profile.lineIds,allowed,stamp);
  if(!out.sketch)return out;
  const inspected=inspectSelectedEdgeProjection(out.sketch,out.selection,
    command.projectionId,command.sourceSplitId);
  if(inspected.kind!=='selected_edge_projection'||
      inspected.sourceOffsetsMm.some((o,i)=>!near(o,command.sourceOffsetsMm[i])))
    return reject(stamp,'explicit_targets_not_satisfied',
      inspected.reason??null);
  return accepted(out,stamp,view.profile,command.projectionId,
    command.sourceSplitId,view.targetEdgeId,[],[...updated],inspected.handles);
}

/** A pointer drags a projected vertex along its edge, not an unconstrained XY point. */
export function dragSelectedEdgeProjection(source,selection,gesture){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(gesture,['version','sourceSignature','projectionId',
      'sourceSplitId','handleId','target'])||
      gesture.version!==1||!exact(gesture.target,['x','y'])||
      !finite(gesture.target.x)||!finite(gesture.target.y))
    return reject(stamp,'invalid_pointer_gesture');
  if(gesture.sourceSignature!==stamp)return reject(stamp,'stale_source');
  const view=inspectSelectedEdgeProjection(doc,selection,
    gesture.projectionId,gesture.sourceSplitId);
  if(view.kind!=='selected_edge_projection')return view;
  const h=view.handles.find(x=>x.id===gesture.handleId);
  if(!h)return reject(stamp,'unknown_handle',gesture.handleId);
  const src=inspectSelectedEdgeBreakpoints(doc,selection,gesture.sourceSplitId);
  const requestedOffset=dot(sub(gesture.target,src.start),src.tangent);
  const next=[...view.sourceOffsetsMm];
  const ix=Number(h.id.slice((gesture.projectionId+':handle').length))-1;
  next[ix]=requestedOffset;
  const changed=editSelectedEdgeProjection(doc,selection,{
    kind:'edit-edge-projection',version:1,sourceSignature:stamp,
    projectionId:gesture.projectionId,sourceSplitId:gesture.sourceSplitId,
    sourceOffsetsMm:next});
  if(changed.kind!=='accepted')return changed;
  const applied=changed.handles.find(x=>x.id===h.id).position;
  return {...changed,gesture:{handleId:h.id,requested:{...gesture.target},
    applied:{...applied},projectionDeviationMm:Math.hypot(
      applied.x-gesture.target.x,applied.y-gesture.target.y)}};
}

/** Remove only the projected subedge chain; preserve driving source datums. */
export function removeSelectedEdgeProjection(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','projectionId',
      'sourceSplitId'])||command.kind!=='remove-edge-projection'||
      command.version!==1||!idOK(command.projectionId)||
      !idOK(command.sourceSplitId))
    return reject(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return reject(stamp,'stale_source');
  const view=inspectSelectedEdgeProjection(doc,selection,
    command.projectionId,command.sourceSplitId);
  if(view.kind!=='selected_edge_projection')return view;
  const n=view.associations.length,id=command.projectionId;
  const points=new Set(Array.from({length:n},(_,i)=>pt(id,i+1)));
  const lines=new Set(Array.from({length:n},(_,i)=>seg(id,i+1)));
  const constraints=new Set(Array.from({length:n},(_,i)=>
    [axis(id,i+1),link(id,i+1)]).flat());
  for(const c of doc.constraints){
    if(constraints.has(c.id))continue;
    if([c.a,c.b,c.point].some(x=>points.has(x))||lines.has(c.line))
      return reject(stamp,'dependent_constraint_blocks_removal',c.id);
  }
  if(doc.circles.some(c=>points.has(c.center))||
      doc.lines.some(l=>!lines.has(l.id)&&l.id!==view.targetEdgeId&&
        (points.has(l.start)||points.has(l.end))))
    return reject(stamp,'dependent_geometry_blocks_removal');
  const next=structuredClone(doc),line=next.lines.find(l=>l.id===view.targetEdgeId);
  if(line.start===view.targetStartPointId&&line.end===pt(id,1))
    line.end=view.targetEndPointId;
  else if(line.end===view.targetStartPointId&&line.start===pt(id,1))
    line.start=view.targetEndPointId;
  else return reject(stamp,'target_topology_modified');
  next.points=next.points.filter(p=>!points.has(p.id));
  next.lines=next.lines.filter(l=>!lines.has(l.id));
  next.constraints=next.constraints.filter(c=>!constraints.has(c.id));
  const outcome=admission(doc,next,view.profile,
    view.profile.lineIds.filter(x=>!lines.has(x)),points,stamp);
  if(!outcome.sketch)return outcome;
  return accepted(outcome,stamp,view.profile,id,command.sourceSplitId,
    view.targetEdgeId,[],[],[]);
}
