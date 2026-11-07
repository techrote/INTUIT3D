/**
 * Dimensioned two-hole plate whose mounting holes follow the actual solved
 * rectangle edges. It is a sketch/profile contract, not a native solid.
 */
import {createSketch,validateSketch,serializeSketch,solveSketch,editConstraint,buildPlateProfile} from './index.mjs';

export const CENTERED_HOLE_PLATE_VERSION=1;
export const CENTERED_HOLE_PLATE_FORMAT='intuit3d.centered-hole-plate';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validId=id=>typeof id==='string'&&/^[A-Za-z][\w:.-]{0,63}$/.test(id);
const ids=id=>({
  p0:id+':p0',p1:id+':p1',p2:id+':p2',p3:id+':p3',mid:id+':mid',
  ca:id+':holeA:center',cb:id+':holeB:center',a:id+':holeA',b:id+':holeB',
  bottom:id+':bottom',right:id+':right',top:id+':top',left:id+':left',
  anchor:id+':anchor',width:id+':width',height:id+':height',midpoint:id+':midpoint',
  insetA:id+':leftInset',insetB:id+':rightInset',
  centerA:id+':holeA:centerline',centerB:id+':holeB:centerline',
  radiusA:id+':holeA:radius',radiusB:id+':holeB:radius'
});
const dimensions=n=>({
  widthMm:n.width,heightMm:n.height,leftInsetMm:n.insetA,
  rightInsetMm:n.insetB,holeARadiusMm:n.radiusA,holeBRadiusMm:n.radiusB
});
const required=request=>{
  if(!request||typeof request!=='object'||Array.isArray(request)||!validId(request.id))
    throw new TypeError('centered plate: invalid semantic ID');
  const {widthMm:w,heightMm:h,leftInsetMm:a,rightInsetMm:b,
    holeARadiusMm:ra,holeBRadiusMm:rb}=request;
  const x=request.originXmm??0,y=request.originYmm??0;
  if(![w,h,a,b,ra,rb,x,y].every(finite)||
    ![w,h,a,b,ra,rb].every(v=>v>0)||
    ![x+w,y+h,x+a,x+w-b,y+h/2].every(finite))
    throw new TypeError('centered plate: finite positive dimensions required');
  return {id:request.id,widthMm:w,heightMm:h,leftInsetMm:a,rightInsetMm:b,
    holeARadiusMm:ra,holeBRadiusMm:rb,originXmm:x,originYmm:y};
};

/**
 * Two hole locations are dimensioned from opposite plate edges. A dedicated
 * construction midpoint constrains the hole row to the middle of the plate.
 * This survives retrospective width/height changes without screen-side math.
 */
export function createCenteredHolePlate(request){
  const d=required(request),n=ids(d.id);
  const x=d.originXmm,y=d.originYmm,w=d.widthMm,h=d.heightMm;
  return createSketch({version:1,units:'mm',points:[
    {id:n.p0,x,y},{id:n.p1,x:x+w,y},{id:n.p2,x:x+w,y:y+h},
    {id:n.p3,x,y:y+h},{id:n.mid,x,y:y+h/2},
    {id:n.ca,x:x+d.leftInsetMm,y:y+h/2},
    {id:n.cb,x:x+w-d.rightInsetMm,y:y+h/2}
  ],lines:[
    {id:n.bottom,start:n.p0,end:n.p1},
    {id:n.right,start:n.p1,end:n.p2},
    {id:n.top,start:n.p2,end:n.p3},
    {id:n.left,start:n.p3,end:n.p0}
  ],circles:[
    {id:n.a,center:n.ca,radius:d.holeARadiusMm},
    {id:n.b,center:n.cb,radius:d.holeBRadiusMm}
  ],constraints:[
    {id:n.anchor,kind:'fixed',point:n.p0,x,y},
    {id:d.id+':horizontal-bottom',kind:'horizontal',line:n.bottom},
    {id:d.id+':horizontal-top',kind:'horizontal',line:n.top},
    {id:d.id+':vertical-left',kind:'vertical',line:n.left},
    {id:d.id+':vertical-right',kind:'vertical',line:n.right},
    {id:n.width,kind:'distanceX',a:n.p0,b:n.p1,value:w},
    {id:n.height,kind:'distanceY',a:n.p1,b:n.p2,value:h},
    {id:n.midpoint,kind:'midpoint',point:n.mid,a:n.p0,b:n.p3},
    {id:n.insetA,kind:'distanceX',a:n.p0,b:n.ca,value:d.leftInsetMm},
    {id:n.insetB,kind:'distanceX',a:n.cb,b:n.p1,value:d.rightInsetMm},
    {id:n.centerA,kind:'distanceY',a:n.mid,b:n.ca,value:0},
    {id:n.centerB,kind:'distanceY',a:n.mid,b:n.cb,value:0},
    {id:n.radiusA,kind:'radius',circle:n.a,value:d.holeARadiusMm},
    {id:n.radiusB,kind:'radius',circle:n.b,value:d.holeBRadiusMm}
  ]});
}
function resolveDimensions(doc,id){
  const n=ids(id),map=new Map(doc.constraints.map(c=>[c.id,c]));
  const refs=dimensions(n),out={};
  const shapes={
    widthMm:c=>c.kind==='distanceX'&&c.a===n.p0&&c.b===n.p1,
    heightMm:c=>c.kind==='distanceY'&&c.a===n.p1&&c.b===n.p2,
    leftInsetMm:c=>c.kind==='distanceX'&&c.a===n.p0&&c.b===n.ca,
    rightInsetMm:c=>c.kind==='distanceX'&&c.a===n.cb&&c.b===n.p1,
    holeARadiusMm:c=>c.kind==='radius'&&c.circle===n.a,
    holeBRadiusMm:c=>c.kind==='radius'&&c.circle===n.b
  };
  for(const [name,ref] of Object.entries(refs)){
    const c=map.get(ref);
    if(!c||!shapes[name](c))
      throw new TypeError('centered plate: missing or rewritten dimension '+name);
    out[name]=c.value;
  }
  return out;
}
function hasDependencies(doc,id){
  const n=ids(id),cs=new Map(doc.constraints.map(c=>[c.id,c]));
  const m=cs.get(n.midpoint),a=cs.get(n.centerA),b=cs.get(n.centerB);
  return !!m&&m.kind==='midpoint'&&m.point===n.mid&&m.a===n.p0&&m.b===n.p3&&
    !!a&&a.kind==='distanceY'&&a.a===n.mid&&a.b===n.ca&&a.value===0&&
    !!b&&b.kind==='distanceY'&&b.a===n.mid&&b.b===n.cb&&b.value===0;
}
function availableHandles(id,solved,d){
  const n=ids(id),points=new Map(solved.geometry.points.map(p=>[p.id,p]));
  const p0=points.get(n.p0),p1=points.get(n.p1),p3=points.get(n.p3);
  const a=points.get(n.ca),b=points.get(n.cb);
  const item=(dimension,axis,p)=>({
    id:id+':handle:'+dimension,dimension,axis,
    position:{x:p.x,y:p.y},valueMm:d[dimension]
  });
  return [
    item('widthMm','x',p1),item('heightMm','y',p3),
    item('leftInsetMm','x',a),item('rightInsetMm','x',b),
    item('holeARadiusMm','x',{x:a.x+d.holeARadiusMm,y:a.y}),
    item('holeBRadiusMm','x',{x:b.x+d.holeBRadiusMm,y:b.y})
  ];
}
export function inspectCenteredHolePlate(source,id){
  if(!validId(id))throw new TypeError('centered plate: invalid profile ID');
  const doc=validateSketch(source),n=ids(id),stamp=serializeSketch(doc);
  const d=resolveDimensions(doc,id),solution=solveSketch(doc);
  let profile=null,reason=null;
  if(!hasDependencies(doc,id))reason='missing or altered midpoint/centerline dependency';
  else if(solution.status!=='solved')reason='sketch '+solution.status;
  else{
    try{profile=buildPlateProfile(doc,solution,
      [n.bottom,n.right,n.top,n.left],[n.a,n.b]);}
    catch(error){reason=String(error?.message||error);}
  }
  const status=profile?'solved':reason?.startsWith('missing or altered')?
    'dependency_broken':solution.status==='solved'?'profile_rejected':solution.status;
  return {format:CENTERED_HOLE_PLATE_FORMAT,version:1,
    sourceSignature:stamp,profileId:id+':profile',status,reason,
    dimensions:d,solution,profile,
    handles:profile?availableHandles(id,solution,d):[],
    previewOnly:true,nativeExact:false};
}
/** Return an authored edit even when profile-invalid so it remains repairable. */
export function editCenteredHolePlateDimension(source,id,request){
  const doc=validateSketch(source),old=serializeSketch(doc);
  const refuse=reason=>({kind:'refused',format:CENTERED_HOLE_PLATE_FORMAT,
    version:1,sourceSignature:old,reason});
  if(!request||request.version!==1||request.expectedSignature!==old)
    return refuse('stale or malformed document revision');
  const n=ids(id),lookup=dimensions(n);
  if(!Object.hasOwn(lookup,request.dimension)||!finite(request.valueMm))
    return refuse('unknown or invalid dimension');
  try{
    resolveDimensions(doc,id);
    const sketch=editConstraint(doc,lookup[request.dimension],{value:request.valueMm});
    const view=inspectCenteredHolePlate(sketch,id);
    return {kind:'accepted',format:CENTERED_HOLE_PLATE_FORMAT,version:1,
      previousSignature:old,sourceSignature:view.sourceSignature,
      sketch,status:view.status,dimensions:view.dimensions,solution:view.solution,
      profile:view.profile,diagnostics:view.solution.diagnostics,reason:view.reason,
      handles:view.handles,previewOnly:true,nativeExact:false};
  }catch(error){return refuse(String(error?.message||error));}
}
export function dragCenteredHolePlateHandle(source,id,request){
  const v=inspectCenteredHolePlate(source,id);
  const refuse=reason=>({kind:'refused',format:CENTERED_HOLE_PLATE_FORMAT,
    version:1,sourceSignature:v.sourceSignature,reason});
  if(!request||request.version!==1||
    request.expectedSignature!==v.sourceSignature||!request.target||
    !finite(request.target.x)||!finite(request.target.y))
    return refuse('stale or malformed pointer request');
  if(v.status!=='solved')return refuse('solve or repair profile before dragging');
  const h=v.handles.find(h=>h.id===request.handleId);
  if(!h)return refuse('unknown or unavailable handle');
  const n=ids(id),points=new Map(v.solution.geometry.points.map(p=>[p.id,p]));
  const p0=points.get(n.p0),p1=points.get(n.p1),
    ca=points.get(n.ca),cb=points.get(n.cb),t=request.target;
  const value={
    widthMm:t.x-p0.x,heightMm:t.y-p0.y,
    leftInsetMm:t.x-p0.x,rightInsetMm:p1.x-t.x,
    holeARadiusMm:t.x-ca.x,holeBRadiusMm:t.x-cb.x
  }[h.dimension];
  if(!finite(value))return refuse('unrepresentable dragged dimension');
  const result=editCenteredHolePlateDimension(source,id,{
    version:1,expectedSignature:v.sourceSignature,
    dimension:h.dimension,valueMm:value
  });
  if(result.kind!=='accepted')return result;
  const after=inspectCenteredHolePlate(result.sketch,id);
  const applied=after.handles.find(x=>x.id===h.id)?.position??null;
  return {...result,gesture:{handleId:h.id,target:{x:t.x,y:t.y},
    appliedPoint:applied,
    deviationMm:applied?Math.hypot(applied.x-t.x,applied.y-t.y):null}};
}
