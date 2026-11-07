/**
 * Associative polar bolt-circle placement over the accepted nonlinear SKETCH
 * solver. The persisted pattern is authored parameter data; source sketch,
 * profile selection and record must commit in one INTENT/RUNTIME transaction.
 * This module never claims OCCT/STEP authority.
 */
import {createArcSketch,serializeArcSketch,solveArcSketch} from './arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection} from './arc-hole-authoring.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';

export const ARC_BOLT_CIRCLE_VERSION=1;
export const ARC_BOLT_CIRCLE_FORMAT='intuit3d.arc-bolt-circle';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validId=x=>typeof x==='string'&&/^[A-Za-z][\w:.-]{0,127}$/.test(x);
const exact=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');
const reject=message=>{throw new TypeError('arc bolt circle: '+message);};
const configKeys=['id','sourceCircleId','centerXMm','centerYMm','count'];
const recordKeys=['format','version',...configKeys,'seedSnapshot'];
const stamps=(sketch,selection,record)=>({
  sourceSignature:serializeArcSketch(sketch),
  selectionSignature:serializeArcHoleSelection(selection),
  patternSignature:record?serializeArcBoltCircle(record):null
});
const selectionRequest=s=>({profileId:s.profileId,boundaryIds:s.boundaryIds,holeIds:s.holeIds});
const member=(record,i)=>({
  id:record.id+':i'+i,
  pointId:'hole.'+record.id+':i'+i+'.center',
  fixedId:'hole.'+record.id+':i'+i+'.fixed'
});
const members=record=>Array.from({length:record.count-1},(_,i)=>member(record,i+1));
function settings(input){
  if(!exact(input,configKeys)||!validId(input.id)||!validId(input.sourceCircleId)||
      !finite(input.centerXMm)||!finite(input.centerYMm)||
      !Number.isSafeInteger(input.count)||input.count<2||input.count>12)
    reject('invalid polar bolt-circle settings');
  for(const m of members(input))
    if(!validId(m.id)||!validId(m.pointId)||!validId(m.fixedId))
      reject('derived entity ID exceeds supported length');
  return structuredClone(input);
}
export function createArcBoltCircle(source){
  if(!exact(source,recordKeys)||source.format!==ARC_BOLT_CIRCLE_FORMAT||
      source.version!==ARC_BOLT_CIRCLE_VERSION||
      !exact(source.seedSnapshot,['xMm','yMm','radiusMm'])||
      !finite(source.seedSnapshot.xMm)||!finite(source.seedSnapshot.yMm)||
      !finite(source.seedSnapshot.radiusMm)||source.seedSnapshot.radiusMm<=0)
    reject('invalid versioned bolt-circle record');
  settings(Object.fromEntries(configKeys.map(k=>[k,source[k]])));
  return structuredClone(source);
}
export const serializeArcBoltCircle=r=>JSON.stringify(createArcBoltCircle(r));
export const parseArcBoltCircle=s=>createArcBoltCircle(JSON.parse(s));
function solvedSketch(sketch,selection){
  const solution=solveArcSketch(sketch);
  if(solution.status!=='solved')
    reject('sketch is '+solution.status+': '+JSON.stringify(solution.diagnostics));
  const profile=prepareArcProfileForProvider(sketch,solution,selectionRequest(selection));
  return {solution,profile};
}
function seedFrom(sketch,solution,id){
  const circle=sketch.circles.find(c=>c.id===id);
  const center=solution.geometry?.points.find(p=>p.id===circle?.center);
  if(!circle||!center||!finite(center.x)||!finite(center.y))
    reject('selected source circle is missing or unsolved');
  return {xMm:center.x,yMm:center.y,radiusMm:circle.radiusMm};
}
/** Rotate the original seed by i * 2pi/count about the authored centre. */
function position(record,seed,i){
  const a=i*2*Math.PI/record.count,dx=seed.xMm-record.centerXMm,
    dy=seed.yMm-record.centerYMm,c=Math.cos(a),s=Math.sin(a);
  const x=record.centerXMm+dx*c-dy*s;
  const y=record.centerYMm+dx*s+dy*c;
  if(!finite(x)||!finite(y))reject('polar placement exceeds finite coordinates');
  return {x,y};
}
function assertMembers(sketch,selection,record){
  for(let i=1;i<record.count;i++){
    const m=member(record,i),p=position(record,record.seedSnapshot,i);
    const circle=sketch.circles.find(c=>c.id===m.id);
    const point=sketch.points.find(p=>p.id===m.pointId);
    const fixed=sketch.constraints.find(c=>c.id===m.fixedId);
    if(!circle||!point||!fixed||!selection.holeIds.includes(m.id)||
        circle.center!==m.pointId||circle.radiusMm!==record.seedSnapshot.radiusMm||
        point.x!==p.x||point.y!==p.y||
        fixed.kind!=='fixed'||fixed.point!==m.pointId||
        fixed.x!==p.x||fixed.y!==p.y)
      reject('pattern member modified or missing: '+m.id);
    if(sketch.constraints.some(c=>c.id!==m.fixedId&&
         (c.point===m.pointId||c.a===m.pointId||c.b===m.pointId))||
       sketch.lines.some(l=>l.start===m.pointId||l.end===m.pointId)||
       sketch.arcs.some(a=>[a.start,a.end,a.center].includes(m.pointId))||
       sketch.circles.some(c=>c.id!==m.id&&c.center===m.pointId))
      reject('pattern member has other authored dependencies: '+m.id);
  }
}
function editableSeed(sketch,id){
  const circle=sketch.circles.find(c=>c.id===id);
  const point=sketch.points.find(p=>p.id===circle?.center);
  const fixed=sketch.constraints.filter(c=>c.kind==='fixed'&&c.point===circle?.center);
  if(!circle||!point||fixed.length!==1||
     sketch.constraints.some(c=>c.kind!=='fixed'&&
       (c.point===circle.center||c.a===circle.center||c.b===circle.center))||
     sketch.lines.some(l=>l.start===circle.center||l.end===circle.center)||
     sketch.arcs.some(a=>[a.start,a.end,a.center].includes(circle.center))||
     sketch.circles.some(c=>c.id!==circle.id&&c.center===circle.center))
    reject('source circle has other authored constraints or geometry dependencies');
  return {circle,point,fixed:fixed[0]};
}
export function inspectArcBoltCircle(source,selected,recordSource){
  const sketch=createArcSketch(source),selection=createArcHoleSelection(selected),
    record=createArcBoltCircle(recordSource),stamp=stamps(sketch,selection,record);
  const result={format:ARC_BOLT_CIRCLE_FORMAT,version:1,...stamp,
    pattern:record,memberIds:members(record).map(m=>m.id),
    status:'unresolved',reason:null,profile:null,previewOnly:true,nativeExact:false};
  try{
    assertMembers(sketch,selection,record);
    if(!selection.holeIds.includes(record.sourceCircleId))
      reject('source circle not in selected profile');
    const {solution,profile}=solvedSketch(sketch,selection);
    result.profile=profile;
    const seed=seedFrom(sketch,solution,record.sourceCircleId);
    result.status=Object.keys(seed).every(k=>seed[k]===record.seedSnapshot[k])?
      'synchronized':'seed_changed';
    if(result.status==='seed_changed')
      result.reason='source circle changed; refresh polar pattern before native rebuild';
  }catch(e){result.reason=String(e?.message||e);}
  return result;
}
/**
 * Commands: create{id,sourceCircleId,centerXMm,centerYMm,count},
 * reconfigure{centerXMm,centerYMm,count}, refresh{}, edit-seed{xMm,yMm,diameterMm}.
 * One accepted result = one journal transaction. No partial writes on refusal.
 */
/** Public semantic pitch/centre handles; numerical dimensions are analytic 2D. */
export function inspectArcBoltCircleControls(source,selected,recordSource){
  const state=inspectArcBoltCircle(source,selected,recordSource);
  const p=state.pattern,s=p.seedSnapshot;
  const dx=s.xMm-p.centerXMm,dy=s.yMm-p.centerYMm;
  const pitchDiameterMm=2*Math.hypot(dx,dy);
  let sourceEditable=false;
  try{editableSeed(createArcSketch(source),p.sourceCircleId);sourceEditable=true;}catch{}
  return {
    format:'intuit3d.arc-bolt-circle-controls',version:1,
    sourceSignature:state.sourceSignature,selectionSignature:state.selectionSignature,
    patternSignature:state.patternSignature,profileId:createArcHoleSelection(selected).profileId,
    patternId:p.id,sourceCircleId:p.sourceCircleId,
    status:state.status,reason:state.reason,
    canEdit:state.status==='synchronized'&&sourceEditable&&pitchDiameterMm>0,
    dimensions:{count:p.count,centerXMm:p.centerXMm,centerYMm:p.centerYMm,
      pitchDiameterMm,phaseDeg:(Math.atan2(dy,dx)*180/Math.PI+360)%360,
      holeDiameterMm:s.radiusMm*2},
    handles:[{id:p.id+':center',kind:'center',xMm:p.centerXMm,yMm:p.centerYMm},
      {id:p.id+':pitch',kind:'pitch',xMm:s.xMm,yMm:s.yMm}],
    previewOnly:true,nativeExact:false
  };
}
export function proposeArcBoltCircle(source,selected,existing,command,expected){
  const sketch=createArcSketch(source),selection=createArcHoleSelection(selected),
    old=existing===null?null:createArcBoltCircle(existing),stamp=stamps(sketch,selection,old);
  const refuse=reason=>({kind:'refused',format:ARC_BOLT_CIRCLE_FORMAT,version:1,
    ...stamp,reason,previewOnly:true});
  try{
    if(!exact(expected,['sourceSignature','selectionSignature','patternSignature'])||
       Object.keys(stamp).some(k=>expected[k]!==stamp[k]))
      reject('stale sketch, profile selection or bolt circle');
    if(!command||typeof command!=='object'||Array.isArray(command))
      reject('invalid bolt-circle command');
    let config,layoutSeed=null;
    if(old===null){
      if(!exact(command,['kind',...configKeys])||command.kind!=='create')
        reject('create command required');
      config=settings(Object.fromEntries(configKeys.map(k=>[k,command[k]])));
    }else{
      assertMembers(sketch,selection,old);
      config=Object.fromEntries(configKeys.map(k=>[k,old[k]]));
      if(command.kind==='reconfigure'&&
         exact(command,['kind','count','centerXMm','centerYMm']))
        config=settings({...config,count:command.count,
          centerXMm:command.centerXMm,centerYMm:command.centerYMm});
      else if(command.kind==='refresh'&&exact(command,['kind'])){}
      else if(command.kind==='edit-seed'&&
              exact(command,['kind','xMm','yMm','diameterMm'])){}
      else if(command.kind==='edit-layout'&&
              exact(command,['kind','count','centerXMm','centerYMm','pitchDiameterMm','phaseDeg','holeDiameterMm'])){
        config=settings({...config,count:command.count,centerXMm:command.centerXMm,
          centerYMm:command.centerYMm});
        if(!finite(command.pitchDiameterMm)||command.pitchDiameterMm<=0||
           !finite(command.phaseDeg)||!finite(command.holeDiameterMm)||
           command.holeDiameterMm<=0)reject('invalid layout dimensions');
        const radius=command.pitchDiameterMm/2,
          a=(command.phaseDeg%360)*Math.PI/180;
        layoutSeed={xMm:config.centerXMm+radius*Math.cos(a),
          yMm:config.centerYMm+radius*Math.sin(a),diameterMm:command.holeDiameterMm};
      }else if(command.kind==='drag-handle'&&
                exact(command,['kind','handleId','xMm','yMm'])){
        if(!finite(command.xMm)||!finite(command.yMm))reject('invalid pointer target');
        if(command.handleId===old.id+':pitch')
          layoutSeed={xMm:command.xMm,yMm:command.yMm,
            diameterMm:old.seedSnapshot.radiusMm*2};
        else if(command.handleId===old.id+':center'){
          const dx=command.xMm-old.centerXMm,dy=command.yMm-old.centerYMm;
          config=settings({...config,centerXMm:command.xMm,centerYMm:command.yMm});
          layoutSeed={xMm:old.seedSnapshot.xMm+dx,yMm:old.seedSnapshot.yMm+dy,
            diameterMm:old.seedSnapshot.radiusMm*2};
        }else reject('unknown semantic drag handle');
      }
      else reject('invalid bolt-circle edit command');
    }
    if(!selection.holeIds.includes(config.sourceCircleId))
      reject('source circle must be selected as an analytic hole');
    const next=structuredClone(sketch),selectedNext=structuredClone(selection);
    if(layoutSeed){
      const before=solveArcSketch(sketch);
      if(before.status!=='solved')reject('source sketch is '+before.status);
      const seed=seedFrom(sketch,before,config.sourceCircleId);
      if(Object.keys(seed).some(k=>seed[k]!==old.seedSnapshot[k]))
        reject('source hole changed; refresh pattern before editing layout');
    }
    if(command.kind==='edit-seed'||layoutSeed){
      const edit=layoutSeed||command;
      if(!finite(edit.xMm)||!finite(edit.yMm)||
         !finite(edit.diameterMm)||edit.diameterMm<=0||
         !finite(edit.diameterMm/2)||edit.diameterMm/2<=0)
        reject('invalid source position or diameter');
      const seed=editableSeed(next,config.sourceCircleId);
      seed.point.x=seed.fixed.x=edit.xMm;
      seed.point.y=seed.fixed.y=edit.yMm;
      seed.circle.radiusMm=edit.diameterMm/2;
    }
    // Geometry is always solved before deriving member placements.
    const solution=solveArcSketch(next);
    if(solution.status!=='solved')reject('source sketch is '+solution.status);
    const seed=seedFrom(next,solution,config.sourceCircleId);
    const record=createArcBoltCircle({
      format:ARC_BOLT_CIRCLE_FORMAT,version:1,...config,seedSnapshot:seed});
    const previous=old?members(old):[],desired=members(record);
    const beforeIds=new Set(previous.map(m=>m.id));
    const afterIds=new Set(desired.map(m=>m.id));
    const createdIds=desired.filter(m=>!beforeIds.has(m.id)).map(m=>m.id);
    const removedIds=previous.filter(m=>!afterIds.has(m.id)).map(m=>m.id);
    const preservedIds=desired.filter(m=>beforeIds.has(m.id)).map(m=>m.id);
    const occupied=new Set([...next.points,...next.lines,...next.arcs,...next.circles,
      ...next.constraints].map(e=>e.id));
    for(const m of desired){
      if(!beforeIds.has(m.id)&&[m.id,m.pointId,m.fixedId].some(id=>occupied.has(id)))
        reject('polar pattern semantic identity collision: '+m.id);
      if(!beforeIds.has(m.id))
        [m.id,m.pointId,m.fixedId].forEach(id=>occupied.add(id));
    }
    for(const m of previous){
      if(afterIds.has(m.id))continue;
      next.circles=next.circles.filter(c=>c.id!==m.id);
      next.points=next.points.filter(p=>p.id!==m.pointId);
      next.constraints=next.constraints.filter(c=>c.id!==m.fixedId);
      selectedNext.holeIds=selectedNext.holeIds.filter(id=>id!==m.id);
    }
    for(let i=1;i<record.count;i++){
      const m=member(record,i),p=position(record,seed,i);
      if(beforeIds.has(m.id)){
        const circle=next.circles.find(c=>c.id===m.id);
        const point=next.points.find(q=>q.id===m.pointId);
        const fixed=next.constraints.find(c=>c.id===m.fixedId);
        circle.radiusMm=seed.radiusMm;
        point.x=fixed.x=p.x;point.y=fixed.y=p.y;
      }else{
        next.points.push({id:m.pointId,x:p.x,y:p.y});
        next.circles.push({id:m.id,center:m.pointId,radiusMm:seed.radiusMm});
        next.constraints.push({id:m.fixedId,kind:'fixed',
          point:m.pointId,x:p.x,y:p.y});
        selectedNext.holeIds.push(m.id);
      }
    }
    const committedSketch=createArcSketch(next),
      committedSelection=createArcHoleSelection(selectedNext);
    const {solution:finalSolution,profile}=solvedSketch(committedSketch,committedSelection);
    return {kind:'accepted',format:ARC_BOLT_CIRCLE_FORMAT,version:1,
      previous:stamp,...stamps(committedSketch,committedSelection,record),
      sketch:committedSketch,selection:committedSelection,pattern:record,
      solution:finalSolution,profile,createdIds,removedIds,preservedIds,
      previewOnly:true,nativeExact:false};
  }catch(e){return refuse(String(e?.message||e));}
}
