/**
 * Source-replayed, pointer-driven selection of real SOLVED linear sketch contours.
 *
 * WORKBENCH supplies sketch-local mm coordinates (never WebGL face IDs). Only
 * explicitly discovered/admitted semantic contours can be selected. Ambiguous
 * edges and voids never become material; native/STEP truth is not asserted.
 */
import {createSketch,serializeSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';
import {proposeSelectedPlateProfile,admitSelectedPlateProfile} from './selected-profile.mjs';

export const POINTER_CONTOUR_SELECTION_VERSION=1;

const finite=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const finitePoint=p=>exact(p,['x','y'])&&finite(p.x)&&finite(p.y);
const preview={previewOnly:true,nativeExact:false,exactBrepAvailable:false,
  independentStepQualified:false};
const refused=(signature,reason,detail=null,sourceStatus=null,diagnostics=[])=>({
  kind:'refused',version:1,sourceSignature:signature,reason,detail,
  sourceStatus,diagnostics,...preview
});
const miss=(signature,reason)=>({
  kind:'miss',version:1,sourceSignature:signature,reason,...preview
});
function segmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(!finite(length)||length<=0)return null;
  const unbounded=((point.x-a.x)*(dx/length)+(point.y-a.y)*(dy/length))/length;
  if(!finite(unbounded))return null;
  const fraction=Math.max(0,Math.min(1,unbounded));
  const nearest={x:a.x+fraction*dx,y:a.y+fraction*dy};
  const distanceMm=Math.hypot(nearest.x-point.x,nearest.y-point.y);
  if(!finite(distanceMm)||!finite(nearest.x)||!finite(nearest.y))return null;
  return {fraction,nearest,distanceMm,lengthMm:length,
    alongMm:length*fraction};
}
/** Boundary-aware ray-cast; boundary clearance is an EXPLICIT caller mm budget. */
function regionHit(region,point,clearanceMm){
  const edges=region.profile.boundary;
  let inside=false,close=false;
  for(const edge of edges){
    const a=edge.start,b=edge.end;
    const d=segmentDistance(point,a,b);
    if(!d)return {kind:'numeric_ambiguity'};
    if(d.distanceMm<=clearanceMm)close=true;
    if((a.y>point.y)!==(b.y>point.y)){
      const x=a.x+(point.y-a.y)*(b.x-a.x)/(b.y-a.y);
      if(!finite(x))return {kind:'numeric_ambiguity'};
      if(point.x<x)inside=!inside;
    }
  }
  if(close)return {kind:'boundary_ambiguous'};
  if(!inside)return {kind:'outside'};
  for(const hole of region.profile.profile.holes){
    const distance=Math.hypot(point.x-hole.x,point.y-hole.y);
    if(!finite(distance))return {kind:'numeric_ambiguity'};
    if(Math.abs(distance-hole.radius)<=clearanceMm)
      return {kind:'boundary_ambiguous'};
    if(distance<hole.radius)return {kind:'hole_void',holeId:hole.id};
  }
  return {kind:'inside'};
}

/**
 * List selectable profiles, including explicit refusals, rather than
 * presenting the first discovered contour as a silently chosen target.
 */
export function inspectPointerSelectableContours(source){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  const discovery=discoverPlateProfiles(doc);
  if(discovery.status!=='ready'&&discovery.status!=='ambiguous')
    return refused(stamp,'source_not_profile_ready',discovery.reason,
      discovery.sourceStatus);
  const candidates=[],blocked=[];
  for(const candidate of discovery.candidates){
    const selection={candidateId:candidate.id,sourceSignature:stamp};
    const proposal=proposeSelectedPlateProfile(doc,selection);
    if(proposal.kind!=='selected_analytic_profile'){
      blocked.push({candidateId:candidate.id,reason:proposal.reason,
        overlappingLineIds:proposal.overlappingLineIds});
      continue;
    }
    const profile=admitSelectedPlateProfile(doc,proposal);
    const bounds={
      minX:Math.min(...profile.profile.outer.map(p=>p.x)),
      minY:Math.min(...profile.profile.outer.map(p=>p.y)),
      maxX:Math.max(...profile.profile.outer.map(p=>p.x)),
      maxY:Math.max(...profile.profile.outer.map(p=>p.y))
    };
    candidates.push({candidateId:candidate.id,semanticProfileId:profile.semanticProfileId,
      lineIds:[...profile.lineIds],holeIds:[...profile.holeIds],
      boundary:profile.boundary,areaMm2:profile.profile.areaMm2,
      bounds,selection,profile});
  }
  if(candidates.length===0)
    return refused(stamp,'no_admissible_contour',JSON.stringify(blocked),
      discovery.sourceStatus);
  return {kind:'pointer_selectable_contours',version:1,
    sourceSignature:stamp,sourceStatus:discovery.sourceStatus,
    discoveryStatus:discovery.status,candidates,blocked,...preview};
}

/**
 * Select by clicking INSIDE a contour, not inside a circular cutout.
 * Touching a boundary or entering its caller-specified clearance band refuses.
 */
export function selectContourAtPointer(source,request){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(request,['kind','version','sourceSignature','point','boundaryClearanceMm'])||
      request.kind!=='select-contour-at-pointer'||request.version!==1||
      typeof request.sourceSignature!=='string'||!finitePoint(request.point)||
      !finite(request.boundaryClearanceMm)||request.boundaryClearanceMm<0||
      request.boundaryClearanceMm>20)
    return refused(stamp,'invalid_pointer_command');
  if(request.sourceSignature!==stamp)return refused(stamp,'stale_source');
  const list=inspectPointerSelectableContours(doc);
  if(list.kind!=='pointer_selectable_contours')return list;
  const hit=[],voids=[];
  for(const candidate of list.candidates){
    const classification=regionHit(candidate,request.point,request.boundaryClearanceMm);
    if(classification.kind==='numeric_ambiguity'||
        classification.kind==='boundary_ambiguous')
      return refused(stamp,classification.kind,candidate.candidateId,
        list.sourceStatus);
    if(classification.kind==='inside')hit.push(candidate);
    if(classification.kind==='hole_void')voids.push(classification.holeId);
  }
  if(hit.length>1)return refused(stamp,'ambiguous_contours',
    hit.map(c=>c.candidateId).join(','),list.sourceStatus);
  if(hit.length===0)
    return miss(stamp,voids.length?'hole_void':'outside_contours');
  const selected=hit[0];
  return {kind:'selected',version:1,sourceSignature:stamp,
    selection:selected.selection,profile:selected.profile,
    hit:{kind:'interior',point:{...request.point}},
    ...preview};
}

/**
 * Pick one unambiguous SEMANTIC boundary edge. The mm hit radius is explicitly
 * supplied by WORKBENCH after viewport-to-sketch coordinate conversion.
 * A vertex with multiple incident edges is never guessed into an edge.
 */
export function pickContourEdgeAtPointer(source,request){
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(request,['kind','version','sourceSignature','point','maxDistanceMm'])||
      request.kind!=='pick-contour-edge-at-pointer'||request.version!==1||
      typeof request.sourceSignature!=='string'||!finitePoint(request.point)||
      !finite(request.maxDistanceMm)||request.maxDistanceMm<=0||
      request.maxDistanceMm>20)
    return refused(stamp,'invalid_pointer_command');
  if(request.sourceSignature!==stamp)return refused(stamp,'stale_source');
  const list=inspectPointerSelectableContours(doc);
  if(list.kind!=='pointer_selectable_contours')return list;
  const matches=[];
  for(const candidate of list.candidates){
    for(const edge of candidate.boundary){
      const distance=segmentDistance(request.point,edge.start,edge.end);
      if(!distance)return refused(stamp,'numeric_ambiguity',
        edge.edgeId,list.sourceStatus);
      if(distance.distanceMm<=request.maxDistanceMm)
        matches.push({candidate,edge,distance});
    }
  }
  if(matches.length===0)return miss(stamp,'no_edge_in_range');
  if(matches.length!==1)return refused(stamp,'ambiguous_edges',
    matches.map(m=>m.edge.edgeId).join(','),list.sourceStatus);
  const {candidate,edge,distance}=matches[0];
  if(distance.fraction<=0||distance.fraction>=1)
    return refused(stamp,'vertex_ambiguous',edge.edgeId,list.sourceStatus);
  return {kind:'selected_edge',version:1,sourceSignature:stamp,
    selection:candidate.selection,profile:candidate.profile,
    edgeId:edge.edgeId,startPointId:edge.startPointId,
    endPointId:edge.endPointId,
    hit:{kind:'edge',point:{...request.point},nearest:distance.nearest,
      fraction:distance.fraction,alongMm:distance.alongMm,
      distanceMm:distance.distanceMm,lengthMm:distance.lengthMm},
    ...preview};
}
