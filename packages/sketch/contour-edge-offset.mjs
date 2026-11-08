/**
 * Source-replayed normal offset of one semantic edge of a directly drawn
 * contour. The returned edit command and SKETCH acceptance are intentionally
 * the EXISTING closed-contour-authoring/v1 edit contract: RUNTIME can replay
 * the same command without inventing a second structural transaction type.
 * Only solved analytic sketch intent is admitted, never exact B-rep/STEP.
 */
import {createSketch,serializeSketch} from './index.mjs';
import {inspectClosedContour,editClosedContourVertices}
  from './closed-contour-authoring.mjs';

export const CONTOUR_EDGE_OFFSET_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const flags={previewOnly:true,nativeExact:false,exactBrepAvailable:false,
  independentStepQualified:false};
const refuse=(signature,reason,detail=null)=>({
  kind:'refused',version:1,sourceSignature:signature,reason,detail,
  sourceStatus:null,diagnostics:[],...flags
});
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const scale=(a,t)=>({x:a.x*t,y:a.y*t});
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const validPoint=p=>exact(p,['x','y'])&&finite(p.x)&&finite(p.y);

/**
 * Return selectable, source-owned edge identities, exact current coordinates
 * and the outward normal for either clockwise or counterclockwise contours.
 * No side is inferred from screen orientation or mutable preview pixels.
 */
export function inspectClosedContourEdges(source,selection,contourId){
  const view=inspectClosedContour(source,selection,contourId);
  if(view.kind!=='closed_contour')return view;
  const doc=createSketch(source),signature=serializeSketch(doc);
  const v=view.vertices,n=v.length,pivot=v[0];
  // Translate first to keep the orientation calculation less susceptible to
  // cancellation at large sketch-local origins. Do not expand tolerances.
  let area2=0;
  for(let i=0;i<n;i++){
    const a=sub(v[i],pivot),b=sub(v[(i+1)%n],pivot);
    const cross=a.x*b.y-b.x*a.y;
    if(!finite(cross))return refuse(signature,'unrepresentable_contour_orientation');
    area2+=cross;
  }
  if(!finite(area2)||area2===0)
    return refuse(signature,'ambiguous_contour_orientation');
  const sign=Math.sign(area2),edges=[];
  const lineMap=new Map(doc.lines.map(l=>[l.id,l]));
  for(let i=0;i<n;i++){
    const j=(i+1)%n,start=v[i],end=v[j];
    const edgeId=contourId+':edge:'+i;
    const line=lineMap.get(edgeId);
    if(!line||line.start!==view.handles[i].pointId||
       line.end!==view.handles[j].pointId)
      return refuse(signature,'contour_edge_topology_changed',edgeId);
    const delta=sub(end,start),lengthMm=Math.hypot(delta.x,delta.y);
    if(!finite(lengthMm)||lengthMm===0)
      return refuse(signature,'unrepresentable_contour_edge',edgeId);
    const normal=sign>0
      ?{x:delta.y/lengthMm,y:-delta.x/lengthMm}
      :{x:-delta.y/lengthMm,y:delta.x/lengthMm};
    const midpoint={x:start.x+delta.x/2,y:start.y+delta.y/2};
    if(!validPoint(normal)||!validPoint(midpoint))
      return refuse(signature,'unrepresentable_edge_midpoint',edgeId);
    edges.push({edgeId,startIndex:i,endIndex:j,
      startHandleId:view.handles[i].handleId,
      endHandleId:view.handles[j].handleId,
      start:{...start},end:{...end},midpoint,normal,lengthMm});
  }
  return {kind:'contour_edges',version:1,sourceSignature:signature,
    contourId,selection:view.selection,edges,solverStatus:view.solverStatus,
    degreesOfFreedom:view.degreesOfFreedom,diagnostics:view.diagnostics,...flags};
}

/**
 * Move exactly the two endpoints of a selected edge in its sketch-local
 * outward normal direction. In particular, when vertex 0 is moved, explicitly
 * re-author ALL unaffected vertices: the v1 datum translation semantics must
 * not accidentally move an entire polygon while changing one edge.
 */
export function planClosedContourEdgeOffset(source,selection,request){
  const view=inspectClosedContourEdges(source,selection,request?.contourId);
  if(view.kind!=='contour_edges')return view;
  const stamp=view.sourceSignature;
  if(!exact(request,['kind','version','sourceSignature','contourId','edgeId','offsetMm'])||
     request.kind!=='offset-closed-contour-edge'||request.version!==1||
     request.contourId!==view.contourId||typeof request.edgeId!=='string'||
     !finite(request.offsetMm))
    return refuse(stamp,'invalid_offset_command');
  if(request.sourceSignature!==stamp)return refuse(stamp,'stale_source');
  if(request.offsetMm===0)return refuse(stamp,'no_change');
  const edge=view.edges.find(e=>e.edgeId===request.edgeId);
  if(!edge)return refuse(stamp,'edge_not_in_selected_contour',request.edgeId);
  const delta=scale(edge.normal,request.offsetMm);
  if(!validPoint(delta))return refuse(stamp,'unrepresentable_offset',edge.edgeId);
  const doc=createSketch(source);
  const points=new Map(doc.points.map(p=>[p.id,p]));
  // The inspected vertices are solved positions, not stale document seeds.
  const handles=view.edges.map(e=>({index:e.startIndex,
    handleId:e.startHandleId,pointId:e.edgeId.replace(/:edge:\d+$/,':vertex:'+e.startIndex),
    position:e.start}));
  const targets=handles.map(h=>({...h.position}));
  targets[edge.startIndex]=add(targets[edge.startIndex],delta);
  targets[edge.endIndex]=add(targets[edge.endIndex],delta);
  if(targets.some(p=>!validPoint(p)))
    return refuse(stamp,'unrepresentable_offset',edge.edgeId);
  // The sketch v1 origin is an anchored datum: its movement would translate
  // otherwise unmentioned vertices. Supply explicit unchanged coordinates
  // for all others to preserve strict two-endpoint semantics.
  const movedDatum=edge.startIndex===0||edge.endIndex===0;
  const changes=targets.map((p,i)=>({index:i,xMm:p.x,yMm:p.y}))
    .filter(c=>movedDatum||c.index===edge.startIndex||
      c.index===edge.endIndex);
  const editCommand={kind:'edit-closed-contour-vertices',version:1,
    sourceSignature:stamp,contourId:view.contourId,changes};
  const accepted=editClosedContourVertices(doc,selection,editCommand);
  if(accepted.kind!=='accepted')return accepted;
  const next=inspectClosedContourEdges(accepted.sketch,accepted.selection,
    view.contourId);
  if(next.kind!=='contour_edges')
    return refuse(stamp,'post_offset_inspection_failed',next.reason??null);
  const successor=next.edges.find(e=>e.edgeId===edge.edgeId);
  if(!successor)return refuse(stamp,'successor_edge_missing',edge.edgeId);
  const applied= sub(successor.midpoint,edge.midpoint);
  const appliedOffsetMm=dot(applied,edge.normal);
  const residualMm=Math.hypot(applied.x-delta.x,applied.y-delta.y);
  if(!finite(appliedOffsetMm)||!finite(residualMm))
    return refuse(stamp,'unrepresentable_applied_offset',edge.edgeId);
  return {kind:'planned_edge_offset',version:1,sourceSignature:stamp,
    nextSourceSignature:accepted.nextSourceSignature,
    contourId:view.contourId,edgeId:edge.edgeId,
    offsetMm:request.offsetMm,appliedOffsetMm,residualMm,
    from:edge,to:successor,editCommand,acceptance:accepted,...flags};
}

/**
 * Convert a sketch-local pointer location to a signed outward edge offset.
 * The pointer is projected on the edge normal at its midpoint; any tangential
 * error is reported for presentation, never silently changed in the source.
 */
export function dragClosedContourEdge(source,selection,gesture){
  const view=inspectClosedContourEdges(source,selection,gesture?.contourId);
  if(view.kind!=='contour_edges')return view;
  const stamp=view.sourceSignature;
  if(!exact(gesture,['version','sourceSignature','contourId','edgeId','target'])||
      gesture.version!==1||gesture.contourId!==view.contourId||
      typeof gesture.edgeId!=='string'||!validPoint(gesture.target))
    return refuse(stamp,'invalid_edge_gesture');
  if(gesture.sourceSignature!==stamp)return refuse(stamp,'stale_source');
  const edge=view.edges.find(e=>e.edgeId===gesture.edgeId);
  if(!edge)return refuse(stamp,'edge_not_in_selected_contour',gesture.edgeId);
  const pointerDelta=sub(gesture.target,edge.midpoint);
  const offsetMm=dot(pointerDelta,edge.normal);
  if(!finite(offsetMm))return refuse(stamp,'unrepresentable_offset',edge.edgeId);
  const planned=planClosedContourEdgeOffset(source,selection,{
    kind:'offset-closed-contour-edge',version:1,sourceSignature:stamp,
    contourId:view.contourId,edgeId:edge.edgeId,offsetMm
  });
  if(planned.kind!=='planned_edge_offset')return planned;
  const projection=add(edge.midpoint,scale(edge.normal,offsetMm));
  return {...planned,gesture:{
    edgeId:edge.edgeId,requested:{...gesture.target},
    projected:projection,applied:{...planned.to.midpoint},
    tangentialDeviationMm:Math.hypot(gesture.target.x-projection.x,
      gesture.target.y-projection.y),
    appliedDeviationMm:Math.hypot(gesture.target.x-planned.to.midpoint.x,
      gesture.target.y-planned.to.midpoint.y)
  }};
}
