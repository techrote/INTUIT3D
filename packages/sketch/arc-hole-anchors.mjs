/**
 * SKETCH v1: a hole centre constrained to an authored reference point.
 * The X/Y offset dimensions live in the existing solver document; no parallel
 * pattern cache, browser authority, or approximate/native geometry is created.
 * A caller commits one accepted sketch+selection through INTENT/RUNTIME.
 */
import {createArcSketch,serializeArcSketch,solveArcSketch} from './arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection} from './arc-hole-authoring.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';

export const ARC_HOLE_ANCHORS_VERSION=1;
export const ARC_HOLE_ANCHORS_FORMAT='intuit3d.arc-hole-anchors';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validId=id=>typeof id==='string'&&/^[A-Za-z][\w:.-]{0,127}$/.test(id);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const stamps=(doc,selection)=>({
  sourceSignature:serializeArcSketch(doc),
  selectionSignature:serializeArcHoleSelection(selection)
});
const fail=message=>{throw new TypeError('sketch hole anchors: '+message);};
const pointOf=(solution,id)=>solution.geometry?.points.find(p=>p.id===id);
const xy=(point)=>({xMm:point.x,yMm:point.y});

function describe(doc,selection,id){
  if(!validId(id)||!selection.holeIds.includes(id))
    return {mode:'unsupported',reason:'circle is not selected as a hole'};
  const circle=doc.circles.find(c=>c.id===id);
  if(!circle)return {mode:'unsupported',reason:'selected circle is missing'};
  const center=doc.points.find(p=>p.id===circle.center);
  const refs=doc.constraints.filter(c=>c.point===circle.center||
    c.a===circle.center||c.b===circle.center);
  const shared=doc.lines.some(l=>l.start===circle.center||l.end===circle.center)||
    doc.arcs.some(a=>[a.start,a.end,a.center].includes(circle.center))||
    doc.circles.some(c=>c.id!==id&&c.center===circle.center);
  if(shared)return {mode:'unsupported',reason:'centre is shared with other authored geometry'};
  if(refs.length===1&&refs[0].kind==='fixed'&&refs[0].point===circle.center)
    return {mode:'fixed',centerPointId:center.id,fixedConstraintId:refs[0].id};
  if(refs.length===2){
    const x=refs.find(c=>c.kind==='distanceX'&&c.b===circle.center);
    const y=refs.find(c=>c.kind==='distanceY'&&c.b===circle.center);
    if(x&&y&&x.a===y.a&&x.a!==circle.center&&
       doc.points.some(p=>p.id===x.a))
      return {mode:'anchored',centerPointId:center.id,
        anchorPointId:x.a,xConstraintId:x.id,yConstraintId:y.id,
        offsetXMm:x.value,offsetYMm:y.value};
  }
  return {mode:'unsupported',reason:'centre has unsupported or contradictory dependencies'};
}

/** Inspect even an unsolved sketch so numeric recovery controls do not vanish. */
export function inspectArcHoleAnchor(source,selected,circleId){
  const doc=createArcSketch(source),selection=createArcHoleSelection(selected);
  const binding=describe(doc,selection,circleId);
  const solved=solveArcSketch(doc),center=doc.circles.find(c=>c.id===circleId)?.center;
  const position=pointOf(solved,center)||doc.points.find(p=>p.id===center);
  return {format:ARC_HOLE_ANCHORS_FORMAT,version:1,...stamps(doc,selection),
    profileId:selection.profileId,circleId,mode:binding.mode,
    reason:binding.reason||null,canEdit:binding.mode!=='unsupported',
    binding:binding.mode==='anchored'?{
      anchorPointId:binding.anchorPointId,
      xConstraintId:binding.xConstraintId,yConstraintId:binding.yConstraintId,
      offsetXMm:binding.offsetXMm,offsetYMm:binding.offsetYMm
    }:null,
    fixedConstraintId:binding.fixedConstraintId||null,
    centerPointId:binding.centerPointId||null,
    handleId:'hole-center:'+circleId,
    position:position?xy(position):null,
    solverStatus:solved.status,diagnostics:solved.diagnostics,
    previewOnly:true,nativeExact:false};
}

/**
 * Bind preserves the *solved* centre while switching fixed XY to relative
 * signed X/Y dimensions. Rebind preserves its physical position. Drag/edit
 * changes dimensions rather than secretly overriding dependent constraints.
 * Detach freezes the current solved centre. Original fixed ID is reused for
 * the X dimension, then restored, preserving inspectable journal identity.
 */
export function proposeArcHoleAnchor(source,selected,command,expected){
  const doc=createArcSketch(source),selection=createArcHoleSelection(selected);
  const stamp=stamps(doc,selection);
  const refuse=reason=>({kind:'refused',format:ARC_HOLE_ANCHORS_FORMAT,
    version:1,...stamp,reason,previewOnly:true,nativeExact:false});
  if(!exact(expected,['sourceSignature','selectionSignature'])||
     expected.sourceSignature!==stamp.sourceSignature||
     expected.selectionSignature!==stamp.selectionSignature)
    return refuse('stale sketch or profile selection');
  if(!command||typeof command!=='object'||Array.isArray(command)||
     !validId(command.circleId))return refuse('invalid anchor command');
  const binding=describe(doc,selection,command.circleId);
  if(binding.mode==='unsupported')return refuse(binding.reason);
  const next=structuredClone(doc);
  const before=solveArcSketch(doc);
  const center=next.points.find(p=>p.id===binding.centerPointId);
  const constraint=id=>next.constraints.find(c=>c.id===id);
  const solvedCenter=pointOf(before,binding.centerPointId);
  try{
    if(command.kind==='bind'&&exact(command,['kind','circleId','anchorPointId'])){
      if(!validId(command.anchorPointId)||
         command.anchorPointId===binding.centerPointId||
         !next.points.some(p=>p.id===command.anchorPointId))
        fail('invalid target reference point');
      if(before.status!=='solved'||!solvedCenter)
        fail('binding requires a solved source sketch');
      const ref=pointOf(before,command.anchorPointId);
      if(!ref)fail('reference point not solved');
      const dx=solvedCenter.x-ref.x,dy=solvedCenter.y-ref.y;
      if(!finite(dx)||!finite(dy))fail('unrepresentable authored offsets');
      if(binding.mode==='fixed'){
        const yId=command.circleId+':anchorY';
        const used=new Set([...next.points,...next.lines,...next.arcs,
          ...next.circles,...next.constraints].map(x=>x.id));
        if(!validId(yId)||used.has(yId))fail('anchor constraint ID collision');
        const x=constraint(binding.fixedConstraintId);
        Object.assign(x,{kind:'distanceX',a:command.anchorPointId,
          b:binding.centerPointId,value:dx});
        delete x.point;delete x.x;delete x.y;
        next.constraints.push({id:yId,kind:'distanceY',a:command.anchorPointId,
          b:binding.centerPointId,value:dy});
      }else{
        Object.assign(constraint(binding.xConstraintId),
          {a:command.anchorPointId,value:dx});
        Object.assign(constraint(binding.yConstraintId),
          {a:command.anchorPointId,value:dy});
      }
    }else if(command.kind==='edit-offset'&&
             exact(command,['kind','circleId','offsetXMm','offsetYMm'])){
      if(binding.mode!=='anchored')fail('hole is not reference-bound');
      if(!finite(command.offsetXMm)||!finite(command.offsetYMm))
        fail('invalid dimension values');
      constraint(binding.xConstraintId).value=command.offsetXMm;
      constraint(binding.yConstraintId).value=command.offsetYMm;
      if(before.status==='solved'){
        const ref=pointOf(before,binding.anchorPointId);
        center.x=ref.x+command.offsetXMm;
        center.y=ref.y+command.offsetYMm;
      }
    }else if(command.kind==='drag-center'&&
             exact(command,['kind','circleId','handleId','xMm','yMm'])){
      if(binding.mode!=='anchored'||command.handleId!=='hole-center:'+command.circleId)
        fail('unknown or non-anchored semantic centre handle');
      if(!finite(command.xMm)||!finite(command.yMm)||before.status!=='solved')
        fail('pointer drag requires finite target and solved source');
      const ref=pointOf(before,binding.anchorPointId);
      const dx=command.xMm-ref.x,dy=command.yMm-ref.y;
      if(!finite(dx)||!finite(dy))fail('unrepresentable pointer offsets');
      constraint(binding.xConstraintId).value=dx;
      constraint(binding.yConstraintId).value=dy;
      center.x=command.xMm;center.y=command.yMm;
    }else if(command.kind==='detach'&&exact(command,['kind','circleId'])){
      if(binding.mode!=='anchored'||before.status!=='solved'||!solvedCenter)
        fail('detachment requires a solved, reference-bound hole');
      const x=constraint(binding.xConstraintId);
      Object.assign(x,{kind:'fixed',point:binding.centerPointId,
        x:solvedCenter.x,y:solvedCenter.y});
      delete x.a;delete x.b;delete x.value;
      next.constraints=next.constraints.filter(c=>c.id!==binding.yConstraintId);
      center.x=solvedCenter.x;center.y=solvedCenter.y;
    }else return refuse('unsupported anchor command');
    const sketch=createArcSketch(next),solution=solveArcSketch(sketch);
    if(solution.status!=='solved')
      return refuse('resulting sketch is '+solution.status+': '+JSON.stringify(solution.diagnostics));
    const profile=prepareArcProfileForProvider(sketch,solution,{
      profileId:selection.profileId,boundaryIds:selection.boundaryIds,
      holeIds:selection.holeIds});
    return {kind:'accepted',format:ARC_HOLE_ANCHORS_FORMAT,version:1,
      ...stamps(sketch,selection),sketch,selection,solution,profile,
      binding:inspectArcHoleAnchor(sketch,selection,command.circleId),
      previewOnly:true,nativeExact:false};
  }catch(error){
    return refuse('anchor edit rejected: '+String(error?.message||error));
  }
}
