/**
 * Selected straight-edge round-ended slot: a genuine tangent semicircular
 * inset in an explicitly selected, solver-validated polygon contour.
 *
 * The versioned authoring envelope retains the ORIGINAL linear SketchDocument
 * and its exact constraints. A nonlinear ArcSketch is compiled from that source
 * for analytic profile admission; it is never silently substituted for the
 * source or represented as native-exact geometry.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {inspectSelectedEdgeHolePlacement} from './selected-edge-hole-placement.mjs';
import {createArcSketch,serializeArcSketch,solveArcSketch} from './arc-constraints.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';

export const SELECTED_EDGE_ROUND_SLOT_VERSION=1;
export const SELECTED_EDGE_ROUND_SLOT_FORMAT='intuit3d.selected-edge-round-slot';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-7;
const validId=id=>typeof id==='string'&&/^[A-Za-z][\w:.-]{0,60}$/.test(id);
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const refusal=(signature,reason,detail=null,sourceStatus=null,diagnostics=[])=>({
  kind:'refused',format:SELECTED_EDGE_ROUND_SLOT_FORMAT,version:1,
  sourceSignature:signature,reason,detail,sourceStatus,diagnostics,
  previewOnly:true,nativeExact:false
});
const name=(id,s)=>id+':'+s;
const offset=(p,t,n,u,v)=>({x:p.x+t.x*u+n.x*v,y:p.y+t.y*u+n.y*v});
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const dims=(from,to,depth,length)=>
  [from,to,depth,length].every(finite)&&from>0&&to>from&&
  to<length&&depth>0&&finite((to-from)/2)&&to-from>1e-6;
const specKeys=['id','edgeId','fromMm','toMm','straightDepthMm'];
const names=id=>({
  p1:name(id,'p1'),p2:name(id,'p2'),p3:name(id,'p3'),
  p4:name(id,'p4'),center:name(id,'cap-center'),
  in:name(id,'wall-in'),cap:name(id,'cap'),out:name(id,'wall-out'),
  tail:name(id,'tail'),tailAxis:name(id,'tail-axis'),
  radius:name(id,'cap-radius'),tangentIn:name(id,'tangent-in'),
  tangentOut:name(id,'tangent-out')
});
const grip=(id,kind,p)=>({
  id:name(id,'handle-'+kind),kind,position:{x:p.x,y:p.y}
});
const authorStamp=source=>JSON.stringify(source);

/**
 * A compiled arc sketch preserves ALL source point, line and constraint IDs
 * except for radius/equalRadius, whose *truth* remains in the authoritative
 * linear source and is encoded as fixed ArcCircle radii. Midpoint is refused
 * rather than silently deleted: nonlinear v1 has no midpoint equation.
 */
function compile(source,selection,slot){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const view=inspectSelectedEdgeHolePlacement(doc,selection);
  if(view.kind!=='selected_edge_hole_placement')
    return refusal(stamp,view.reason,view.detail??null,
      view.sourceStatus??null,view.diagnostics??[]);
  if(!exact(slot,specKeys)||!validId(slot.id)||
     typeof slot.edgeId!=='string')
    return refusal(stamp,'invalid_slot_specification');
  const edge=view.edges.find(e=>e.edgeId===slot.edgeId);
  if(!edge)return refusal(stamp,'edge_not_in_selected_contour',slot.edgeId);
  if(!edge.editable)return refusal(stamp,'edge_not_axis_constrained',slot.edgeId);
  const {fromMm:from,toMm:to,straightDepthMm:depth}=slot;
  if(!dims(from,to,depth,edge.lengthMm))
    return refusal(stamp,'invalid_slot_dimensions');
  const linear=solveSketch(doc);
  if(linear.status!=='solved'||!linear.geometry)
    return refusal(stamp,'source_not_solved',null,linear.status,linear.diagnostics);
  const n=names(slot.id),r=(to-from)/2,mid=(from+to)/2;
  const a=edge.start,t=edge.tangent,v=edge.inward;
  const points=[
    offset(a,t,v,from,0),offset(a,t,v,from,depth),
    offset(a,t,v,to,depth),offset(a,t,v,to,0),
    offset(a,t,v,mid,depth)
  ];
  if(points.some(p=>!finite(p.x)||!finite(p.y))||!finite(r)||r<=0)
    return refusal(stamp,'unrepresentable_slot_geometry');
  const generated=[...Object.values(n),...[1,2,3,4].flatMap(i=>
    [name(slot.id,'p'+i+'-x'),name(slot.id,'p'+i+'-y')]),
    name(slot.id,'center-x'),name(slot.id,'center-y')];
  const occupied=new Set([...doc.points,...doc.lines,...doc.circles,
    ...doc.constraints].map(e=>e.id));
  if(generated.some(id=>id.length>127||occupied.has(id))||
     new Set(generated).size!==generated.length||occupied.has(slot.id))
    return refusal(stamp,'semantic_id_collision',slot.id);
  if(doc.constraints.some(c=>c.kind==='midpoint'))
    return refusal(stamp,'unsupported_source_midpoint_constraint');
  const solvedRadii=new Map(linear.geometry.circles.map(c=>[c.id,c.radius]));
  for(const c of doc.constraints){
    if(c.kind==='radius'){
      const radius=solvedRadii.get(c.circle);
      if(radius===undefined||!near(radius,c.value))
        return refusal(stamp,'source_circle_radius_not_preserved',c.id);
    }else if(c.kind==='equalRadius'){
      const x=solvedRadii.get(c.a),y=solvedRadii.get(c.b);
      if(x===undefined||y===undefined||!near(x,y))
        return refusal(stamp,'source_equal_radius_not_preserved',c.id);
    }
  }
  const solvedPoints=new Map(linear.geometry.points.map(p=>[p.id,p]));
  const arcDoc={
    format:'intuit3d.arc-sketch',version:1,units:'mm',
    points:[...doc.points.map(p=>({...solvedPoints.get(p.id)})),
      ...[n.p1,n.p2,n.p3,n.p4,n.center].map((id,i)=>({id,...points[i]}))],
    lines:structuredClone(doc.lines),arcs:[],
    circles:doc.circles.map(c=>({id:c.id,center:c.center,radiusMm:solvedRadii.get(c.id)})),
    constraints:doc.constraints.filter(c=>!['radius','equalRadius'].includes(c.kind))
      .map(c=>structuredClone(c))
  };
  // Normalize ONLY compiled selected boundary orientation. The original
  // sketch (and its authored directed edges) is never rewritten.
  const byId=new Map(arcDoc.lines.map(l=>[l.id,l]));
  for(const boundary of view.profile.boundary){
    const line=byId.get(boundary.edgeId);
    if(!line)return refusal(stamp,'missing_selected_boundary',boundary.edgeId);
    line.start=boundary.startPointId;line.end=boundary.endPointId;
  }
  const original=byId.get(slot.edgeId);
  if(!original||original.start!==edge.startPointId||
     original.end!==edge.endPointId)
    return refusal(stamp,'changed_edge_orientation');
  original.end=n.p1;
  arcDoc.lines.push(
    {id:n.in,start:n.p1,end:n.p2},
    {id:n.out,start:n.p3,end:n.p4},
    {id:n.tail,start:n.p4,end:edge.endPointId}
  );
  // From the first mouth wall to the second, choose the semicircle which
  // bulges INWARD. Arc tangency equations enforce both wall/cap joins.
  const left=t.x*v.y-t.y*v.x;
  if(!near(Math.abs(left),1))
    return refusal(stamp,'ambiguous_edge_frame');
  arcDoc.arcs.push({id:n.cap,center:n.center,start:n.p2,end:n.p3,
    direction:left>0?'cw':'ccw'});
  arcDoc.constraints.push({id:n.tailAxis,kind:edge.axis,line:n.tail});
  const anchor=solvedPoints.get(edge.startPointId);
  for(const [index,id] of [n.p1,n.p2,n.p3,n.p4,n.center].entries()){
    const p=points[index],suffix=index<4?'p'+(index+1):'center';
    arcDoc.constraints.push(
      {id:name(slot.id,suffix+'-x'),kind:'distanceX',
        a:edge.startPointId,b:id,value:p.x-anchor.x},
      {id:name(slot.id,suffix+'-y'),kind:'distanceY',
        a:edge.startPointId,b:id,value:p.y-anchor.y}
    );
  }
  arcDoc.constraints.push(
    {id:n.radius,kind:'arcRadius',arc:n.cap,value:r},
    {id:n.tangentIn,kind:'tangent',arc:n.cap,line:n.in,at:'start'},
    {id:n.tangentOut,kind:'tangent',arc:n.cap,line:n.out,at:'end'}
  );
  let validated,solved,profile;
  try{
    validated=createArcSketch(arcDoc);
    solved=solveArcSketch(validated);
  }catch(error){
    return refusal(stamp,'invalid_derived_arc_sketch',String(error?.message||error));
  }
  if(solved.status!=='solved'||solved.degreesOfFreedom!==0)
    return refusal(stamp,'derived_arc_sketch_not_fully_constrained',
      null,solved.status,solved.diagnostics);
  const boundaryIds=view.profile.boundary.flatMap(e=>e.edgeId===slot.edgeId?
    [e.edgeId,n.in,n.cap,n.out,n.tail]:[e.edgeId]);
  try{
    profile=prepareArcProfileForProvider(validated,solved,{
      profileId:slot.id+':selected-profile',
      boundaryIds,holeIds:view.profile.holeIds
    });
  }catch(error){
    return refusal(stamp,'selected_arc_profile_rejected',
      String(error?.message||error),solved.status,solved.diagnostics);
  }
  if(profile.boundary.length!==view.profile.boundary.length+4||
     profile.holes.length!==view.profile.holeIds.length)
    return refusal(stamp,'selected_profile_membership_changed');
  const solutionPoints=new Map(solved.geometry.points.map(p=>[p.id,p]));
  for(const [i,id] of [n.p1,n.p2,n.p3,n.p4,n.center].entries()){
    const p=solutionPoints.get(id);
    if(!p||!near(p.x,points[i].x)||!near(p.y,points[i].y))
      return refusal(stamp,'explicit_slot_target_not_satisfied',id,
        solved.status,solved.diagnostics);
  }
  for(const originalPoint of doc.points){
    const p=solutionPoints.get(originalPoint.id);
    const before=solvedPoints.get(originalPoint.id);
    if(!p||!before||!near(p.x,before.x)||!near(p.y,before.y))
      return refusal(stamp,'original_geometry_would_change',originalPoint.id);
  }
  const capTip=offset(a,t,v,mid,depth+r);
  return {kind:'selected_edge_round_slot',format:SELECTED_EDGE_ROUND_SLOT_FORMAT,
    version:1,slot:{...slot},
    sourceSignature:stamp,arcSourceSignature:serializeArcSketch(validated),
    originalCandidateId:selection.candidateId,
    originalProfileId:view.semanticProfileId,
    sourceSelection:{...selection},originalEdgeId:edge.edgeId,
    originalStartPointId:edge.startPointId,originalEndPointId:edge.endPointId,
    originalLengthMm:edge.lengthMm,
    axis:{...t},inward:{...v},boundaryIds,holeIds:[...view.profile.holeIds],
    handles:[grip(slot.id,'from',points[0]),grip(slot.id,'to',points[3]),
      grip(slot.id,'cap-tip',capTip),
      grip(slot.id,'slide',offset(a,t,v,mid,depth/2))],
    arcSketch:validated,solution:solved,profile,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}
function validateAuthoring(value){
  if(!exact(value,['format','version','source','selection','slot'])||
     value.format!==SELECTED_EDGE_ROUND_SLOT_FORMAT||value.version!==1||
     !exact(value.selection,['candidateId','sourceSignature']))
    throw new TypeError('invalid round-slot authoring envelope');
  const source=createSketch(value.source);
  if(value.selection.sourceSignature!==serializeSketch(source))
    throw new TypeError('stale round-slot base selection');
  if(!exact(value.slot,specKeys))throw new TypeError('invalid round-slot specification');
  return {format:SELECTED_EDGE_ROUND_SLOT_FORMAT,version:1,source,
    selection:{...value.selection},slot:{...value.slot}};
}
export function serializeSelectedEdgeRoundSlot(value){
  return authorStamp(validateAuthoring(value));
}
export function parseSelectedEdgeRoundSlot(json){
  return validateAuthoring(JSON.parse(json));
}
function inspect(value){
  let authoring;
  try{authoring=validateAuthoring(value);}
  catch(error){return refusal(null,'invalid_authoring',String(error?.message||error));}
  const result=compile(authoring.source,authoring.selection,authoring.slot);
  if(result.kind!=='selected_edge_round_slot')return result;
  return {...result,authoring,authoringSignature:authorStamp(authoring)};
}
export function inspectSelectedEdgeRoundSlot(authoring){
  return inspect(authoring);
}
export function createSelectedEdgeRoundSlot(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature',...specKeys])||
     command.kind!=='create-selected-edge-round-slot'||command.version!==1)
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const slot=Object.fromEntries(specKeys.map(k=>[k,command[k]]));
  const result=compile(doc,selection,slot);
  if(result.kind!=='selected_edge_round_slot')return result;
  const authoring={format:SELECTED_EDGE_ROUND_SLOT_FORMAT,version:1,
    source:doc,selection:{...selection},slot};
  return {...result,kind:'accepted',authoring,
    authoringSignature:serializeSelectedEdgeRoundSlot(authoring)};
}
export function editSelectedEdgeRoundSlot(authoring,command){
  const view=inspect(authoring);
  if(view.kind!=='selected_edge_round_slot')return view;
  const stamp=view.authoringSignature;
  if(!exact(command,['kind','version','sourceSignature',
      'fromMm','toMm','straightDepthMm'])||
     command.kind!=='edit-selected-edge-round-slot'||command.version!==1)
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const slot={...view.slot,fromMm:command.fromMm,toMm:command.toMm,
    straightDepthMm:command.straightDepthMm};
  if(near(slot.fromMm,view.slot.fromMm)&&near(slot.toMm,view.slot.toMm)&&
     near(slot.straightDepthMm,view.slot.straightDepthMm))
    return refusal(stamp,'no_change');
  const result=compile(view.authoring.source,view.authoring.selection,slot);
  if(result.kind!=='selected_edge_round_slot')return result;
  const next={...view.authoring,slot};
  return {...result,kind:'accepted',sourceSignature:stamp,
    nextSourceSignature:serializeSelectedEdgeRoundSlot(next),
    authoring:next,authoringSignature:serializeSelectedEdgeRoundSlot(next)};
}
/**
 * Deliberately move an existing semantic slot to a different explicitly
 * selected boundary edge. Only this command (never retrospective rebase)
 * may change the bound edge; the original constraint source is untouched.
 */
export function relocateSelectedEdgeRoundSlot(authoring,command){
  const view=inspect(authoring);
  if(view.kind!=='selected_edge_round_slot')return view;
  const stamp=view.authoringSignature;
  if(!exact(command,['kind','version','sourceSignature',
      'edgeId','fromMm','toMm','straightDepthMm'])||
     command.kind!=='relocate-selected-edge-round-slot'||command.version!==1)
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  if(typeof command.edgeId!=='string')
    return refusal(stamp,'invalid_edge_reference');
  const slot={...view.slot,edgeId:command.edgeId,
    fromMm:command.fromMm,toMm:command.toMm,
    straightDepthMm:command.straightDepthMm};
  if(slot.edgeId===view.slot.edgeId&&
     near(slot.fromMm,view.slot.fromMm)&&near(slot.toMm,view.slot.toMm)&&
     near(slot.straightDepthMm,view.slot.straightDepthMm))
    return refusal(stamp,'no_change');
  const result=compile(view.authoring.source,view.authoring.selection,slot);
  if(result.kind!=='selected_edge_round_slot')return result;
  const next={...view.authoring,slot};
  const nextSignature=serializeSelectedEdgeRoundSlot(next);
  return {...result,kind:'accepted',sourceSignature:stamp,
    nextSourceSignature:nextSignature,authoring:next,
    authoringSignature:nextSignature};
}
export function dragSelectedEdgeRoundSlotHandle(authoring,gesture){
  const view=inspect(authoring);
  if(view.kind!=='selected_edge_round_slot')return view;
  const stamp=view.authoringSignature;
  if(!exact(gesture,['version','sourceSignature','handleId','target'])||
     gesture.version!==1||!exact(gesture.target,['x','y'])||
     !finite(gesture.target.x)||!finite(gesture.target.y))
    return refusal(stamp,'invalid_pointer_gesture');
  if(gesture.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  const h=view.handles.find(h=>h.id===gesture.handleId);
  if(!h)return refusal(stamp,'unknown_handle',gesture.handleId);
  const a=view.solution.geometry.points.find(p=>
    p.id===view.originalStartPointId);
  const delta=sub(gesture.target,a);
  // The slide grip translates the complete U-slot along its referenced
  // edge. Width, cap radius and straight wall depth are invariant.
  const center=h.kind==='slide'?dot(delta,view.axis):null;
  const halfWidth=(view.slot.toMm-view.slot.fromMm)/2;
  const from=h.kind==='slide'?center-halfWidth:
    h.kind==='from'?dot(delta,view.axis):view.slot.fromMm;
  const to=h.kind==='slide'?center+halfWidth:
    h.kind==='to'?dot(delta,view.axis):view.slot.toMm;
  const depth=h.kind==='cap-tip'?
    dot(delta,view.inward)-(to-from)/2:view.slot.straightDepthMm;
  const result=editSelectedEdgeRoundSlot(view.authoring,{
    kind:'edit-selected-edge-round-slot',version:1,sourceSignature:stamp,
    fromMm:from,toMm:to,straightDepthMm:depth});
  if(result.kind!=='accepted')return result;
  const applied=result.handles.find(x=>x.id===gesture.handleId).position;
  return {...result,gesture:{handleId:h.id,requested:{...gesture.target},
    applied:{...applied},
    projectionDeviationMm:Math.hypot(applied.x-gesture.target.x,
      applied.y-gesture.target.y)}};
}
/**
 * Retrospective base changes are explicit and atomically recompiled. Never
 * rebind a slot to another edge or selected profile by heuristic matching.
 */
export function rebaseSelectedEdgeRoundSlot(authoring,source,selection,command){
  const view=inspect(authoring);
  if(view.kind!=='selected_edge_round_slot')return view;
  const stamp=view.authoringSignature;
  if(!exact(command,['kind','version','sourceSignature'])||
     command.kind!=='rebase-selected-edge-round-slot'||command.version!==1)
    return refusal(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refusal(stamp,'stale_source');
  let doc;
  try{doc=createSketch(source);}
  catch(error){return refusal(stamp,'invalid_replacement_source',
    String(error?.message||error));}
  // Distinguish semantic rebinding from a downstream analytic profile
  // rejection. In a retrospective edit, no feature may quietly attach to
  // a new contour just because its slot still compiles into a valid wire.
  const nextSelection=inspectSelectedEdgeHolePlacement(doc,selection);
  if(nextSelection.kind!=='selected_edge_hole_placement')
    return refusal(stamp,'replacement_profile_not_ready',
      nextSelection.reason??null,nextSelection.sourceStatus??null,
      nextSelection.diagnostics??[]);
  const newEdge=nextSelection.edges.find(e=>e.edgeId===view.originalEdgeId);
  if(nextSelection.semanticProfileId!==view.originalProfileId||
     !newEdge||newEdge.startPointId!==view.originalStartPointId||
     newEdge.endPointId!==view.originalEndPointId||
     JSON.stringify(nextSelection.profile.holeIds)!==JSON.stringify(view.holeIds))
    return refusal(stamp,'source_semantic_reference_changed');
  const result=compile(doc,selection,view.slot);
  if(result.kind!=='selected_edge_round_slot')return result;
  if(result.originalProfileId!==view.originalProfileId||
     result.originalEdgeId!==view.originalEdgeId||
     result.originalStartPointId!==view.originalStartPointId||
     result.originalEndPointId!==view.originalEndPointId||
     JSON.stringify(result.holeIds)!==JSON.stringify(view.holeIds))
    return refusal(stamp,'source_semantic_reference_changed');
  const next={...view.authoring,source:doc,selection:{...selection}};
  return {...result,kind:'accepted',sourceSignature:stamp,
    nextSourceSignature:serializeSelectedEdgeRoundSlot(next),
    authoring:next,authoringSignature:serializeSelectedEdgeRoundSlot(next)};
}
