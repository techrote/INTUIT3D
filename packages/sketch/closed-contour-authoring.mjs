/**
 * Closed polygon authoring from explicit sketch-local pointer positions.
 * Each vertex is controlled by real SKETCH v1 scalar constraints (not pixel
 * geometry). A durable contour can be reopened and edited without adapter state.
 * Native exactness and body targeting are deliberately NOT claimed here.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile} from './selected-profile.mjs';

export const CLOSED_CONTOUR_AUTHORING_VERSION=1;
export const MAX_CLOSED_CONTOUR_VERTICES=12;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const point=o=>exact(o,['x','y'])&&finite(o.x)&&finite(o.y);
const validId=id=>typeof id==='string'&&/^[A-Za-z][\w:.-]{0,80}$/.test(id);
const ids=(id,n)=>({
  point:id+':vertex:'+n, edge:id+':edge:'+n,handle:id+':handle:'+n,
  x:id+':offsetX:'+n,y:id+':offsetY:'+n
});
const anchor=id=>id+':anchor';
const flags={previewOnly:true,nativeExact:false,exactBrepAvailable:false,
  independentStepQualified:false};
const refuse=(stamp,reason,detail=null,status=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus:status,diagnostics,...flags});
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const key=c=>[...c.lineIds].sort().join('|');
const candidateFor=(discovery,lineIds)=>
  discovery.candidates.find(c=>same(c.lineIds,lineIds));
const sourceContext=source=>{
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const solved=solveSketch(doc),discovery=discoverPlateProfiles(doc);
  return {doc,stamp,solved,discovery};
};
const sourceRefusal=c=>{
  if(c.solved.status!=='solved'||!c.solved.geometry)
    return refuse(c.stamp,'source_not_fully_solved',null,
      c.solved.status,c.solved.diagnostics);
  if(c.discovery.rejected.length)
    return refuse(c.stamp,'source_contains_unadmitted_contours',
      JSON.stringify(c.discovery.rejected),c.solved.status,c.solved.diagnostics);
  if(c.discovery.status==='budget_exceeded'||c.discovery.status==='numerical_failure'||
     c.discovery.status==='source_unsolved')
    return refuse(c.stamp,'source_profile_discovery_unavailable',
      c.discovery.reason,c.solved.status,c.solved.diagnostics);
  return null;
};
/**
 * Re-admit all previously valid contours (including their holes) rather than
 * assuming the edited loop is the only material region. In particular a new
 * contour must not touch, cross or nest existing material.
 */
const finish=(before,next,contourId,count,oldTarget=null)=>{
  let after;
  try{after=sourceContext(next);}
  catch(e){return refuse(before.stamp,'invalid_proposed_sketch',String(e?.message||e));}
  if(after.solved.status!=='solved'||!after.solved.geometry)
    return refuse(before.stamp,'proposed_sketch_unsolved',null,
      after.solved.status,after.solved.diagnostics);
  if(after.discovery.rejected.length||after.discovery.status==='budget_exceeded'||
     after.discovery.status==='no_profile')
    return refuse(before.stamp,'proposed_contour_invalid',
      JSON.stringify({status:after.discovery.status,rejected:after.discovery.rejected}),
      after.solved.status,after.solved.diagnostics);
  const targetLines=Array.from({length:count},(_,i)=>ids(contourId,i).edge);
  const matching=candidateFor(after.discovery,targetLines);
  if(!matching)return refuse(before.stamp,'new_contour_not_discovered',
    JSON.stringify(after.discovery.rejected),after.solved.status,after.solved.diagnostics);
  for(const old of before.discovery.candidates){
    const found=candidateFor(after.discovery,old.lineIds);
    if(!found||!same(old.holeIds,found.holeIds))
      return refuse(before.stamp,'existing_contour_or_holes_changed',key(old),
        after.solved.status,after.solved.diagnostics);
  }
  if(oldTarget && !same(oldTarget.holeIds,matching.holeIds))
    return refuse(before.stamp,'selected_hole_membership_changed',null,
      after.solved.status,after.solved.diagnostics);
  const beforePoints=new Map(before.solved.geometry.points.map(p=>[p.id,p]));
  const afterPoints=new Map(after.solved.geometry.points.map(p=>[p.id,p]));
  for(const [id,p] of beforePoints){
    if(oldTarget && id.startsWith(contourId+':vertex:'))continue;
    const q=afterPoints.get(id);
    if(!q||p.x!==q.x||p.y!==q.y)
      return refuse(before.stamp,'unselected_geometry_would_move',id,
        after.solved.status,after.solved.diagnostics);
  }
  const afterCircles=new Map(after.solved.geometry.circles.map(c=>[c.id,c.radius]));
  for(const c of before.solved.geometry.circles)
    if(afterCircles.get(c.id)!==c.radius)
      return refuse(before.stamp,'existing_circle_would_change',c.id,
        after.solved.status,after.solved.diagnostics);
  // Recompute semantic selection independently from the new authoritative
  // document; never accept a caller-provided derived profile as source truth.
  const selection={candidateId:matching.id,sourceSignature:after.stamp};
  const selected=proposeSelectedPlateProfile(after.doc,selection);
  if(selected.kind!=='selected_analytic_profile')
    return refuse(before.stamp,'selected_profile_refused',selected.reason,
      after.solved.status,after.solved.diagnostics);
  for(const candidate of before.discovery.candidates){
    const later=candidateFor(after.discovery,candidate.lineIds);
    const accepted=proposeSelectedPlateProfile(after.doc,{
      candidateId:later.id,sourceSignature:after.stamp});
    if(accepted.kind!=='selected_analytic_profile')
      return refuse(before.stamp,'previous_profile_refused',
        accepted.reason,after.solved.status,after.solved.diagnostics);
  }
  return {context:after,profile:selected,selection};
};
const accepted=(before,result,contourId,changed,created=[])=>{
  const inspection=inspectClosedContour(result.context.doc,result.selection,contourId);
  if(inspection.kind!=='closed_contour')
    return refuse(before.stamp,'post_commit_contour_inspection_failed',
      inspection.reason);
  return {kind:'accepted',version:1,sourceSignature:before.stamp,
    nextSourceSignature:result.context.stamp,sketch:result.context.doc,
    selection:result.selection,profile:result.profile,contourId,
    previousCandidateId:before.discovery.candidates.length===1?
      before.discovery.candidates[0].id:null,
    nextCandidateId:result.profile.candidateId,
    createdEntityIds:created,changedConstraintIds:changed,handles:inspection.handles,
    solverStatus:result.context.solved.status,
    degreesOfFreedom:result.context.solved.degreesOfFreedom,
    diagnostics:result.context.solved.diagnostics,...flags};
};

/** Close a freehand dimensioned polygon in one transaction, without heuristically
 * welding points or mutating any existing sketch geometry. */
export function createClosedContour(source,command){
  const before=sourceContext(source),bad=sourceRefusal(before);
  if(bad)return bad;
  if(!exact(command,['kind','version','sourceSignature','contourId','vertices'])||
     command.kind!=='create-closed-contour'||command.version!==1||
     !validId(command.contourId)||!Array.isArray(command.vertices)||
     command.vertices.length<3||command.vertices.length>MAX_CLOSED_CONTOUR_VERTICES||
     !command.vertices.every(point))
    return refuse(before.stamp,'invalid_create_command');
  if(command.sourceSignature!==before.stamp)return refuse(before.stamp,'stale_source');
  const id=command.contourId,n=command.vertices.length;
  const created=[anchor(id)],next=structuredClone(before.doc);
  const occupied=new Set([...next.points,...next.lines,...next.circles,
    ...next.constraints].map(e=>e.id));
  if(occupied.has(id))return refuse(before.stamp,'semantic_id_collision',id);
  for(let i=0;i<n;i++){
    const entry=ids(id,i);
    for(const value of [entry.point,entry.edge,...(i?[entry.x,entry.y]:[])])
      if(value.length>127||occupied.has(value)||created.includes(value))
        return refuse(before.stamp,'semantic_id_collision',value);
    created.push(entry.point,entry.edge,...(i?[entry.x,entry.y]:[]));
    next.points.push({id:entry.point,...command.vertices[i]});
    next.lines.push({id:entry.edge,start:entry.point,
      end:ids(id,(i+1)%n).point});
  }
  next.constraints.push({id:anchor(id),kind:'fixed',point:ids(id,0).point,
    ...command.vertices[0]});
  for(let i=1;i<n;i++){
    next.constraints.push({id:ids(id,i).x,kind:'distanceX',
      a:ids(id,0).point,b:ids(id,i).point,
      value:command.vertices[i].x-command.vertices[0].x});
    next.constraints.push({id:ids(id,i).y,kind:'distanceY',
      a:ids(id,0).point,b:ids(id,i).point,
      value:command.vertices[i].y-command.vertices[0].y});
  }
  const result=finish(before,next,id,n);
  if(!result.context)return result;
  return accepted(before,result,id,[],created);
}

/** All handles and dimensions are reconstructed from serialized source. */
export function inspectClosedContour(source,selection,contourId){
  const c=sourceContext(source),bad=sourceRefusal(c);
  if(bad)return bad;
  if(!validId(contourId))return refuse(c.stamp,'invalid_contour_id');
  const selected=proposeSelectedPlateProfile(c.doc,selection);
  if(selected.kind!=='selected_analytic_profile')
    return refuse(c.stamp,selected.reason,null,c.solved.status,c.solved.diagnostics);
  const points=new Map(c.solved.geometry.points.map(p=>[p.id,p]));
  const lines=new Map(c.doc.lines.map(l=>[l.id,l]));
  const constraints=new Map(c.doc.constraints.map(p=>[p.id,p]));
  const a=constraints.get(anchor(contourId));
  if(!a||a.kind!=='fixed'||a.point!==ids(contourId,0).point)
    return refuse(c.stamp,'contour_anchor_missing');
  let count=0;
  for(;count<MAX_CLOSED_CONTOUR_VERTICES+1;count++)
    if(!points.has(ids(contourId,count).point))break;
  if(count<3||count>MAX_CLOSED_CONTOUR_VERTICES)
    return refuse(c.stamp,'contour_vertex_count_invalid');
  const expected=Array.from({length:count},(_,i)=>ids(contourId,i).edge);
  if(!same(selected.lineIds,expected))
    return refuse(c.stamp,'selection_does_not_match_contour');
  const origin=points.get(ids(contourId,0).point);
  const handles=[],dimensions=[];
  for(let i=0;i<count;i++){
    const entry=ids(contourId,i),next=ids(contourId,(i+1)%count);
    const edge=lines.get(entry.edge),position=points.get(entry.point);
    if(!edge||edge.start!==entry.point||edge.end!==next.point)
      return refuse(c.stamp,'contour_edge_topology_modified',entry.edge);
    if(i){
      const dx=constraints.get(entry.x),dy=constraints.get(entry.y);
      if(!dx||!dy||dx.kind!=='distanceX'||dy.kind!=='distanceY'||
         dx.a!==ids(contourId,0).point||dy.a!==ids(contourId,0).point||
         dx.b!==entry.point||dy.b!==entry.point)
        return refuse(c.stamp,'contour_dimensions_modified',entry.point);
      dimensions.push({index:i,xConstraintId:entry.x,yConstraintId:entry.y,
        offsetXmm:dx.value,offsetYmm:dy.value});
    }
    handles.push({handleId:entry.handle,index:i,kind:i?'vertex':'origin',
      pointId:entry.point,position:{x:position.x,y:position.y},
      constraintIds:i?[entry.x,entry.y]:[anchor(contourId)]});
  }
  return {kind:'closed_contour',version:1,sourceSignature:c.stamp,
    contourId,selection:{...selection},profile:selected,vertices:handles.map(h=>({
      x:h.position.x,y:h.position.y})),handles,dimensions,
    solverStatus:c.solved.status,degreesOfFreedom:c.solved.degreesOfFreedom,
    diagnostics:c.solved.diagnostics,...flags};
}

/** Coordinates are absolute sketch-local mm for changed vertices. Changing
 * vertex 0 translates all unchanged vertices by their original signed offsets.
 */
export function editClosedContourVertices(source,selection,command){
  const before=sourceContext(source);
  if(!exact(command,['kind','version','sourceSignature','contourId','changes'])||
     command.kind!=='edit-closed-contour-vertices'||command.version!==1||
     !validId(command.contourId)||!Array.isArray(command.changes)||
     command.changes.length<1||command.changes.length>MAX_CLOSED_CONTOUR_VERTICES)
    return refuse(before.stamp,'invalid_edit_command');
  if(command.sourceSignature!==before.stamp)return refuse(before.stamp,'stale_source');
  const view=inspectClosedContour(before.doc,selection,command.contourId);
  if(view.kind!=='closed_contour')return view;
  const changes=new Map();
  for(const change of command.changes){
    if(!exact(change,['index','xMm','yMm'])||
       !Number.isSafeInteger(change.index)||change.index<0||
       change.index>=view.handles.length||!finite(change.xMm)||
       !finite(change.yMm)||changes.has(change.index))
      return refuse(before.stamp,'invalid_vertex_change');
    changes.set(change.index,{x:change.xMm,y:change.yMm});
  }
  const next=structuredClone(before.doc),origin=changes.get(0)??view.vertices[0];
  const altered=[];
  const fixed=next.constraints.find(c=>c.id===anchor(command.contourId));
  if(changes.has(0)&&(fixed.x!==origin.x||fixed.y!==origin.y)){
    fixed.x=origin.x;fixed.y=origin.y;altered.push(fixed.id);
  }
  for(let i=1;i<view.handles.length;i++){
    if(!changes.has(i))continue;
    const target=changes.get(i);
    for(const [axis,kind] of [['x','offsetX'],['y','offsetY']]){
      const id=ids(command.contourId,i)[axis],c=next.constraints.find(z=>z.id===id);
      const value=target[axis]-origin[axis];
      if(!finite(value))return refuse(before.stamp,'unrepresentable_dimension',id);
      if(c.value!==value){c.value=value;altered.push(id);}
    }
  }
  if(!altered.length)return refuse(before.stamp,'no_change');
  const result=finish(before,next,command.contourId,view.handles.length,view.profile);
  if(!result.context)return result;
  return accepted(before,result,command.contourId,altered);
}

export function dragClosedContourVertex(source,selection,gesture){
  const c=sourceContext(source);
  if(!exact(gesture,['version','sourceSignature','contourId','handleId','target'])||
     gesture.version!==1||!validId(gesture.contourId)||
     typeof gesture.handleId!=='string'||!point(gesture.target))
    return refuse(c.stamp,'invalid_pointer_gesture');
  if(gesture.sourceSignature!==c.stamp)return refuse(c.stamp,'stale_source');
  const view=inspectClosedContour(c.doc,selection,gesture.contourId);
  if(view.kind!=='closed_contour')return view;
  const hit=view.handles.find(h=>h.handleId===gesture.handleId);
  if(!hit)return refuse(c.stamp,'handle_not_in_selected_contour',gesture.handleId);
  const edited=editClosedContourVertices(c.doc,selection,{
    kind:'edit-closed-contour-vertices',version:1,sourceSignature:c.stamp,
    contourId:gesture.contourId,changes:[{index:hit.index,
      xMm:gesture.target.x,yMm:gesture.target.y}]});
  if(edited.kind!=='accepted')return edited;
  const successor=edited.handles.find(h=>h.handleId===gesture.handleId);
  if(!successor)return refuse(c.stamp,'successor_handle_missing');
  return {...edited,gesture:{handleId:gesture.handleId,
    requested:{...gesture.target},applied:{...successor.position},
    deviationMm:Math.hypot(successor.position.x-gesture.target.x,
      successor.position.y-gesture.target.y)}};
}
