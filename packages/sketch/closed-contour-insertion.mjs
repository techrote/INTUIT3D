/**
 * SKETCH-only structural contour topology v1. Replace one genuinely selected
 * v1-authored edge with a three-segment, two-vertex tab. Retire the old edge
 * identity explicitly; NEVER silently rebind it to a different segment.
 * The resulting sketch remains analytic-only until a separately reviewed
 * RUNTIME structural journal and native provider accept this topology.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile} from './selected-profile.mjs';
import {assessPolygonBoundary,assessSeparatedPolygonBoundaries}
  from './boundary-guard.mjs';
import {inspectClosedContour,MAX_CLOSED_CONTOUR_VERTICES}
  from './closed-contour-authoring.mjs';

export const CLOSED_CONTOUR_INSERTION_VERSION=1;
const flags={previewOnly:true,nativeExact:false,exactBrepAvailable:false,
  independentStepQualified:false};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pt=x=>exact(x,['x','y'])&&finite(x.x)&&finite(x.y);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const validId=x=>typeof x==='string'&&/^[A-Za-z][\w:.-]{0,80}$/.test(x);
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const refuse=(stamp,reason,detail=null,status=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus:status,diagnostics,...flags
});
const original=(id,i)=>({
  point:id+':vertex:'+i,edge:id+':edge:'+i,
  handle:id+':handle:'+i,x:id+':offsetX:'+i,y:id+':offsetY:'+i
});
const inserted=(id,i)=>({
  point:id+':vertex:'+i,handle:id+':handle:'+i,
  x:id+':offsetX:'+i,y:id+':offsetY:'+i
});
const tabEdge=(id,i)=>id+':edge:'+i;
const context=source=>{
  const doc=createSketch(source),stamp=serializeSketch(doc);
  return {doc,stamp,solved:solveSketch(doc),discovery:discoverPlateProfiles(doc)};
};
const sourceRefusal=c=>{
  if(c.solved.status!=='solved'||!c.solved.geometry)
    return refuse(c.stamp,'source_not_fully_solved',null,
      c.solved.status,c.solved.diagnostics);
  if(c.discovery.rejected.length)
    return refuse(c.stamp,'source_has_rejected_contours',
      JSON.stringify(c.discovery.rejected),c.solved.status,c.solved.diagnostics);
  if(!['ready','ambiguous'].includes(c.discovery.status))
    return refuse(c.stamp,'source_profile_not_ready',c.discovery.reason,
      c.solved.status,c.solved.diagnostics);
  return null;
};
const candidateFor=(c,lineIds)=>c.discovery.candidates.find(x=>
  same(x.lineIds,lineIds));
const signedArea=p=>{
  const origin=p[0];let twice=0;
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length];
    twice+=(a.x-origin.x)*(b.y-origin.y)-(a.y-origin.y)*(b.x-origin.x);
  }
  return twice;
};
/** Unmodified independent loops/holes must still exist after every edit. */
const recheck=(before,after,targetBefore,targetLines,movable=new Set())=>{
  if(after.solved.status!=='solved'||!after.solved.geometry)
    return refuse(before.stamp,'proposed_sketch_unsolved',null,
      after.solved.status,after.solved.diagnostics);
  if(after.discovery.rejected.length||
     !['ready','ambiguous'].includes(after.discovery.status))
    return refuse(before.stamp,'proposed_contour_invalid',
      JSON.stringify({status:after.discovery.status,rejected:after.discovery.rejected}),
      after.solved.status,after.solved.diagnostics);
  const target=candidateFor(after,targetLines);
  if(!target)return refuse(before.stamp,'successor_not_discovered',null,
    after.solved.status,after.solved.diagnostics);
  if(!same(target.holeIds,targetBefore.holeIds))
    return refuse(before.stamp,'hole_membership_changed');
  for(const c of before.discovery.candidates){
    if(c.id===targetBefore.candidateId)continue;
    const other=candidateFor(after,c.lineIds);
    if(!other||!same(other.holeIds,c.holeIds))
      return refuse(before.stamp,'other_profile_changed',c.id);
    // Profile discovery validates each connected cycle independently.
    // The edited boundary must also remain strictly separated from every
    // other selected material region, including exact contact and nesting.
    const separation=assessSeparatedPolygonBoundaries(
      target.profile.outer,other.profile.outer);
    if(separation.status!=='separated')
      return refuse(before.stamp,'contour_conflicts_with_other_profile',
        c.id+':'+separation.reason);
  }
  const previous=new Map(before.solved.geometry.points.map(p=>[p.id,p]));
  const next=new Map(after.solved.geometry.points.map(p=>[p.id,p]));
  const moved=id=>{
    const a=previous.get(id),b=next.get(id);
    return !!a&&!!b&&(a.x!==b.x||a.y!==b.y);
  };
  // A circular hole can follow a changed boundary vertex ONLY via unchanged,
  // unique dimensionX/Y constraints with proven source-owned reference chain.
  const allowed=new Set(movable),holes=[];
  const existingCircles=before.doc.circles.filter(c=>
    targetBefore.holeIds.includes(c.id));
  const afterConstraints=new Map(after.doc.constraints.map(c=>[c.id,c]));
  let changed;
  do{
    changed=false;
    for(const circle of existingCircles){
      const id=circle.center;
      if(!moved(id)||allowed.has(id))continue;
      const pairs=['distanceX','distanceY'].map(kind=>
        before.doc.constraints.filter(c=>c.kind===kind&&c.b===id));
      if(pairs.some(p=>p.length!==1))continue;
      const constraints=pairs.flat();
      if(constraints.some(c=>
        JSON.stringify(c)!==JSON.stringify(afterConstraints.get(c.id))||
        !previous.has(c.a)||!next.has(c.a)||
        (moved(c.a)&&!allowed.has(c.a))))continue;
      if(!constraints.some(c=>moved(c.a)&&allowed.has(c.a)))continue;
      allowed.add(id);changed=true;
      holes.push({holeId:circle.id,centerPointId:id,
        from:{x:previous.get(id).x,y:previous.get(id).y},
        to:{x:next.get(id).x,y:next.get(id).y}});
    }
  }while(changed);
  for(const [id,p] of previous){
    const nextPoint=next.get(id);
    if(!nextPoint||(!allowed.has(id)&&
        (nextPoint.x!==p.x||nextPoint.y!==p.y)))
      return refuse(before.stamp,'unselected_geometry_would_move',id);
  }
  const radii=new Map(after.solved.geometry.circles.map(c=>[c.id,c.radius]));
  for(const circle of before.solved.geometry.circles)
    if(radii.get(circle.id)!==circle.radius)
      return refuse(before.stamp,'existing_circle_changed',circle.id);
  const selection={candidateId:target.id,sourceSignature:after.stamp};
  const profile=proposeSelectedPlateProfile(after.doc,selection);
  if(profile.kind!=='selected_analytic_profile')
    return refuse(before.stamp,'successor_profile_refused',profile.reason);
  const oldPoints=targetBefore.boundary.map(e=>e.start);
  const newPoints=profile.boundary.map(e=>e.start);
  if(Math.sign(signedArea(oldPoints))!==Math.sign(signedArea(newPoints)))
    return refuse(before.stamp,'contour_winding_changed');
  return {selection,profile,movedDependentHoles:holes};
};

/** Produce a new, fully constrained six-vertex source from a v1 four-vertex
 * closed contour, without mutating or reindexing any original point. */
export function insertClosedContourTab(source,selection,command){
  const before=context(source),bad=sourceRefusal(before);if(bad)return bad;
  if(!exact(command,['kind','version','sourceSignature','contourId',
    'edgeId','tabId','vertices'])||
     command.kind!=='insert-closed-contour-tab'||command.version!==1||
     !validId(command.contourId)||!validId(command.tabId)||
     command.tabId===command.contourId||typeof command.edgeId!=='string'||
     !Array.isArray(command.vertices)||command.vertices.length!==2||
     !command.vertices.every(pt))
    return refuse(before.stamp,'invalid_insert_command');
  if(command.sourceSignature!==before.stamp)
    return refuse(before.stamp,'stale_source');
  const view=inspectClosedContour(before.doc,selection,command.contourId);
  if(view.kind!=='closed_contour')return view;
  if(view.handles.length+2>MAX_CLOSED_CONTOUR_VERTICES)
    return refuse(before.stamp,'contour_vertex_budget_exceeded');
  const edgeIndex=view.profile.boundary.find(e=>e.edgeId===command.edgeId);
  if(!edgeIndex)return refuse(before.stamp,'edge_not_in_selected_contour');
  const sourceEdge=before.doc.lines.find(e=>e.id===command.edgeId);
  if(!sourceEdge||
     before.doc.constraints.some(c=>c.line===command.edgeId))
    return refuse(before.stamp,'selected_edge_has_external_constraints',
      command.edgeId);
  // A topological tab must change the silhouette. Two points placed exactly
  // on the retired edge are merely a destructive semantic subdivision.
  // Reuse the exact dyadic triangle predicate; no floating epsilon or
  // tolerance-dependent signed cross product.
  const solvedPoints=new Map(before.solved.geometry.points.map(p=>[p.id,p]));
  const edgeStart=solvedPoints.get(sourceEdge.start);
  const edgeEnd=solvedPoints.get(sourceEdge.end);
  if(!command.vertices.some(p=>assessPolygonBoundary(
    [edgeStart,edgeEnd,p]).status==='verified'))
    return refuse(before.stamp,'inserted_vertices_collinear_with_edge',
      sourceEdge.id);
  const newIds=[
    ...[0,1].flatMap(i=>Object.values(inserted(command.tabId,i))),
    ...[0,1,2].map(i=>tabEdge(command.tabId,i))
  ];
  const occupied=new Set([...before.doc.points,...before.doc.lines,
    ...before.doc.circles,...before.doc.constraints].map(e=>e.id));
  if(new Set(newIds).size!==newIds.length||
     newIds.some(id=>id.length>127||occupied.has(id)))
    return refuse(before.stamp,'semantic_id_collision',command.tabId);
  const anchor=before.solved.geometry.points.find(p=>p.id===
    original(command.contourId,0).point);
  const next=structuredClone(before.doc),replacement=[
    {id:tabEdge(command.tabId,0),start:sourceEdge.start,
      end:inserted(command.tabId,0).point},
    {id:tabEdge(command.tabId,1),start:inserted(command.tabId,0).point,
      end:inserted(command.tabId,1).point},
    {id:tabEdge(command.tabId,2),start:inserted(command.tabId,1).point,
      end:sourceEdge.end}
  ];
  const pos=next.lines.findIndex(e=>e.id===sourceEdge.id);
  next.lines.splice(pos,1,...replacement);
  for(let i=0;i<2;i++){
    const p=command.vertices[i],id=inserted(command.tabId,i);
    const dx=p.x-anchor.x,dy=p.y-anchor.y;
    if(!finite(dx)||!finite(dy))
      return refuse(before.stamp,'unrepresentable_dimension',id.point);
    next.points.push({id:id.point,x:p.x,y:p.y});
    next.constraints.push(
      {id:id.x,kind:'distanceX',a:anchor.id,b:id.point,value:dx},
      {id:id.y,kind:'distanceY',a:anchor.id,b:id.point,value:dy}
    );
  }
  let after;try{after=context(next);}catch(e){
    return refuse(before.stamp,'invalid_proposed_sketch',String(e?.message||e));
  }
  const targetLines=view.profile.lineIds.filter(id=>id!==sourceEdge.id)
    .concat(replacement.map(e=>e.id));
  const checked=recheck(before,after,view.profile,targetLines);
  if(checked.kind==='refused')return checked;
  const inspection=inspectTabbedClosedContour(after.doc,checked.selection,
    command.contourId,command.tabId);
  if(inspection.kind!=='tabbed_closed_contour')
    return refuse(before.stamp,'successor_inspection_failed',
      inspection.reason??null);
  return {kind:'accepted',version:1,operation:'insert',
    sourceSignature:before.stamp,nextSourceSignature:after.stamp,
    sketch:after.doc,contourId:command.contourId,tabId:command.tabId,
    previousCandidateId:view.profile.candidateId,
    nextCandidateId:checked.profile.candidateId,
    selection:checked.selection,profile:checked.profile,
    handles:inspection.handles,createdEntityIds:newIds.filter(id=>
      id!==inserted(command.tabId,0).handle&&
      id!==inserted(command.tabId,1).handle),
    retiredEntityIds:[sourceEdge.id],
    preservedPointIds:view.handles.map(h=>h.pointId),
    movedDependentHoles:checked.movedDependentHoles,
    solverStatus:'solved',degreesOfFreedom:after.solved.degreesOfFreedom,
    diagnostics:after.solved.diagnostics,...flags};
}

/** Reconstruct stable handles after archive/replay from *authored* topology.
 * The original four (or more) vertices and their dimensions are never
 * identified by their positions in a newly ordered polygon. */
export function inspectTabbedClosedContour(source,selection,contourId,tabId){
  const c=context(source),bad=sourceRefusal(c);if(bad)return bad;
  if(!validId(contourId)||!validId(tabId))
    return refuse(c.stamp,'invalid_contour_id');
  const selected=proposeSelectedPlateProfile(c.doc,selection);
  if(selected.kind!=='selected_analytic_profile')
    return refuse(c.stamp,selected.reason);
  const points=new Map(c.solved.geometry.points.map(p=>[p.id,p]));
  const lines=new Map(c.doc.lines.map(l=>[l.id,l]));
  const constraints=new Map(c.doc.constraints.map(q=>[q.id,q]));
  const datum=original(contourId,0);
  const fixed=constraints.get(contourId+':anchor');
  if(!fixed||fixed.kind!=='fixed'||fixed.point!==datum.point)
    return refuse(c.stamp,'contour_anchor_missing');
  let n=0;
  for(;n<=MAX_CLOSED_CONTOUR_VERTICES;n++)
    if(!points.has(original(contourId,n).point))break;
  if(n<3||n+2>MAX_CLOSED_CONTOUR_VERTICES)
    return refuse(c.stamp,'contour_vertex_count_invalid');
  const missing=Array.from({length:n},(_,i)=>i).filter(i=>
    !lines.has(original(contourId,i).edge));
  if(missing.length!==1)
    return refuse(c.stamp,'ambiguous_replaced_edge');
  const retired=original(contourId,missing[0]).edge;
  const ordered=[],required=[];
  for(let i=0;i<n;i++){
    const a=original(contourId,i),b=original(contourId,(i+1)%n);
    ordered.push({...a,kind:i?'vertex':'origin'});
    if(i===missing[0]){
      ordered.push({...inserted(tabId,0),kind:'inserted'},
        {...inserted(tabId,1),kind:'inserted'});
      required.push(
        {id:tabEdge(tabId,0),start:a.point,end:inserted(tabId,0).point},
        {id:tabEdge(tabId,1),start:inserted(tabId,0).point,
          end:inserted(tabId,1).point},
        {id:tabEdge(tabId,2),start:inserted(tabId,1).point,end:b.point}
      );
    }else required.push({id:a.edge,start:a.point,end:b.point});
  }
  if(!same(selected.lineIds,required.map(e=>e.id))||
     required.some(e=>!lines.has(e.id)||
       lines.get(e.id).start!==e.start||lines.get(e.id).end!==e.end))
    return refuse(c.stamp,'contour_edge_topology_modified',retired);
  if(c.doc.constraints.some(q=>q.line===retired))
    return refuse(c.stamp,'retired_edge_still_referenced',retired);
  const handles=[];
  for(const h of ordered){
    const solved=points.get(h.point);
    if(!solved)return refuse(c.stamp,'contour_vertex_missing',h.point);
    const list=h.kind==='origin'?[fixed.id]:[h.x,h.y];
    if(h.kind!=='origin'){
      const dx=constraints.get(h.x),dy=constraints.get(h.y);
      if(!dx||!dy||dx.kind!=='distanceX'||dy.kind!=='distanceY'||
         dx.a!==datum.point||dy.a!==datum.point||
         dx.b!==h.point||dy.b!==h.point)
        return refuse(c.stamp,'contour_dimensions_modified',h.point);
    }
    handles.push({handleId:h.handle,pointId:h.point,kind:h.kind,
      position:{x:solved.x,y:solved.y},constraintIds:list});
  }
  return {kind:'tabbed_closed_contour',version:1,sourceSignature:c.stamp,
    contourId,tabId,retiredEdgeId:retired,selection:{...selection},
    profile:selected,handles,vertices:handles.map(h=>h.position),
    solverStatus:'solved',degreesOfFreedom:c.solved.degreesOfFreedom,
    diagnostics:c.solved.diagnostics,...flags};
}

/** Retrospectively dimension/drag any non-datum semantic vertex. Stable IDs,
 * hole references and all other authored geometry are rechecked. */
export function editTabbedContourVertex(source,selection,command){
  const before=context(source),bad=sourceRefusal(before);if(bad)return bad;
  if(!exact(command,['kind','version','sourceSignature','contourId',
    'tabId','handleId','target'])||
    command.kind!=='edit-tabbed-contour-vertex'||command.version!==1||
    !validId(command.contourId)||!validId(command.tabId)||
    typeof command.handleId!=='string'||!pt(command.target))
    return refuse(before.stamp,'invalid_edit_command');
  if(command.sourceSignature!==before.stamp)
    return refuse(before.stamp,'stale_source');
  const view=inspectTabbedClosedContour(before.doc,selection,
    command.contourId,command.tabId);
  if(view.kind!=='tabbed_closed_contour')return view;
  const handle=view.handles.find(h=>h.handleId===command.handleId);
  if(!handle)return refuse(before.stamp,'handle_not_in_selected_contour');
  if(handle.kind==='origin')
    return refuse(before.stamp,'datum_translation_requires_batch_edit');
  const anchor=before.solved.geometry.points.find(p=>p.id===
    original(command.contourId,0).point);
  const next=structuredClone(before.doc),changed=[];
  for(const [axis,index] of [['x',0],['y',1]]){
    const id=handle.constraintIds[index];
    const c=next.constraints.find(q=>q.id===id);
    const val=command.target[axis]-anchor[axis];
    if(!finite(val))return refuse(before.stamp,'unrepresentable_dimension',id);
    if(c.value!==val){c.value=val;changed.push(id);}
  }
  if(!changed.length)return refuse(before.stamp,'no_change');
  let after;try{after=context(next);}catch(e){
    return refuse(before.stamp,'invalid_proposed_sketch',String(e?.message||e));
  }
  const checked=recheck(before,after,view.profile,
    view.profile.lineIds,new Set([handle.pointId]));
  if(checked.kind==='refused')return checked;
  const inspection=inspectTabbedClosedContour(after.doc,checked.selection,
    command.contourId,command.tabId);
  if(inspection.kind!=='tabbed_closed_contour')
    return refuse(before.stamp,'successor_inspection_failed',
      inspection.reason??null);
  return {kind:'accepted',version:1,operation:'edit',
    sourceSignature:before.stamp,nextSourceSignature:after.stamp,
    sketch:after.doc,selection:checked.selection,profile:checked.profile,
    contourId:command.contourId,tabId:command.tabId,
    previousCandidateId:view.profile.candidateId,
    nextCandidateId:checked.profile.candidateId,
    changedConstraintIds:changed,handles:inspection.handles,
    movedDependentHoles:checked.movedDependentHoles,
    solverStatus:'solved',degreesOfFreedom:after.solved.degreesOfFreedom,
    diagnostics:after.solved.diagnostics,...flags};
}
