/**
 * A real solved, dimensional obround/slot profile. The source is an authored
 * arc-sketch, not a hand-drawn mesh or a second CAD history. Consumers may
 * submit the analytic curves to KERNEL, which must independently validate
 * their B-rep and STEP results.
 */
import {createArcSketch,serializeArcSketch,solveArcSketch} from './arc-constraints.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';

export const OBROUND_SLOT_VERSION=1;
export const OBROUND_SLOT_FORMAT='intuit3d.obround-slot';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validId=id=>typeof id==='string'&&/^[A-Za-z][\w:.-]{0,95}$/.test(id);
const fail=message=>{throw new TypeError('obround slot: '+message);};
const ids=id=>({
  lc:id+':left-center',rc:id+':right-center',
  lt:id+':lower-left',rt:id+':lower-right',
  rb:id+':upper-right',lb:id+':upper-left',
  top:id+':lower-edge',bottom:id+':upper-edge',
  right:id+':right-cap',left:id+':left-cap',
  anchor:id+':anchor',span:id+':center-span',
  axis:id+':center-axis',radius:id+':radius',
  equal:id+':equal-caps',lower:id+':lower-horizontal',
  upper:id+':upper-horizontal'
});
const dimensions=({id,overallLengthMm,diameterMm,originXmm=0,originYmm=0})=>{
  if(!validId(id)||!finite(overallLengthMm)||!finite(diameterMm)||
     !finite(originXmm)||!finite(originYmm)||diameterMm<=0||
     overallLengthMm<=diameterMm ||
     !finite(overallLengthMm-diameterMm)||
     !finite(originXmm+overallLengthMm)||!finite(originYmm+diameterMm))
    fail('a finite positive diameter and a longer finite slot are required');
  return {id,overallLengthMm,diameterMm,originXmm,originYmm};
};

/** Authored tangent semicircles with a changeable span and cap radius. */
export function createObroundSlot(request){
  const {id,overallLengthMm:L,diameterMm:D,originXmm:x,originYmm:y}=dimensions(request);
  const n=ids(id),r=D/2,a=x+r,b=x+L-r,c=y+r;
  if(![r,a,b,c].every(finite)||r<=0||!(b>a))
    fail('slot dimension arithmetic is not representable');
  const points=[
    {id:n.lc,x:a,y:c},{id:n.rc,x:b,y:c},
    {id:n.lt,x:a,y},{id:n.rt,x:b,y},
    {id:n.rb,x:b,y:y+D},{id:n.lb,x:a,y:y+D}
  ];
  const lines=[{id:n.top,start:n.lt,end:n.rt},
    {id:n.bottom,start:n.rb,end:n.lb}];
  const arcs=[{id:n.right,center:n.rc,start:n.rt,end:n.rb,direction:'ccw'},
    {id:n.left,center:n.lc,start:n.lb,end:n.lt,direction:'ccw'}];
  const constraints=[
    {id:n.anchor,kind:'fixed',point:n.lc,x:a,y:c},
    {id:n.span,kind:'distanceX',a:n.lc,b:n.rc,value:L-D},
    {id:n.axis,kind:'distanceY',a:n.lc,b:n.rc,value:0},
    {id:n.lower,kind:'horizontal',line:n.top},
    {id:n.upper,kind:'horizontal',line:n.bottom},
    {id:n.radius,kind:'arcRadius',arc:n.left,value:r},
    {id:n.equal,kind:'equalArcRadius',a:n.left,b:n.right},
    {id:id+':right-in',kind:'tangent',arc:n.right,line:n.top,at:'start'},
    {id:id+':right-out',kind:'tangent',arc:n.right,line:n.bottom,at:'end'},
    {id:id+':left-in',kind:'tangent',arc:n.left,line:n.bottom,at:'start'},
    {id:id+':left-out',kind:'tangent',arc:n.left,line:n.top,at:'end'}
  ];
  return createArcSketch({format:'intuit3d.arc-sketch',version:1,units:'mm',
    points,lines,arcs,circles:[],constraints});
}
function authoredDimensions(source,id){
  const doc=createArcSketch(source),n=ids(id);
  const byId=k=>doc.constraints.find(c=>c.id===k);
  const anchor=byId(n.anchor),span=byId(n.span),radius=byId(n.radius);
  if(!anchor||anchor.kind!=='fixed'||anchor.point!==n.lc||
     !span||span.kind!=='distanceX'||span.a!==n.lc||span.b!==n.rc||
     !radius||radius.kind!=='arcRadius'||radius.arc!==n.left)
    fail('not a supported authored slot');
  const D=2*radius.value,L=span.value+D;
  const request={id,overallLengthMm:L,diameterMm:D,
    originXmm:anchor.x-radius.value,originYmm:anchor.y-radius.value};
  // Do not replace arbitrary user-authored constraints or appended geometry
  // by recreating a template: only this dedicated v1 slot may be reparameterized.
  if(serializeArcSketch(createObroundSlot(request))!==serializeArcSketch(doc))
    fail('slot contains independent authored edits; preserve and solve them separately');
  return request;
}
const boundary=id=>{
  const n=ids(id);
  return [n.top,n.right,n.bottom,n.left];
};
function assessed(doc,id){
  const solution=solveArcSketch(doc);
  if(solution.status!=='solved')return {solution,profile:null,
    reason:'solver status '+solution.status};
  try{
    const profile=prepareArcProfileForProvider(doc,solution,
      {profileId:id+':profile',boundaryIds:boundary(id),holeIds:[]});
    return {solution,profile,reason:null};
  }catch(error){return {solution,profile:null,reason:String(error?.message||error)};}
}

/** Solved controls and genuine analytic area; never native-exact status. */
export function inspectObroundSlot(source,id){
  if(!validId(id))fail('invalid slot ID');
  const request=authoredDimensions(source,id),doc=createArcSketch(source);
  const stamp=serializeArcSketch(doc),{solution,profile,reason}=assessed(doc,id);
  return {format:OBROUND_SLOT_FORMAT,version:1,sourceSignature:stamp,
    dimensions:request,status:profile?'solved':solution.status,
    reason,diagnostics:solution.diagnostics,profile,previewOnly:true};
}

/**
 * Propose one revision-fenced edit. The intent journal may commit accepted
 * sketch bytes as ONE operation; refusal never mutates caller input.
 */
export function editObroundSlot(source,id,change,expectedSignature){
  const doc=createArcSketch(source),stamp=serializeArcSketch(doc);
  const refuse=reason=>({kind:'refused',format:OBROUND_SLOT_FORMAT,
    version:1,sourceSignature:stamp,reason});
  if(typeof expectedSignature!=='string'||stamp!==expectedSignature)
    return refuse('stale slot revision');
  try{
    const original=authoredDimensions(doc,id);
    let request;
    if(change&&change.kind==='resize'&&
       Object.keys(change).sort().join('|')==='diameterMm|kind|overallLengthMm')
      request={...original,overallLengthMm:change.overallLengthMm,
        diameterMm:change.diameterMm};
    else if(change&&change.kind==='move'&&
       Object.keys(change).sort().join('|')==='kind|originXmm|originYmm')
      request={...original,originXmm:change.originXmm,originYmm:change.originYmm};
    else return refuse('unsupported or malformed slot edit');
    const sketch=createObroundSlot(request),{solution,profile,reason}=assessed(sketch,id);
    if(!profile)return refuse('edited profile not solved/admitted: '+reason);
    return {kind:'accepted',format:OBROUND_SLOT_FORMAT,version:1,
      sketch,solution,profile,sourceSignature:serializeArcSketch(sketch),
      dimensions:request,previewOnly:true};
  }catch(error){return refuse(String(error?.message||error));}
}
