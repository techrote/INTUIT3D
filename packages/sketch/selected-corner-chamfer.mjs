/**
 * Versioned, revision-fenced two-distance chamfer of a selected convex
 * orthogonal contour corner. This is genuine editable line geometry, not a
 * faceted approximation of a fillet. Never claims native B-rep authority.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';

export const SELECTED_CORNER_CHAMFER_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const idOK=s=>typeof s==='string'&&/^[A-Za-z][\w:.-]{0,95}$/.test(s);
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-8;
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const plus=(a,v,k)=>({x:a.x+v.x*k,y:a.y+v.y*k});
const magnitude=v=>Math.hypot(v.x,v.y);
const ids=id=>({in:id+':incoming',out:id+':outgoing',
  bevel:id+':bevel',ix:id+':incoming:x',iy:id+':incoming:y',
  ox:id+':outgoing:x',oy:id+':outgoing:y'});
const refused=(stamp,reason,detail=null,status=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus:status,diagnostics,previewOnly:true,nativeExact:false
});
const acceptedProfile=(sketch,old,extra)=>{
  const d=discoverPlateProfiles(sketch);
  const target=[...old.lineIds,extra].sort().join('|');
  const candidate=d.candidates.find(c=>[...c.lineIds].sort().join('|')===target);
  if(!candidate)return {reason:'selected_contour_no_longer_admissible',
    detail:JSON.stringify({status:d.status,rejected:d.rejected})};
  const proposal=proposeSelectedPlateProfile(sketch,{
    candidateId:candidate.id,sourceSignature:serializeSketch(sketch)});
  if(proposal.kind!=='selected_analytic_profile')
    return {reason:'selected_profile_rejected',detail:proposal.reason};
  if([...proposal.holeIds].sort().join('|')!==[...old.holeIds].sort().join('|'))
    return {reason:'hole_membership_changed'};
  try{return {profile:admitSelectedPlateProfile(sketch,proposal)};}
  catch(e){return {reason:'profile_admission_failed',detail:String(e?.message||e)};}
};
const guardUnselected=(before,after,original)=>{
  const a=solveSketch(before).geometry,b=solveSketch(after).geometry;
  if(!a||!b)return 'missing_solver_geometry';
  const selected=new Set(original.lineIds);
  const keep=new Set(before.lines.filter(l=>!selected.has(l.id))
    .flatMap(l=>[l.start,l.end]));
  for(const c of before.circles)
    if(!original.holeIds.includes(c.id))keep.add(c.center);
  const pointsA=new Map(a.points.map(p=>[p.id,p]));
  const pointsB=new Map(b.points.map(p=>[p.id,p]));
  for(const id of keep){
    const x=pointsA.get(id),y=pointsB.get(id);
    if(!x||!y||!close(x.x,y.x)||!close(x.y,y.y))return id;
  }
  return null;
};
const finish=(original,next,oldProfile,bevelId,stamp)=>{
  let checked,solution;
  try{checked=createSketch(next);solution=solveSketch(checked);}
  catch(e){return refused(stamp,'invalid_candidate',String(e?.message||e));}
  if(solution.status!=='solved'||solution.degreesOfFreedom!==0||!solution.geometry)
    return refused(stamp,'unsolved_after_edit',null,solution.status,solution.diagnostics);
  const nextProfile=acceptedProfile(checked,oldProfile,bevelId);
  if(!nextProfile.profile)
    return refused(stamp,nextProfile.reason,nextProfile.detail??null,
      solution.status,solution.diagnostics);
  const moved=guardUnselected(original,checked,oldProfile);
  if(moved)return refused(stamp,'unselected_geometry_would_change',moved,
    solution.status,solution.diagnostics);
  return {sketch:checked,solution,profile:nextProfile.profile};
};
const axes=(doc,lineId,v)=>{
  if(!finite(v.x)||!finite(v.y)||magnitude(v)<=1e-9)return false;
  if(Math.abs(v.y)<=1e-9&&Math.abs(v.x)>1e-9)
    return doc.constraints.some(c=>c.kind==='horizontal'&&c.line===lineId);
  if(Math.abs(v.x)<=1e-9&&Math.abs(v.y)>1e-9)
    return doc.constraints.some(c=>c.kind==='vertical'&&c.line===lineId);
  return false;
};
const vertexFrame=(doc,profile,cornerId)=>{
  const boundary=profile.boundary;
  const incoming=boundary.find(e=>e.endPointId===cornerId);
  const outgoing=boundary.find(e=>e.startPointId===cornerId);
  if(!incoming||!outgoing||incoming.edgeId===outgoing.edgeId)
    return {reason:'corner_not_in_selected_contour'};
  if(doc.lines.filter(l=>l.start===cornerId||l.end===cornerId).length!==2||
     doc.circles.some(c=>c.center===cornerId))
    return {reason:'corner_has_external_topology'};
  const vi=subtract(incoming.end,incoming.start),vo=subtract(outgoing.end,outgoing.start);
  const li=magnitude(vi),lo=magnitude(vo);
  if(li<=1e-9||lo<=1e-9||!axes(doc,incoming.edgeId,vi)||
     !axes(doc,outgoing.edgeId,vo))
    return {reason:'corner_edges_not_axis_constrained'};
  const ti={x:vi.x/li,y:vi.y/li},to={x:vo.x/lo,y:vo.y/lo};
  if(Math.abs(dot(ti,to))>1e-9)return {reason:'corner_not_perpendicular'};
  const doubleArea=boundary.reduce((a,e)=>
    a+cross(e.start,e.end),0);
  if(!finite(doubleArea)||Math.abs(doubleArea)<=1e-9||
     Math.sign(cross(ti,to))!==Math.sign(doubleArea))
    return {reason:'corner_not_convex'};
  return {incoming,outgoing,corner:incoming.end,ti,to,li,lo};
};
const dimensions=(a,b,li,lo)=>finite(a)&&finite(b)&&a>0&&b>0&&
  a<li&&b<lo&&finite(a*b);

/**
 * Cut a straight chamfer between two axis-constrained selected boundary edges.
 * Original edge/constraint IDs are retained, and two signed XY constraint
 * pairs reference the ORIGINAL corner point, which remains an authored datum.
 */
export function createSelectedCornerChamfer(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const old=proposeSelectedPlateProfile(doc,selection);
  if(old.kind!=='selected_analytic_profile')
    return refused(stamp,old.reason,null,old.sourceStatus??null);
  if(!exact(command,['kind','version','sourceSignature','chamferId',
    'cornerPointId','incomingMm','outgoingMm'])||
     command.kind!=='create-corner-chamfer'||command.version!==1||
     !idOK(command.chamferId)||typeof command.cornerPointId!=='string')
    return refused(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refused(stamp,'stale_source');
  const f=vertexFrame(doc,old,command.cornerPointId);
  if(f.reason)return refused(stamp,f.reason);
  if(!dimensions(command.incomingMm,command.outgoingMm,f.li,f.lo))
    return refused(stamp,'invalid_chamfer_dimensions');
  const n=ids(command.chamferId),taken=new Set([...doc.points,...doc.lines,
    ...doc.circles,...doc.constraints].map(e=>e.id));
  if(taken.has(command.chamferId)||
     Object.values(n).some(s=>s.length>127||taken.has(s)))
    return refused(stamp,'semantic_id_collision');
  const pi=plus(f.corner,f.ti,-command.incomingMm);
  const po=plus(f.corner,f.to,command.outgoingMm);
  if(![pi.x,pi.y,po.x,po.y].every(finite))
    return refused(stamp,'unrepresentable_chamfer');
  const next=structuredClone(doc);
  next.points.push({id:n.in,...pi},{id:n.out,...po});
  const inside=next.lines.find(l=>l.id===f.incoming.edgeId);
  const outside=next.lines.find(l=>l.id===f.outgoing.edgeId);
  if(!inside||!outside)return refused(stamp,'missing_selected_edge');
  const anchor=command.cornerPointId;
  if(inside.start===anchor)inside.start=n.in;
  else if(inside.end===anchor)inside.end=n.in;
  else return refused(stamp,'changed_incoming_edge');
  if(outside.start===anchor)outside.start=n.out;
  else if(outside.end===anchor)outside.end=n.out;
  else return refused(stamp,'changed_outgoing_edge');
  next.lines.push({id:n.bevel,start:n.in,end:n.out});
  next.constraints.push(
    {id:n.ix,kind:'distanceX',a:anchor,b:n.in,value:pi.x-f.corner.x},
    {id:n.iy,kind:'distanceY',a:anchor,b:n.in,value:pi.y-f.corner.y},
    {id:n.ox,kind:'distanceX',a:anchor,b:n.out,value:po.x-f.corner.x},
    {id:n.oy,kind:'distanceY',a:anchor,b:n.out,value:po.y-f.corner.y}
  );
  const checked=finish(doc,next,old,n.bevel,stamp);
  if(!checked.sketch)return checked;
  const successor={candidateId:checked.profile.candidateId,
    sourceSignature:serializeSketch(checked.sketch)};
  const inspection=inspectSelectedCornerChamfer(checked.sketch,successor,
    command.chamferId);
  if(inspection.kind!=='selected_corner_chamfer')
    return refused(stamp,'post_edit_inspection_failed',inspection.reason);
  return result(stamp,checked,successor,inspection,old.candidateId,
    [n.in,n.out,n.bevel],[n.ix,n.iy,n.ox,n.oy]);
}
const result=(stamp,checked,selection,view,prior,created,changed)=>({
  kind:'accepted',version:1,sourceSignature:stamp,
  nextSourceSignature:selection.sourceSignature,sketch:checked.sketch,
  selection,profile:checked.profile,previousCandidateId:prior,
  nextCandidateId:checked.profile.candidateId,chamferId:view.chamferId,
  originalCornerPointId:view.cornerPointId,
  incomingEdgeId:view.incomingEdgeId,outgoingEdgeId:view.outgoingEdgeId,
  createdEntityIds:created,changedConstraintIds:changed,
  handles:view.handles,solverStatus:checked.solution.status,
  degreesOfFreedom:checked.solution.degreesOfFreedom,
  diagnostics:checked.solution.diagnostics,previewOnly:true,nativeExact:false,
  exactBrepAvailable:false,independentStepQualified:false
});

/** Reconstruct real reference binding after save/reopen or upstream edits. */
export function inspectSelectedCornerChamfer(source,selection,chamferId){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const fail=(reason,detail=null)=>refused(stamp,reason,detail);
  if(!idOK(chamferId))return fail('invalid_chamfer_id');
  const proposal=proposeSelectedPlateProfile(doc,selection);
  if(proposal.kind!=='selected_analytic_profile')
    return fail(proposal.reason);
  const n=ids(chamferId),byLine=new Map(doc.lines.map(e=>[e.id,e]));
  const bevel=byLine.get(n.bevel);
  if(!bevel||!proposal.lineIds.includes(n.bevel)||
     ![n.in,n.out].includes(bevel.start)||
     ![n.in,n.out].includes(bevel.end)||bevel.start===bevel.end)
    return fail('chamfer_not_in_selected_contour');
  const byConstraint=new Map(doc.constraints.map(e=>[e.id,e]));
  const anchor=byConstraint.get(n.ix)?.a;
  if(!anchor)return fail('missing_chamfer_anchor');
  const solved=solveSketch(doc),positions=new Map(
    solved.geometry?.points.map(p=>[p.id,p])??[]);
  const pi=positions.get(n.in),po=positions.get(n.out),c=positions.get(anchor);
  if(!pi||!po||!c)return fail('missing_chamfer_geometry');
  for(const [id,p,kind] of [[n.ix,pi,'distanceX'],[n.iy,pi,'distanceY'],
    [n.ox,po,'distanceX'],[n.oy,po,'distanceY']]){
    const q=byConstraint.get(id),axis=(id===n.ix||id===n.ox)?'x':'y';
    if(!q||q.kind!==kind||q.a!==anchor||q.b!==p.id||
       !close(q.value,p[axis]-c[axis]))
      return fail('chamfer_constraints_changed',id);
  }
  const incoming=doc.lines.filter(l=>proposal.lineIds.includes(l.id)&&
    l.id!==n.bevel&&(l.start===n.in||l.end===n.in));
  const outgoing=doc.lines.filter(l=>proposal.lineIds.includes(l.id)&&
    l.id!==n.bevel&&(l.start===n.out||l.end===n.out));
  if(incoming.length!==1||outgoing.length!==1)
    return fail('chamfer_topology_modified');
  const inEdge=incoming[0],outEdge=outgoing[0];
  const si=positions.get(inEdge.start===n.in?inEdge.end:inEdge.start);
  const so=positions.get(outEdge.start===n.out?outEdge.end:outEdge.start);
  if(!si||!so||!axes(doc,inEdge.id,subtract(c,si))||
     !axes(doc,outEdge.id,subtract(so,c)))
    return fail('chamfer_edges_changed');
  const iv=subtract(c,si),ov=subtract(so,c);
  const il=magnitude(iv),ol=magnitude(ov);
  if(il<=0||ol<=0)return fail('collapsed_source_corner');
  const ti={x:iv.x/il,y:iv.y/il},to={x:ov.x/ol,y:ov.y/ol};
  const incomingMm=dot(subtract(c,pi),ti);
  const outgoingMm=dot(subtract(po,c),to);
  if(!dimensions(incomingMm,outgoingMm,il,ol)||
     Math.abs(dot(ti,to))>1e-9||
     !close(magnitude(subtract(pi,plus(c,ti,-incomingMm))),0)||
     !close(magnitude(subtract(po,plus(c,to,outgoingMm))),0))
    return fail('chamfer_geometry_changed');
  const handles=[
    {id:chamferId+':handle:incoming',kind:'incoming',position:{x:pi.x,y:pi.y}},
    {id:chamferId+':handle:outgoing',kind:'outgoing',position:{x:po.x,y:po.y}}
  ];
  return {kind:'selected_corner_chamfer',version:1,sourceSignature:stamp,
    selection:{...selection},semanticProfileId:proposal.semanticProfileId,
    chamferId,cornerPointId:anchor,incomingEdgeId:inEdge.id,
    outgoingEdgeId:outEdge.id,incomingMm,outgoingMm,
    incomingLengthMm:il,outgoingLengthMm:ol,
    incomingAxis:ti,outgoingAxis:to,corner:{x:c.x,y:c.y},
    handles,profile:proposal,previewOnly:true,nativeExact:false};
}

/** Move the two setbacks in one fully solved, immutable sketch transaction. */
export function editSelectedCornerChamfer(source,selection,command){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','chamferId',
    'incomingMm','outgoingMm'])||command.kind!=='edit-corner-chamfer'||
    command.version!==1||!idOK(command.chamferId))
    return refused(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refused(stamp,'stale_source');
  const view=inspectSelectedCornerChamfer(doc,selection,command.chamferId);
  if(view.kind!=='selected_corner_chamfer')return view;
  if(!dimensions(command.incomingMm,command.outgoingMm,
    view.incomingLengthMm,view.outgoingLengthMm))
    return refused(stamp,'invalid_chamfer_dimensions');
  if(close(command.incomingMm,view.incomingMm)&&
     close(command.outgoingMm,view.outgoingMm))
    return refused(stamp,'no_change');
  const n=ids(command.chamferId),next=structuredClone(doc);
  const points=new Map(next.points.map(p=>[p.id,p]));
  const constraints=new Map(next.constraints.map(c=>[c.id,c]));
  const pi=plus(view.corner,view.incomingAxis,-command.incomingMm);
  const po=plus(view.corner,view.outgoingAxis,command.outgoingMm);
  for(const [point,id,xid,yid] of [[pi,n.in,n.ix,n.iy],[po,n.out,n.ox,n.oy]]){
    const p=points.get(id);
    if(!p)return refused(stamp,'missing_authored_point',id);
    p.x=point.x;p.y=point.y;
    constraints.get(xid).value=point.x-view.corner.x;
    constraints.get(yid).value=point.y-view.corner.y;
  }
  const checked=finish(doc,next,view.profile,n.bevel,stamp);
  if(!checked.sketch)return checked;
  const successor={candidateId:checked.profile.candidateId,
    sourceSignature:serializeSketch(checked.sketch)};
  const fresh=inspectSelectedCornerChamfer(checked.sketch,successor,
    command.chamferId);
  if(fresh.kind!=='selected_corner_chamfer')
    return refused(stamp,'post_edit_inspection_failed',fresh.reason);
  return result(stamp,checked,successor,fresh,view.selection.candidateId,[],
    [n.ix,n.iy,n.ox,n.oy]);
}

/** Project an arbitrary pointer target onto one geometric setback dimension. */
export function dragSelectedCornerChamferHandle(source,selection,gesture){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(gesture,['version','sourceSignature','chamferId','handleId','target'])||
     gesture.version!==1||!idOK(gesture.chamferId)||
     typeof gesture.handleId!=='string'||
     !exact(gesture.target,['x','y'])||
     !finite(gesture.target.x)||!finite(gesture.target.y))
    return refused(stamp,'invalid_gesture');
  if(gesture.sourceSignature!==stamp)return refused(stamp,'stale_source');
  const view=inspectSelectedCornerChamfer(doc,selection,gesture.chamferId);
  if(view.kind!=='selected_corner_chamfer')return view;
  const h=view.handles.find(h=>h.id===gesture.handleId);
  if(!h)return refused(stamp,'unknown_handle');
  const tangent=h.kind==='incoming'?view.incomingAxis:view.outgoingAxis;
  const sign=h.kind==='incoming'?-1:1;
  const value=sign*dot(subtract(gesture.target,view.corner),tangent);
  const incomingMm=h.kind==='incoming'?value:view.incomingMm;
  const outgoingMm=h.kind==='outgoing'?value:view.outgoingMm;
  const edit=editSelectedCornerChamfer(doc,selection,{
    kind:'edit-corner-chamfer',version:1,sourceSignature:stamp,
    chamferId:gesture.chamferId,incomingMm,outgoingMm});
  if(edit.kind!=='accepted')return edit;
  const applied=plus(view.corner,tangent,sign*value);
  return {...edit,gesture:{handleId:gesture.handleId,
    requested:{...gesture.target},applied,
    projectionDeviationMm:magnitude(subtract(gesture.target,applied))}};
}
