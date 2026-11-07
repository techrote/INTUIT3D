/**
 * Independent Y offsets for a solved two-hole mounting plate.
 *
 * Additive v2 companion to centered-hole-plate/v1: the two centreline
 * distanceY dimensions remain tied to the *solved* construction midpoint,
 * but can be edited independently. Native/STEP authority is NOT implied.
 */
import {
  validateSketch, serializeSketch, solveSketch, editConstraint, buildPlateProfile
} from './index.mjs';
import {createCenteredHolePlate} from './centered-hole-plate.mjs';

export const OFFSET_HOLE_PLATE_VERSION = 2;
export const OFFSET_HOLE_PLATE_FORMAT = 'intuit3d.centered-hole-plate-offsets';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const validId = id => typeof id === 'string' && /^[A-Za-z][\w:.-]{0,63}$/.test(id);
const names = [
  'widthMm', 'heightMm', 'leftInsetMm', 'rightInsetMm',
  'holeARadiusMm', 'holeBRadiusMm', 'holeAYOffsetMm', 'holeBYOffsetMm'
];
const refs = id => ({
  p0:id+':p0',p1:id+':p1',p3:id+':p3',mid:id+':mid',
  ca:id+':holeA:center',cb:id+':holeB:center',
  a:id+':holeA',b:id+':holeB',
  bottom:id+':bottom',right:id+':right',top:id+':top',left:id+':left',
  midpoint:id+':midpoint'
});
const constraints = id => ({
  widthMm:id+':width',heightMm:id+':height',
  leftInsetMm:id+':leftInset',rightInsetMm:id+':rightInset',
  holeARadiusMm:id+':holeA:radius',holeBRadiusMm:id+':holeB:radius',
  holeAYOffsetMm:id+':holeA:centerline',holeBYOffsetMm:id+':holeB:centerline'
});
const refusal = (signature,reason) => ({
  kind:'refused',format:OFFSET_HOLE_PLATE_FORMAT,version:2,
  sourceSignature:signature,reason
});

/**
 * Build the v1 authored constraint graph, then dimension its independent
 * vertical hole offsets. No geometry is moved by rewriting solver output.
 */
export function createOffsetHolePlate(request){
  if(!request || !finite(request.holeAYOffsetMm??0) ||
     !finite(request.holeBYOffsetMm??0))
    throw new TypeError('offset plate: nonfinite hole offset');
  const source=createCenteredHolePlate(request),c=constraints(request.id);
  return editConstraint(
    editConstraint(source,c.holeAYOffsetMm,{value:request.holeAYOffsetMm??0}),
    c.holeBYOffsetMm,{value:request.holeBYOffsetMm??0});
}

function dimensionsOf(doc,id){
  const n=refs(id),c=constraints(id),byId=new Map(doc.constraints.map(x=>[x.id,x]));
  const shape={
    widthMm:x=>x.kind==='distanceX'&&x.a===n.p0&&x.b===n.p1,
    heightMm:x=>x.kind==='distanceY'&&x.a===n.p1&&x.b===id+':p2',
    leftInsetMm:x=>x.kind==='distanceX'&&x.a===n.p0&&x.b===n.ca,
    rightInsetMm:x=>x.kind==='distanceX'&&x.a===n.cb&&x.b===n.p1,
    holeARadiusMm:x=>x.kind==='radius'&&x.circle===n.a,
    holeBRadiusMm:x=>x.kind==='radius'&&x.circle===n.b,
    holeAYOffsetMm:x=>x.kind==='distanceY'&&x.a===n.mid&&x.b===n.ca,
    holeBYOffsetMm:x=>x.kind==='distanceY'&&x.a===n.mid&&x.b===n.cb
  };
  const dimensions={};
  for(const name of names){
    const item=byId.get(c[name]);
    if(!item||!shape[name](item)||!finite(item.value))
      throw new TypeError('offset plate: missing or rewritten dimension '+name);
    dimensions[name]=item.value;
  }
  const mid=byId.get(n.midpoint);
  const dependenciesValid=!!mid&&mid.kind==='midpoint'&&
    mid.point===n.mid&&mid.a===n.p0&&mid.b===n.p3;
  return {dimensions,dependenciesValid};
}
function handlesFor(id,solution,d){
  const n=refs(id),points=new Map(solution.geometry.points.map(x=>[x.id,x]));
  const p0=points.get(n.p0),p1=points.get(n.p1),p3=points.get(n.p3),
    a=points.get(n.ca),b=points.get(n.cb);
  const dimension=(name,axis,p)=>({
    id:id+':handle:'+name,kind:'dimension',dimension:name,axis,
    position:{x:p.x,y:p.y},valueMm:d[name]
  });
  const center=(name,p)=>({
    id:id+':handle:'+name,kind:'hole_center',hole:name,
    position:{x:p.x,y:p.y},valueMm:null
  });
  return [
    dimension('widthMm','x',p1),dimension('heightMm','y',p3),
    dimension('leftInsetMm','x',a),dimension('rightInsetMm','x',b),
    dimension('holeARadiusMm','x',{x:a.x+d.holeARadiusMm,y:a.y}),
    dimension('holeBRadiusMm','x',{x:b.x+d.holeBRadiusMm,y:b.y}),
    dimension('holeAYOffsetMm','y',a),dimension('holeBYOffsetMm','y',b),
    center('A',a),center('B',b)
  ];
}

/** Inspect solver-derived geometry, not potentially stale authored seed points. */
export function inspectOffsetHolePlate(source,id){
  if(!validId(id))throw new TypeError('offset plate: invalid semantic ID');
  const doc=validateSketch(source),stamp=serializeSketch(doc),
    n=refs(id),{dimensions,dependenciesValid}=dimensionsOf(doc,id),
    solution=solveSketch(doc);
  let profile=null,reason=null;
  if(!dependenciesValid)
    reason='missing or altered midpoint dependency';
  else if(solution.status!=='solved')
    reason='sketch '+solution.status;
  else{
    try{
      profile=buildPlateProfile(doc,solution,
        [n.bottom,n.right,n.top,n.left],[n.a,n.b]);
    }catch(error){reason=String(error?.message||error);}
  }
  const status=profile?'solved':!dependenciesValid?'dependency_broken':
    solution.status==='solved'?'profile_rejected':solution.status;
  return {
    format:OFFSET_HOLE_PLATE_FORMAT,version:2,
    sourceSignature:stamp,profileId:id+':profile',
    dimensions,status,reason,solution,profile,
    handles:profile?handlesFor(id,solution,dimensions):[],
    previewOnly:true,nativeExact:false
  };
}

/**
 * One revision-fenced, immutable authored transaction, even when two hole
 * dimensions are edited simultaneously. Profile-invalid intent stays editable.
 */
export function editOffsetHolePlateDimensions(source,id,request){
  const doc=validateSketch(source),old=serializeSketch(doc);
  if(!request||request.version!==2||request.expectedSignature!==old)
    return refusal(old,'stale or malformed document revision');
  const changes=request.changes;
  if(!changes||typeof changes!=='object'||Array.isArray(changes))
    return refusal(old,'invalid dimension changes');
  const keys=Object.keys(changes);
  if(!keys.length||keys.some(name=>!names.includes(name)||!finite(changes[name])))
    return refusal(old,'unknown or nonfinite dimension');
  try{
    dimensionsOf(doc,id); // Guard shape/semantic identity before any authored edit.
    const c=constraints(id);
    let next=doc;
    for(const name of names){
      if(Object.hasOwn(changes,name))
        next=editConstraint(next,c[name],{value:changes[name]});
    }
    const view=inspectOffsetHolePlate(next,id);
    return {
      kind:'accepted',format:OFFSET_HOLE_PLATE_FORMAT,version:2,
      previousSignature:old,sourceSignature:view.sourceSignature,
      sketch:next,status:view.status,dimensions:view.dimensions,
      solution:view.solution,profile:view.profile,reason:view.reason,
      diagnostics:view.solution.diagnostics,handles:view.handles,
      previewOnly:true,nativeExact:false
    };
  }catch(error){return refusal(old,String(error?.message||error));}
}

/**
 * Pointer targets are model-plane millimetres, not screen pixels. The center
 * handles author X inset and Y offset together; a single journal command can
 * commit the returned sketch. Revision and handle identity are always checked.
 */
export function dragOffsetHolePlateHandle(source,id,request){
  const view=inspectOffsetHolePlate(source,id);
  const refuse=reason=>refusal(view.sourceSignature,reason);
  if(!request||request.version!==2||
     request.expectedSignature!==view.sourceSignature||
     !request.target||!finite(request.target.x)||!finite(request.target.y))
    return refuse('stale or malformed pointer request');
  if(view.status!=='solved')
    return refuse('solve or repair profile before pointer drag');
  const handle=view.handles.find(h=>h.id===request.handleId);
  if(!handle)return refuse('unknown or unavailable handle');
  const n=refs(id),pts=new Map(view.solution.geometry.points.map(p=>[p.id,p]));
  const p0=pts.get(n.p0),p1=pts.get(n.p1),
    mid=pts.get(n.mid),a=pts.get(n.ca),b=pts.get(n.cb),
    t=request.target;
  const values={
    widthMm:t.x-p0.x,heightMm:t.y-p0.y,
    leftInsetMm:t.x-p0.x,rightInsetMm:p1.x-t.x,
    holeARadiusMm:t.x-a.x,holeBRadiusMm:t.x-b.x,
    holeAYOffsetMm:t.y-mid.y,holeBYOffsetMm:t.y-mid.y
  };
  const changes=handle.kind==='hole_center'?
    handle.hole==='A'?
      {leftInsetMm:values.leftInsetMm,holeAYOffsetMm:values.holeAYOffsetMm}:
      {rightInsetMm:values.rightInsetMm,holeBYOffsetMm:values.holeBYOffsetMm}:
    {[handle.dimension]:values[handle.dimension]};
  if(Object.values(changes).some(v=>!finite(v)))
    return refuse('unrepresentable dragged dimension');
  const result=editOffsetHolePlateDimensions(source,id,{
    version:2,expectedSignature:view.sourceSignature,changes
  });
  if(result.kind==='refused')return result;
  const applied=result.handles.find(h=>h.id===handle.id)?.position??null;
  return {...result,gesture:{
    handleId:handle.id,target:{x:t.x,y:t.y},appliedPoint:applied,
    deviationMm:applied?Math.hypot(applied.x-t.x,applied.y-t.y):null
  }};
}
