/**
 * Selected-contour rectangular edge trimming, with real signed dimensional
 * constraints and stable, directly draggable semantic handles.
 *
 * This is intentionally a sharp, orthogonal NOTCH, not an approximation of a
 * rounded slot. The existing obround-slot/v1 owns true tangent-arc loops.
 * Native boolean cuts and STEP authority belong to downstream providers.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';
import {inspectSelectedEdgeHolePlacement} from './selected-edge-hole-placement.mjs';

export const SELECTED_EDGE_NOTCH_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validId=s=>typeof s==='string'&&/^[A-Za-z][\w:.-]{0,100}$/.test(s);
const near=(x,y)=>finite(x)&&finite(y)&&Math.abs(x-y)<=1e-9;
const eq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const suffixes=['p1','p2','p3','p4','in','floor','out','tail',
  'p1:x','p1:y','p2:x','p2:y','p3:x','p3:y','p4:x','p4:y'];
const names=id=>Object.fromEntries(suffixes.map(s=>[s,id+':'+s]));
const refusal=(stamp,reason,detail=null,status=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus:status,diagnostics,previewOnly:true,nativeExact:false
});
const pos=(a,t,n,u,v)=>({
  x:a.x+t.x*u+n.x*v,y:a.y+t.y*u+n.y*v
});
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const difference=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const handle=(id,kind,point)=>({
  id:id+':handle:'+kind,kind,position:{x:point.x,y:point.y}
});
const dimensions=(fromMm,toMm,depthMm,lengthMm)=>
  [fromMm,toMm,depthMm,lengthMm].every(finite)&&
  fromMm>0&&toMm>fromMm&&toMm<lengthMm&&depthMm>0;
const profileAfter=(sketch,original,addedLines)=>{
  const discovery=discoverPlateProfiles(sketch);
  const lineIds=[...original.lineIds,...addedLines];
  const match=discovery.candidates.find(c=>eq(c.lineIds,lineIds));
  if(!match)return {error:'selected_contour_no_longer_admissible',
    detail:{status:discovery.status,rejected:discovery.rejected}};
  const proposal=proposeSelectedPlateProfile(sketch,{
    candidateId:match.id,sourceSignature:serializeSketch(sketch)});
  if(proposal.kind!=='selected_analytic_profile')
    return {error:'selected_contour_rejected',detail:proposal.reason};
  if(!eq(proposal.holeIds,original.holeIds))
    return {error:'selected_hole_membership_changed',detail:{
      before:original.holeIds,after:proposal.holeIds}};
  try{return {profile:admitSelectedPlateProfile(sketch,proposal)};}
  catch(error){return {error:'selected_contour_admission_failed',
    detail:String(error?.message||error)};}
};
const completed=(oldSketch,next,priorProfile,extraLines,stamp)=>{
  let checked,solution;
  try{checked=createSketch(next);solution=solveSketch(checked);}
  catch(error){return refusal(stamp,'invalid_proposed_sketch',
    String(error?.message||error));}
  if(solution.status!=='solved'||!solution.geometry)
    return refusal(stamp,'unsolved_after_edit',null,solution.status,
      solution.diagnostics);
  const result=profileAfter(checked,priorProfile,extraLines);
  if(!result.profile)return refusal(stamp,result.error,
    JSON.stringify(result.detail),solution.status,solution.diagnostics);
  // Existing entities outside the selected contour may not drift as a side
  // effect of rewriting just one edge. Check actual solver geometry, not seeds.
  const before=solveSketch(oldSketch);
  const beforePts=new Map(before.geometry?.points.map(p=>[p.id,p])??[]);
  const afterPts=new Map(solution.geometry.points.map(p=>[p.id,p]));
  const selected=new Set(priorProfile.lineIds);
  const untouched=new Set(oldSketch.lines.filter(l=>!selected.has(l.id))
    .flatMap(l=>[l.start,l.end]));
  for(const c of oldSketch.circles)
    if(!priorProfile.holeIds.includes(c.id))untouched.add(c.center);
  for(const id of untouched){
    const a=beforePts.get(id),b=afterPts.get(id);
    if(!a||!b||!near(a.x,b.x)||!near(a.y,b.y))
      return refusal(stamp,'unselected_geometry_would_change',id,solution.status);
  }
  return {sketch:checked,profile:result.profile,solution};
};

/**
 * Cut a rectangular pocket into one genuinely selected straight boundary edge.
 * The original edge ID remains as the first shortened segment; the other four
 * segments and four vertices have deterministic IDs. Every new vertex is
 * constrained in both axes to the original semantic edge-start point.
 */
export function createSelectedEdgeNotch(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const view=inspectSelectedEdgeHolePlacement(doc,selection);
  if(view.kind!=='selected_edge_hole_placement')
    return refusal(stamp,view.reason,view.detail??null,
      view.sourceStatus??null,view.diagnostics??[]);
  if(!exact(command,['kind','version','sourceSignature','notchId',
    'edgeId','fromMm','toMm','depthMm'])||
     command.kind!=='create-edge-notch'||command.version!==1||
     !validId(command.notchId)||typeof command.edgeId!=='string')
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const edge=view.edges.find(e=>e.edgeId===command.edgeId);
  if(!edge)return refusal(stamp,'edge_not_in_selected_contour',command.edgeId);
  if(!edge.editable)
    return refusal(stamp,'edge_not_axis_constrained',command.edgeId);
  if(!dimensions(command.fromMm,command.toMm,command.depthMm,edge.lengthMm))
    return refusal(stamp,'invalid_notch_dimensions');
  const n=names(command.notchId);
  const occupied=new Set([...doc.points,...doc.lines,...doc.circles,
    ...doc.constraints].map(e=>e.id));
  if(occupied.has(command.notchId)||
      Object.values(n).some(id=>id.length>128||occupied.has(id)))
    return refusal(stamp,'semantic_id_collision',command.notchId);
  const next=structuredClone(doc);
  const p=[
    pos(edge.start,edge.tangent,edge.inward,command.fromMm,0),
    pos(edge.start,edge.tangent,edge.inward,command.fromMm,command.depthMm),
    pos(edge.start,edge.tangent,edge.inward,command.toMm,command.depthMm),
    pos(edge.start,edge.tangent,edge.inward,command.toMm,0)
  ];
  if(p.some(q=>!finite(q.x)||!finite(q.y)))
    return refusal(stamp,'unrepresentable_notch_geometry');
  const ids=[n.p1,n.p2,n.p3,n.p4];
  for(let i=0;i<4;i++)next.points.push({id:ids[i],...p[i]});
  const original=next.lines.find(l=>l.id===edge.edgeId);
  if(!original)return refusal(stamp,'missing_edge');
  if(original.start===edge.startPointId&&original.end===edge.endPointId)
    original.end=n.p1;
  else if(original.end===edge.startPointId&&original.start===edge.endPointId)
    original.start=n.p1;
  else return refusal(stamp,'changed_edge_orientation');
  next.lines.push(
    {id:n.in,start:n.p1,end:n.p2},
    {id:n.floor,start:n.p2,end:n.p3},
    {id:n.out,start:n.p3,end:n.p4},
    {id:n.tail,start:n.p4,end:edge.endPointId}
  );
  ids.forEach((id,i)=>{
    next.constraints.push(
      {id:n['p'+(i+1)+':x'],kind:'distanceX',
        a:edge.startPointId,b:id,value:p[i].x-edge.start.x},
      {id:n['p'+(i+1)+':y'],kind:'distanceY',
        a:edge.startPointId,b:id,value:p[i].y-edge.start.y}
    );
  });
  const outcome=completed(doc,next,view.profile,[n.in,n.floor,n.out,n.tail],stamp);
  if(!outcome.sketch)return outcome;
  const nextSelection={candidateId:outcome.profile.candidateId,
    sourceSignature:serializeSketch(outcome.sketch)};
  const inspection=inspectSelectedEdgeNotch(outcome.sketch,nextSelection,
    command.notchId);
  if(inspection.kind!=='selected_edge_notch')
    return refusal(stamp,'post_edit_inspection_failed',inspection.reason);
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:nextSelection.sourceSignature,
    sketch:outcome.sketch,selection:nextSelection,profile:outcome.profile,
    previousCandidateId:view.selection.candidateId,
    nextCandidateId:outcome.profile.candidateId,
    notchId:command.notchId,originalEdgeId:edge.edgeId,
    createdEntityIds:[...ids,n.in,n.floor,n.out,n.tail],
    changedConstraintIds:ids.flatMap((_,i)=>
      [n['p'+(i+1)+':x'],n['p'+(i+1)+':y']]),
    handles:inspection.handles,previewOnly:true,nativeExact:false,
    exactBrepAvailable:false,independentStepQualified:false};
}

/**
 * Reconstruct the notch from real selected contour and signed dimensions
 * after serialization/reopen, without hidden persisted adapter state.
 */
export function inspectSelectedEdgeNotch(source,selection,notchId){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const reject=(reason,detail=null,status=null,diagnostics=[])=>
    refusal(stamp,reason,detail,status,diagnostics);
  if(!validId(notchId))return reject('invalid_notch_id');
  const proposal=proposeSelectedPlateProfile(doc,selection);
  if(proposal.kind!=='selected_analytic_profile')
    return reject(proposal.reason,null,proposal.sourceStatus??null);
  const n=names(notchId),lines=new Map(doc.lines.map(l=>[l.id,l]));
  const needed=[n.in,n.floor,n.out,n.tail];
  if(needed.some(id=>!proposal.lineIds.includes(id)))
    return reject('notch_not_in_selected_contour');
  const pts=new Map(solveSketch(doc).geometry?.points.map(p=>[p.id,p])??[]);
  const [p1,p2,p3,p4]=[n.p1,n.p2,n.p3,n.p4].map(id=>pts.get(id));
  if([p1,p2,p3,p4].some(v=>!v))return reject('missing_notch_vertices');
  const line=(id,start,end)=>{
    const l=lines.get(id);return l&&l.start===start&&l.end===end;
  };
  if(!line(n.in,n.p1,n.p2)||!line(n.floor,n.p2,n.p3)||
     !line(n.out,n.p3,n.p4))
    return reject('notch_topology_modified');
  const cs=new Map(doc.constraints.map(c=>[c.id,c]));
  const x1=cs.get(n['p1:x']),y1=cs.get(n['p1:y']);
  const anchorId=x1?.a;
  if(!anchorId||y1?.a!==anchorId)
    return reject('notch_reference_modified');
  for(let i=1;i<=4;i++){
    const id=n['p'+i],p=pts.get(id);
    for(const [axis,kind] of [['x','distanceX'],['y','distanceY']]){
      const c=cs.get(n['p'+i+':'+axis]),a=pts.get(anchorId);
      if(!c||c.kind!==kind||c.a!==anchorId||c.b!==id||
         !a||!near(c.value,p[axis]-a[axis]))
        return reject('notch_dimension_modified',id+':'+axis);
    }
  }
  const tail=lines.get(n.tail);
  const orig=doc.lines.filter(l=>proposal.lineIds.includes(l.id)&&
    ((l.start===anchorId&&l.end===n.p1)||
     (l.end===anchorId&&l.start===n.p1)));
  if(!tail||tail.start!==n.p4||orig.length!==1)
    return reject('notch_anchor_topology_modified');
  const endId=tail.end,a=pts.get(anchorId),z=pts.get(endId);
  if(!z||!a||endId===anchorId||!proposal.lineIds.includes(orig[0].id))
    return reject('notch_original_edge_missing');
  const v=difference(z,a),lengthMm=Math.hypot(v.x,v.y);
  if(!finite(lengthMm)||lengthMm<=0||
      !(near(v.x,0)||near(v.y,0)))
    return reject('original_edge_not_orthogonal');
  const t={x:v.x/lengthMm,y:v.y/lengthMm};
  const offset=difference(p2,p1),depthMm=Math.hypot(offset.x,offset.y);
  if(!finite(depthMm)||depthMm<=0)
    return reject('collapsed_notch');
  const inward={x:offset.x/depthMm,y:offset.y/depthMm};
  if(!near(dot(t,inward),0)||
     !near(p1.x,p4.x-t.x*dot(difference(p4,p1),t))&&
       !near(p1.y,p4.y-t.y*dot(difference(p4,p1),t)))
    return reject('notch_not_perpendicular');
  const fromMm=dot(difference(p1,a),t);
  const toMm=dot(difference(p4,a),t);
  if(!dimensions(fromMm,toMm,depthMm,lengthMm)||
     !near(dot(difference(p1,a),inward),0)||
     !near(dot(difference(p4,a),inward),0)||
     !near(dot(difference(p3,p2),inward),0)||
     !near(dot(difference(p3,p2),t),toMm-fromMm)||
     !near(dot(difference(p3,p4),inward),depthMm))
    return reject('notch_geometry_not_rectangular');
  const byId=new Map(proposal.boundary.map(e=>[e.edgeId,e]));
  if(!byId.has(orig[0].id)||needed.some(id=>!byId.has(id)))
    return reject('notch_boundary_missing');
  const handles=[
    handle(notchId,'from',p1),handle(notchId,'to',p4),
    handle(notchId,'depth',{x:(p2.x+p3.x)/2,y:(p2.y+p3.y)/2})
  ];
  return {kind:'selected_edge_notch',version:1,sourceSignature:stamp,
    selection:{...selection},semanticProfileId:proposal.semanticProfileId,
    notchId,originalEdgeId:orig[0].id,originalStartPointId:anchorId,
    originalEndPointId:endId,originalLengthMm:lengthMm,
    fromMm,toMm,depthMm,axis:t,inward,handles,profile:proposal,
    previewOnly:true,nativeExact:false};
}

/** Change all eight authored dimensions in one immutable, revision-fenced edit. */
export function editSelectedEdgeNotch(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','notchId',
    'fromMm','toMm','depthMm'])||command.kind!=='edit-edge-notch'||
    command.version!==1||!validId(command.notchId))
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const current=inspectSelectedEdgeNotch(doc,selection,command.notchId);
  if(current.kind!=='selected_edge_notch')return current;
  if(!dimensions(command.fromMm,command.toMm,command.depthMm,
      current.originalLengthMm))
    return refusal(stamp,'invalid_notch_dimensions');
  if(near(current.fromMm,command.fromMm)&&near(current.toMm,command.toMm)&&
     near(current.depthMm,command.depthMm))
    return refusal(stamp,'no_change');
  const n=names(command.notchId),next=structuredClone(doc);
  const anchor=solveSketch(doc).geometry.points.find(p=>
    p.id===current.originalStartPointId);
  const p=[
    pos(anchor,current.axis,current.inward,command.fromMm,0),
    pos(anchor,current.axis,current.inward,command.fromMm,command.depthMm),
    pos(anchor,current.axis,current.inward,command.toMm,command.depthMm),
    pos(anchor,current.axis,current.inward,command.toMm,0)
  ];
  if(p.some(q=>!finite(q.x)||!finite(q.y)))
    return refusal(stamp,'unrepresentable_notch_geometry');
  const changed=[];
  for(let i=1;i<=4;i++){
    const id=n['p'+i];
    const seed=next.points.find(pt=>pt.id===id);
    seed.x=p[i-1].x;seed.y=p[i-1].y;
    for(const axis of ['x','y']){
      const c=next.constraints.find(c=>c.id===n['p'+i+':'+axis]);
      const value=p[i-1][axis]-anchor[axis];
      if(!near(c.value,value))changed.push(c.id);
      c.value=value;
    }
  }
  const outcome=completed(doc,next,current.profile,[],stamp);
  if(!outcome.sketch)return outcome;
  const nextSelection={candidateId:outcome.profile.candidateId,
    sourceSignature:serializeSketch(outcome.sketch)};
  const inspected=inspectSelectedEdgeNotch(outcome.sketch,nextSelection,
    command.notchId);
  if(inspected.kind!=='selected_edge_notch'||
     !near(inspected.fromMm,command.fromMm)||
     !near(inspected.toMm,command.toMm)||
     !near(inspected.depthMm,command.depthMm))
    return refusal(stamp,'explicit_target_not_satisfied');
  return {kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:nextSelection.sourceSignature,sketch:outcome.sketch,
    selection:nextSelection,profile:outcome.profile,
    previousCandidateId:current.selection.candidateId,
    nextCandidateId:outcome.profile.candidateId,notchId:command.notchId,
    originalEdgeId:current.originalEdgeId,
    createdEntityIds:[],changedConstraintIds:changed.sort(),
    handles:inspected.handles,previewOnly:true,nativeExact:false,
    exactBrepAvailable:false,independentStepQualified:false};
}

/** Pointer coordinates are projected to an authored along/inward dimension. */
export function dragSelectedEdgeNotchHandle(source,selection,gesture){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(gesture,['version','sourceSignature','notchId',
      'handleId','target'])||gesture.version!==1||
     !exact(gesture.target,['x','y'])||
     !finite(gesture.target.x)||!finite(gesture.target.y))
    return refusal(stamp,'invalid_pointer_gesture');
  if(gesture.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const view=inspectSelectedEdgeNotch(doc,selection,gesture.notchId);
  if(view.kind!=='selected_edge_notch')return view;
  const h=view.handles.find(e=>e.id===gesture.handleId);
  if(!h)return refusal(stamp,'unknown_handle',gesture.handleId);
  const start=solveSketch(doc).geometry.points.find(p=>
    p.id===view.originalStartPointId);
  const fromStart=difference(gesture.target,start);
  let fromMm=view.fromMm,toMm=view.toMm,depthMm=view.depthMm;
  if(h.kind==='from')fromMm=dot(fromStart,view.axis);
  else if(h.kind==='to')toMm=dot(fromStart,view.axis);
  else depthMm=dot(fromStart,view.inward);
  const result=editSelectedEdgeNotch(doc,selection,{
    kind:'edit-edge-notch',version:1,sourceSignature:stamp,
    notchId:gesture.notchId,fromMm,toMm,depthMm});
  if(result.kind!=='accepted')return result;
  const applied=result.handles.find(e=>e.id===gesture.handleId).position;
  return {...result,gesture:{
    handleId:h.id,requested:{...gesture.target},applied:{...applied},
    projectionDeviationMm:Math.hypot(applied.x-gesture.target.x,
      applied.y-gesture.target.y)
  }};
}
