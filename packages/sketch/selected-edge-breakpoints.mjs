/**
 * Revision-fenced, constraint-authored subdivision of a genuinely selected,
 * axis-constrained contour edge. A breakpoint remains a semantic, draggable
 * vertex after replay; the outline and all hole memberships remain unchanged.
 * This is analytic SKETCH only; no B-rep, boolean or STEP authority is implied.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';
import {inspectSelectedEdgeHolePlacement} from './selected-edge-hole-placement.mjs';

export const SELECTED_EDGE_BREAKPOINTS_VERSION=1;
export const MAX_SELECTED_EDGE_BREAKPOINTS=8;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validId=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_:.-]{0,98}$/.test(x);
const exact=(x,ks)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===ks.length&&ks.every(k=>Object.hasOwn(x,k));
const eq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-9;
const point=(id,i)=>id+':break'+i;
const segment=(id,i)=>id+':segment'+i;
const dimension=(id,i)=>id+':offset'+i;
const axisId=(id,i)=>id+':axis'+i;
const refusal=(sourceSignature,reason,detail=null,sourceStatus=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature,reason,detail,sourceStatus,
  diagnostics,previewOnly:true,nativeExact:false
});
const offsetsValid=(offsets,length)=>{
  if(!Array.isArray(offsets)||offsets.length<1||
      offsets.length>MAX_SELECTED_EDGE_BREAKPOINTS||!finite(length)||length<=0)
    return false;
  let prior=0;
  for(const offset of offsets){
    if(!finite(offset)||offset<=prior||offset>=length)return false;
    prior=offset;
  }
  return true;
};
const coord=(start,tangent,offset)=>({
  x:start.x+tangent.x*offset,y:start.y+tangent.y*offset
});
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const readSolution=doc=>{
  const s=solveSketch(doc);
  return s.status==='solved'&&s.geometry?s:null;
};
const profileAfter=(doc,before,expectedIds)=>{
  const discovery=discoverPlateProfiles(doc);
  const candidate=discovery.candidates.find(c=>eq(c.lineIds,expectedIds));
  if(!candidate)return {reason:'successor_contour_not_admissible',
    detail:JSON.stringify({status:discovery.status,rejected:discovery.rejected})};
  const p=proposeSelectedPlateProfile(doc,{
    candidateId:candidate.id,sourceSignature:serializeSketch(doc)});
  if(p.kind!=='selected_analytic_profile')
    return {reason:'successor_contour_refused',detail:p.reason};
  if(!eq(p.holeIds,before.holeIds))
    return {reason:'selected_hole_membership_changed',detail:null};
  try{return {profile:admitSelectedPlateProfile(doc,p)};}
  catch(e){return {reason:'successor_admission_failed',detail:String(e?.message||e)};}
};
const finish=(before,next,oldProfile,expectedLines,allowedMoving,stamp)=>{
  let checked,solved;
  try{checked=createSketch(next);solved=solveSketch(checked);}
  catch(e){return refusal(stamp,'invalid_proposed_sketch',String(e?.message||e));}
  if(solved.status!=='solved'||!solved.geometry)
    return refusal(stamp,'unsolved_after_edit',null,solved.status,solved.diagnostics);
  const old=solveSketch(before);
  if(old.status!=='solved'||!old.geometry)
    return refusal(stamp,'source_not_solved',null,old.status,old.diagnostics);
  const output=new Map(solved.geometry.points.map(p=>[p.id,p]));
  for(const p of old.geometry.points){
    if(allowedMoving.has(p.id))continue;
    const q=output.get(p.id);
    if(!q||!near(p.x,q.x)||!near(p.y,q.y))
      return refusal(stamp,'existing_geometry_would_move',p.id,solved.status);
  }
  const admitted=profileAfter(checked,oldProfile,expectedLines);
  if(!admitted.profile)
    return refusal(stamp,admitted.reason,admitted.detail,solved.status,solved.diagnostics);
  return {sketch:checked,profile:admitted.profile,solution:solved};
};
const accepted=(outcome,stamp,previous,splitId,edgeId,created=[],changed=[],handles=[])=>{
  const selection={candidateId:outcome.profile.candidateId,
    sourceSignature:serializeSketch(outcome.sketch)};
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:selection.sourceSignature,sketch:outcome.sketch,
    selection,profile:outcome.profile,previousCandidateId:previous.candidateId,
    nextCandidateId:outcome.profile.candidateId,splitId,originalEdgeId:edgeId,
    createdEntityIds:created,changedConstraintIds:changed,handles,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
};

/** Create 1..8 explicit reference-bound split points on one selected edge. */
export function createSelectedEdgeBreakpoints(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','splitId','edgeId','offsetsMm'])||
      command.kind!=='create-edge-breakpoints'||command.version!==1||
      !validId(command.splitId)||typeof command.edgeId!=='string')
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const view=inspectSelectedEdgeHolePlacement(doc,selection);
  if(view.kind!=='selected_edge_hole_placement')
    return refusal(stamp,view.reason,view.detail??null,view.sourceStatus??null,
      view.diagnostics??[]);
  const edge=view.edges.find(e=>e.edgeId===command.edgeId);
  if(!edge)return refusal(stamp,'edge_not_in_selected_contour',command.edgeId);
  if(!edge.editable)return refusal(stamp,'edge_not_axis_constrained',command.edgeId);
  if(!offsetsValid(command.offsetsMm,edge.lengthMm))
    return refusal(stamp,'invalid_breakpoint_offsets');
  const n=command.offsetsMm.length,id=command.splitId;
  const owned=[];
  for(let i=1;i<=n;i++)owned.push(point(id,i),segment(id,i),
    dimension(id,i),axisId(id,i));
  const occupied=new Set([...doc.points,...doc.lines,...doc.circles,
    ...doc.constraints].map(e=>e.id));
  if(owned.some(x=>x.length>127||occupied.has(x))||occupied.has(id))
    return refusal(stamp,'semantic_id_collision',id);
  const next=structuredClone(doc),original=next.lines.find(l=>l.id===edge.edgeId);
  if(!original)return refusal(stamp,'original_edge_missing');
  const forward=original.start===edge.startPointId&&original.end===edge.endPointId;
  if(!forward&&!(original.end===edge.startPointId&&
      original.start===edge.endPointId))
    return refusal(stamp,'edge_topology_modified');
  const positions=command.offsetsMm.map(v=>coord(edge.start,edge.tangent,v));
  if(positions.some(p=>!finite(p.x)||!finite(p.y)))
    return refusal(stamp,'unrepresentable_breakpoint');
  const reference=[edge.start,...positions,edge.end];
  if(reference.some((p,i)=>i>0&&p.x===reference[i-1].x&&
      p.y===reference[i-1].y))
    return refusal(stamp,'collapsed_breakpoint_segment');
  if(forward)original.end=point(id,1);
  else original.start=point(id,1);
  let prior=point(id,1);
  for(let i=1;i<=n;i++){
    const p=positions[i-1],here=point(id,i);
    next.points.push({id:here,...p});
    const end=i===n?edge.endPointId:point(id,i+1);
    next.lines.push(forward?{id:segment(id,i),start:here,end}:
      {id:segment(id,i),start:end,end:here});
    const kind=edge.axis==='horizontal'?'distanceX':'distanceY';
    const value=kind==='distanceX'?p.x-edge.start.x:p.y-edge.start.y;
    next.constraints.push({id:dimension(id,i),kind,
      a:edge.startPointId,b:here,value});
    next.constraints.push({id:axisId(id,i),kind:edge.axis,
      line:segment(id,i)});
    prior=here;
  }
  const expected=[...view.profile.lineIds,
    ...Array.from({length:n},(_,i)=>segment(id,i+1))];
  const result=finish(doc,next,view.profile,expected,new Set(),stamp);
  if(!result.sketch)return result;
  const token={candidateId:result.profile.candidateId,
    sourceSignature:serializeSketch(result.sketch)};
  const inspection=inspectSelectedEdgeBreakpoints(result.sketch,token,id);
  if(inspection.kind!=='selected_edge_breakpoints')
    return refusal(stamp,'post_create_inspection_failed',inspection.reason);
  return accepted(result,stamp,view.profile,id,edge.edgeId,
    owned,Array.from({length:n},(_,i)=>dimension(id,i+1)),inspection.handles);
}

/** Reconstruct identity and exact dimensions from the saved sketch itself. */
export function inspectSelectedEdgeBreakpoints(source,selection,splitId){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const reject=(reason,detail=null,status=null,ds=[])=>
    refusal(stamp,reason,detail,status,ds);
  if(!validId(splitId))return reject('invalid_split_id');
  const p=proposeSelectedPlateProfile(doc,selection);
  if(p.kind!=='selected_analytic_profile')
    return reject(p.reason,null,p.sourceStatus??null);
  const pts=new Map(solveSketch(doc).geometry?.points.map(q=>[q.id,q])??[]);
  const lines=new Map(doc.lines.map(l=>[l.id,l]));
  const cs=new Map(doc.constraints.map(c=>[c.id,c]));
  let count=0;
  for(let i=1;i<=MAX_SELECTED_EDGE_BREAKPOINTS;i++){
    if(!pts.has(point(splitId,i)))break;
    count++;
  }
  if(!count)return reject('breakpoints_missing');
  if(pts.has(point(splitId,count+1)))
    return reject('breakpoint_count_exceeded');
  const first=cs.get(dimension(splitId,1));
  const anchorId=first?.a;
  if(!anchorId)return reject('breakpoint_anchor_missing');
  const original=p.boundary.find(e=>e.startPointId===anchorId&&
    e.endPointId===point(splitId,1));
  if(!original)return reject('breakpoint_original_edge_missing');
  let prev=point(splitId,1),endId=null;
  for(let i=1;i<=count;i++){
    const edge=p.boundary.find(e=>e.edgeId===segment(splitId,i));
    const dim=cs.get(dimension(splitId,i));
    const axis=cs.get(axisId(splitId,i));
    if(!edge||edge.startPointId!==prev||
        !axis||axis.kind!=='horizontal'&&axis.kind!=='vertical'||
        axis.line!==edge.edgeId||!dim||dim.a!==anchorId||
        dim.b!==point(splitId,i))
      return reject('breakpoint_topology_or_constraint_modified',String(i));
    prev=edge.endPointId;
    if(i===count)endId=prev;
    else if(prev!==point(splitId,i+1))
      return reject('breakpoint_chain_modified',String(i));
  }
  const start=pts.get(anchorId),end=pts.get(endId);
  if(!start||!end)return reject('breakpoint_endpoints_missing');
  const delta=subtract(end,start),lengthMm=Math.hypot(delta.x,delta.y);
  const horizontal=near(delta.y,0)&&!near(delta.x,0);
  const vertical=near(delta.x,0)&&!near(delta.y,0);
  if(!finite(lengthMm)||(!horizontal&&!vertical))
    return reject('breakpoint_reference_not_axis_aligned');
  const axis=horizontal?'horizontal':'vertical';
  const t={x:delta.x/lengthMm,y:delta.y/lengthMm};
  const c0=doc.constraints.find(c=>c.line===original.edgeId&&c.kind===axis);
  if(!c0)return reject('original_edge_axis_constraint_missing');
  const offsets=[];
  for(let i=1;i<=count;i++){
    const dim=cs.get(dimension(splitId,i)),q=pts.get(point(splitId,i));
    if(!dim||dim.kind!==(horizontal?'distanceX':'distanceY')||!q||
       cs.get(axisId(splitId,i))?.kind!==axis||
       !near(dim.value,q[horizontal?'x':'y']-start[horizontal?'x':'y'])||
       !near(dot(subtract(q,start),{x:-t.y,y:t.x}),0))
      return reject('authored_breakpoint_dimension_modified',String(i));
    offsets.push(dot(subtract(q,start),t));
  }
  if(!offsetsValid(offsets,lengthMm))
    return reject('breakpoint_order_or_clearance_invalid');
  return {kind:'selected_edge_breakpoints',version:1,sourceSignature:stamp,
    selection:{...selection},splitId,originalEdgeId:original.edgeId,
    startPointId:anchorId,endPointId:endId,start,end,tangent:t,axis,
    lengthMm,offsetsMm:offsets,
    handles:offsets.map((o,i)=>({id:splitId+':handle'+(i+1),
      kind:'offset',index:i,position:coord(start,t,o)})),
    profile:p,previewOnly:true,nativeExact:false};
}

/** Modify all breakpoint dimensions as one revision-fenced solver transaction. */
export function editSelectedEdgeBreakpoints(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','splitId','offsetsMm'])||
      command.kind!=='edit-edge-breakpoints'||command.version!==1||
      !validId(command.splitId))
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const view=inspectSelectedEdgeBreakpoints(doc,selection,command.splitId);
  if(view.kind!=='selected_edge_breakpoints')return view;
  if(!offsetsValid(command.offsetsMm,view.lengthMm)||
      command.offsetsMm.length!==view.offsetsMm.length)
    return refusal(stamp,'invalid_breakpoint_offsets');
  if(command.offsetsMm.every((v,i)=>near(v,view.offsetsMm[i])))
    return refusal(stamp,'no_change');
  const next=structuredClone(doc),changes=[];
  for(let i=1;i<=command.offsetsMm.length;i++){
    const value=command.offsetsMm[i-1],target=coord(view.start,view.tangent,value);
    if(!finite(target.x)||!finite(target.y))
      return refusal(stamp,'unrepresentable_breakpoint');
    const q=next.points.find(p=>p.id===point(command.splitId,i));
    const c=next.constraints.find(c=>c.id===dimension(command.splitId,i));
    q.x=target.x;q.y=target.y;
    const signed=view.axis==='horizontal'?target.x-view.start.x:
      target.y-view.start.y;
    if(c.value!==signed){c.value=signed;changes.push(c.id);}
  }
  const outcome=finish(doc,next,view.profile,view.profile.lineIds,
    new Set(view.handles.map((_,i)=>point(command.splitId,i+1))),stamp);
  if(!outcome.sketch)return outcome;
  const token={candidateId:outcome.profile.candidateId,
    sourceSignature:serializeSketch(outcome.sketch)};
  const inspected=inspectSelectedEdgeBreakpoints(outcome.sketch,token,
    command.splitId);
  if(inspected.kind!=='selected_edge_breakpoints'||
      inspected.offsetsMm.some((v,i)=>!near(v,command.offsetsMm[i])))
    return refusal(stamp,'explicit_target_not_satisfied');
  return accepted(outcome,stamp,view.profile,command.splitId,
    view.originalEdgeId,[],changes,inspected.handles);
}

/** Pointer motion projects on the original selected boundary, never freehands. */
export function dragSelectedEdgeBreakpoint(source,selection,gesture){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(gesture,['version','sourceSignature','splitId','handleId','target'])||
      gesture.version!==1||!exact(gesture.target,['x','y'])||
      !finite(gesture.target.x)||!finite(gesture.target.y))
    return refusal(stamp,'invalid_pointer_gesture');
  if(gesture.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const v=inspectSelectedEdgeBreakpoints(doc,selection,gesture.splitId);
  if(v.kind!=='selected_edge_breakpoints')return v;
  const h=v.handles.find(x=>x.id===gesture.handleId);
  if(!h)return refusal(stamp,'unknown_handle',gesture.handleId);
  const offsets=[...v.offsetsMm];
  offsets[h.index]=dot(subtract(gesture.target,v.start),v.tangent);
  const changed=editSelectedEdgeBreakpoints(doc,selection,{
    kind:'edit-edge-breakpoints',version:1,sourceSignature:stamp,
    splitId:gesture.splitId,offsetsMm:offsets});
  if(changed.kind!=='accepted')return changed;
  const applied=changed.handles[h.index].position;
  return {...changed,gesture:{handleId:h.id,requested:{...gesture.target},
    applied:{...applied},projectionDeviationMm:Math.hypot(
      applied.x-gesture.target.x,applied.y-gesture.target.y)}};
}

/** Collapse owned split edges, refusing dependent references instead of losing them. */
export function removeSelectedEdgeBreakpoints(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','splitId'])||
      command.kind!=='remove-edge-breakpoints'||command.version!==1||
      !validId(command.splitId))
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const view=inspectSelectedEdgeBreakpoints(doc,selection,command.splitId);
  if(view.kind!=='selected_edge_breakpoints')return view;
  const n=view.offsetsMm.length,id=command.splitId;
  const deletedPoints=new Set(Array.from({length:n},(_,i)=>point(id,i+1)));
  const deletedLines=new Set(Array.from({length:n},(_,i)=>segment(id,i+1)));
  const deletedConstraints=new Set(Array.from({length:n},(_,i)=>
    [dimension(id,i+1),axisId(id,i+1)]).flat());
  for(const c of doc.constraints){
    if(deletedConstraints.has(c.id))continue;
    if([c.point,c.a,c.b].some(v=>deletedPoints.has(v))||
       deletedLines.has(c.line))
      return refusal(stamp,'dependent_constraint_blocks_removal',c.id);
  }
  if(doc.circles.some(c=>deletedPoints.has(c.center))||
      doc.lines.some(l=>!deletedLines.has(l.id)&&
        l.id!==view.originalEdgeId&&
        (deletedPoints.has(l.start)||deletedPoints.has(l.end))))
    return refusal(stamp,'dependent_geometry_blocks_removal');
  const next=structuredClone(doc);
  const line=next.lines.find(l=>l.id===view.originalEdgeId);
  if(line.start===view.startPointId&&line.end===point(id,1))line.end=view.endPointId;
  else if(line.end===view.startPointId&&line.start===point(id,1))
    line.start=view.endPointId;
  else return refusal(stamp,'original_edge_modified');
  next.points=next.points.filter(p=>!deletedPoints.has(p.id));
  next.lines=next.lines.filter(l=>!deletedLines.has(l.id));
  next.constraints=next.constraints.filter(c=>!deletedConstraints.has(c.id));
  const expected=view.profile.lineIds.filter(l=>!deletedLines.has(l));
  const outcome=finish(doc,next,view.profile,expected,deletedPoints,stamp);
  if(!outcome.sketch)return outcome;
  return accepted(outcome,stamp,view.profile,id,view.originalEdgeId,[],[],[]);
}
